import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROVIDER = "trainingpeaks";
const TP_API = "https://api.trainingpeaks.com";
const TP_OAUTH = "https://oauth.trainingpeaks.com";
const TP_SCOPES = "workouts:plan workouts:read athlete:profile";

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

function randomBase64Url(bytes = 24) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function currentUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Session Frog Pace manquante");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error("Session Frog Pace invalide");
  return data.user;
}

async function appSecret(key: string) {
  const { data, error } = await service.rpc("service_get_app_secret", { p_key: key });
  if (error) throw error;
  return typeof data === "string" && data.trim() ? data.trim() : null;
}

async function partnerConfig() {
  const [clientId, clientSecret] = await Promise.all([
    appSecret("trainingpeaks_client_id"),
    appSecret("trainingpeaks_client_secret")
  ]);
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function validateRedirectUri(value: unknown) {
  const url = new URL(String(value || ""));
  const validHost = url.hostname === "frog-pace.vercel.app" || url.hostname.endsWith("-coros-app-s-projects.vercel.app");
  if (url.protocol !== "https:" || !validHost || url.pathname !== "/api/trainingpeaks/callback") {
    throw new Error("URL de retour Frog Pace invalide");
  }
  return url.toString();
}

async function readResponse(response: Response, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) {
    const error = new Error(`${label}: ${body?.error_description || body?.error || body?.message || text || response.status}`) as Error & { status?: number; body?: any };
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function exchangeToken(form: Record<string, string>) {
  const response = await fetch(`${TP_OAUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form)
  });
  return readResponse(response, "Token TrainingPeaks");
}

async function startOAuth(userId: string, redirectInput: unknown) {
  const config = await partnerConfig();
  if (!config.configured) {
    return { available: false, blockerCode: "TRAININGPEAKS_PARTNER_ACCESS_REQUIRED", blockerMessage: "Les identifiants API partenaire TrainingPeaks ne sont pas encore configurés dans Frog Pace." };
  }
  const redirectUri = validateRedirectUri(redirectInput);
  const state = randomBase64Url();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await service.from("provider_oauth_states").delete().eq("user_id", userId).eq("provider", PROVIDER);
  const { error: stateError } = await service.from("provider_oauth_states").insert({
    user_id: userId,
    provider: PROVIDER,
    state,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scopes: TP_SCOPES.split(" "),
    expires_at: expiresAt
  });
  if (stateError) throw stateError;

  const { error: connectionError } = await service.from("provider_connections").upsert({
    user_id: userId,
    provider: PROVIDER,
    status: "connecting",
    scopes: TP_SCOPES.split(" "),
    last_error: null,
    metadata: { api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 1 }
  }, { onConflict: "user_id,provider" });
  if (connectionError) throw connectionError;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId!,
    scope: TP_SCOPES,
    redirect_uri: redirectUri,
    state
  });
  return { available: true, authorizationUrl: `${TP_OAUTH}/OAuth/Authorize?${params.toString()}` };
}

async function storeCredentials(connectionId: string, clientId: string, token: any) {
  const expiresIn = Math.max(60, Number(token.expires_in || 3600));
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const { error } = await service.rpc("service_store_provider_credentials", {
    p_connection_id: connectionId,
    p_client_id: clientId,
    p_access_token: token.access_token || null,
    p_refresh_token: token.refresh_token || null,
    p_expires_at: expiresAt,
    p_scope: token.scope || TP_SCOPES,
    p_token_type: token.token_type || "Bearer"
  });
  if (error) throw error;
  return expiresAt;
}

async function finishOAuth(userId: string, codeInput: unknown, stateInput: unknown) {
  const code = String(codeInput || "");
  const state = String(stateInput || "");
  if (!code || !state) throw new Error("Réponse OAuth TrainingPeaks incomplète");
  const config = await partnerConfig();
  if (!config.configured) throw new Error("Accès partenaire TrainingPeaks non configuré");

  const { data: pending, error: pendingError } = await service
    .from("provider_oauth_states")
    .select("id,client_id,redirect_uri,expires_at")
    .eq("user_id", userId).eq("provider", PROVIDER).eq("state", state).maybeSingle();
  if (pendingError) throw pendingError;
  if (!pending) throw new Error("Session TrainingPeaks introuvable ou déjà utilisée");
  if (new Date(pending.expires_at).getTime() < Date.now()) throw new Error("Session TrainingPeaks expirée");

  const token = await exchangeToken({
    client_id: pending.client_id,
    client_secret: config.clientSecret!,
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirect_uri
  });
  if (!token.access_token || !token.refresh_token) throw new Error("TrainingPeaks n’a pas renvoyé les jetons attendus");

  const profileResponse = await fetch(`${TP_API}/v1/athlete/profile`, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "FrogPace/1.0" }
  });
  const profile = await readResponse(profileResponse, "Profil TrainingPeaks");
  const athleteId = String(profile?.Id || profile?.id || "");
  if (!athleteId) throw new Error("TrainingPeaks n’a pas renvoyé l’identifiant athlète");

  const scopes = String(token.scope || TP_SCOPES).split(/\s+/).filter(Boolean);
  const { data: connection, error: connectionError } = await service.from("provider_connections").upsert({
    user_id: userId,
    provider: PROVIDER,
    status: "connected",
    external_user_id: athleteId,
    scopes,
    last_error: null,
    metadata: { api_base: TP_API, oauth_base: TP_OAUTH, bridge_version: 1 }
  }, { onConflict: "user_id,provider" }).select("id").single();
  if (connectionError || !connection) throw connectionError || new Error("Connexion TrainingPeaks introuvable");
  await storeCredentials(connection.id, pending.client_id, token);
  await service.from("provider_oauth_states").delete().eq("id", pending.id);
  return { connected: true, athleteId };
}

async function loadAccessToken(connectionId: string) {
  const config = await partnerConfig();
  if (!config.configured) throw new Error("Accès partenaire TrainingPeaks non configuré");
  const { data, error } = await service.rpc("service_get_provider_credentials", { p_connection_id: connectionId });
  if (error) throw error;
  const credentials = Array.isArray(data) ? data[0] : data;
  if (!credentials?.client_id || !credentials?.refresh_token) throw new Error("Identifiants TrainingPeaks incomplets");
  const expiry = credentials.expires_at ? new Date(credentials.expires_at).getTime() : 0;
  if (credentials.access_token && expiry > Date.now() + 60_000) return credentials.access_token as string;

  const token = await exchangeToken({
    client_id: credentials.client_id,
    client_secret: config.clientSecret!,
    grant_type: "refresh_token",
    refresh_token: credentials.refresh_token
  });
  if (!token.access_token) throw new Error("TrainingPeaks n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, credentials.client_id, token);
  return token.access_token as string;
}

function paceSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const match = String(value || "").match(/(\d+)\s*:\s*(\d{1,2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function paceTarget(targetPace: unknown, thresholdPace: number | null, fallbackRpe = 4) {
  const target = paceSeconds(targetPace);
  if (target && thresholdPace) {
    const pct = clamp(Math.round((thresholdPace / target) * 100), 50, 150);
    return { Unit: "PercentOfThresholdSpeed", Value: pct, MinValue: clamp(pct - 2, 50, 150), MaxValue: clamp(pct + 2, 50, 150) };
  }
  return { Unit: "Rpe", Value: fallbackRpe };
}

function lengthFor(step: any) {
  if (Number(step?.duration_s) > 0) return { Unit: "Second", Value: Math.round(Number(step.duration_s)) };
  if (Number(step?.distance_m) > 0) return { Unit: "Meter", Value: Math.round(Number(step.distance_m)) };
  return null;
}

function buildStructure(rawSteps: any[], thresholdPace: number | null) {
  const steps: any[] = [];
  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i] || {};
    const kind = String(step.kind || "");
    const next = rawSteps[i + 1] || {};
    if (kind === "guidance") continue;

    if (kind === "repeat") {
      const repetitions = Math.max(1, Math.round(Number(step.repetitions) || 1));
      const workSeconds = Math.max(1, Math.round(Number(step.work_duration_s) || 1));
      const recoverySeconds = Math.max(1, Math.round(Number(step.recovery_duration_s) || 1));
      steps.push({
        Type: "Repetition",
        Length: { Unit: "Repetition", Value: repetitions },
        Steps: [
          {
            IntensityClass: "Active",
            Name: "Effort Frog",
            Length: { Unit: "Second", Value: workSeconds },
            Type: "Step",
            IntensityTarget: paceTarget(step.target_pace_seconds_per_km, thresholdPace, 7)
          },
          {
            IntensityClass: "Rest",
            Name: "Récupération",
            Length: { Unit: "Second", Value: recoverySeconds },
            Type: "Step",
            IntensityTarget: { Unit: "Rpe", Value: 2 }
          }
        ]
      });
      continue;
    }

    const length = lengthFor(step);
    if (!length) continue;
    const nextGuidancePace = String(next.kind || "") === "guidance" ? next.target_pace_seconds_per_km : null;
    if (kind === "warmup") {
      steps.push({ IntensityClass: "WarmUp", Name: "Échauffement", Length: length, Type: "Step", IntensityTarget: { Unit: "Rpe", Value: 3 } });
    } else if (kind === "cooldown") {
      steps.push({ IntensityClass: "CoolDown", Name: "Retour au calme", Length: length, Type: "Step", IntensityTarget: { Unit: "Rpe", Value: 2 } });
    } else if (kind === "steady" || kind === "activation") {
      const targetPace = step.target_pace_seconds_per_km || nextGuidancePace;
      steps.push({
        IntensityClass: "Active",
        Name: kind === "activation" ? "Activation" : "Endurance Frog",
        Length: length,
        Type: "Step",
        IntensityTarget: targetPace ? paceTarget(targetPace, thresholdPace, 4) : { Unit: "Rpe", Value: 3 }
      });
    }
  }
  return steps;
}

function workoutType(sport: string) {
  if (sport === "running" || sport === "trail") return "run";
  if (sport === "road_cycling" || sport === "gravel") return "bike";
  if (sport === "strength") return "strength";
  return "other";
}

async function workoutContext(userId: string, workoutId: string) {
  const [{ data: workout, error: workoutError }, { data: fitness }] = await Promise.all([
    service.from("planned_workouts")
      .select("id,user_id,scheduled_date,sport,title,description,duration_s,distance_m,structured_steps,device_export_ready,status")
      .eq("id", workoutId).eq("user_id", userId).maybeSingle(),
    service.from("fitness_snapshots").select("threshold_pace").eq("user_id", userId).order("captured_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (workoutError) throw workoutError;
  if (!workout) throw new Error("Séance introuvable");
  if (!workout.device_export_ready) throw new Error("Cette séance n’est pas compatible avec un export montre");
  if (workout.status !== "planned") throw new Error("Seules les séances planifiées peuvent être exportées");
  return { workout, thresholdPace: paceSeconds(fitness?.threshold_pace) };
}

async function connectionFor(userId: string) {
  const { data, error } = await service.from("provider_connections")
    .select("id,status,external_user_id,scopes,last_error")
    .eq("user_id", userId).eq("provider", PROVIDER).maybeSingle();
  if (error) throw error;
  return data;
}

async function prepareExport(userId: string, workoutId: string) {
  const config = await partnerConfig();
  const connection = await connectionFor(userId);
  const { workout, thresholdPace } = await workoutContext(userId, workoutId);
  const structure = buildStructure(Array.isArray(workout.structured_steps) ? workout.structured_steps : [], thresholdPace);

  let status = "ready";
  let blockerCode: string | null = null;
  let blockerMessage: string | null = null;
  if (!config.configured) {
    status = "blocked";
    blockerCode = "TRAININGPEAKS_PARTNER_ACCESS_REQUIRED";
    blockerMessage = "Les identifiants API partenaire TrainingPeaks doivent encore être approuvés et configurés.";
  } else if (!connection || connection.status !== "connected" || !connection.external_user_id) {
    status = "blocked";
    blockerCode = "TRAININGPEAKS_NOT_CONNECTED";
    blockerMessage = "Connecte ton compte TrainingPeaks à Frog Pace avant l’envoi.";
  }

  const payload = {
    AthleteId: connection?.external_user_id || null,
    Title: workout.title,
    Description: `${workout.description || ""}${workout.description ? "\n\n" : ""}Planifié par Frog Pace.`.trim(),
    WorkoutDay: workout.scheduled_date,
    WorkoutType: workoutType(workout.sport),
    TotalTimePlanned: workout.duration_s ? Number((Number(workout.duration_s) / 3600).toFixed(4)) : undefined,
    DistancePlanned: workout.distance_m ? Number(workout.distance_m) : undefined,
    Structure: structure.length ? JSON.stringify(structure) : undefined,
    StructureDisplayUnit: "kilometer",
    Tags: ["Frog Pace"]
  };

  const { data: row, error } = await service.from("workout_exports").upsert({
    user_id: userId,
    planned_workout_id: workoutId,
    provider: PROVIDER,
    status,
    payload,
    provider_tool: "/v2/workouts/plan",
    blocker_code: blockerCode,
    blocker_message: blockerMessage,
    last_attempt_at: new Date().toISOString()
  }, { onConflict: "planned_workout_id,provider" }).select("*").single();
  if (error) throw error;
  return row;
}

async function markExport(rowId: string, patch: Record<string, unknown>) {
  const { data, error } = await service.from("workout_exports").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", rowId).select("*").single();
  if (error) throw error;
  return data;
}

async function exportWorkout(userId: string, workoutId: string) {
  let row = await prepareExport(userId, workoutId);
  if (row.status === "blocked") return row;
  const connection = await connectionFor(userId);
  if (!connection?.id || !connection.external_user_id) throw new Error("Connexion TrainingPeaks manquante");
  const accessToken = await loadAccessToken(connection.id);
  const payload = { ...row.payload, AthleteId: connection.external_user_id };
  row = await markExport(row.id, {
    status: "pending",
    payload,
    blocker_code: null,
    blocker_message: null,
    attempt_count: Number(row.attempt_count || 0) + 1,
    last_attempt_at: new Date().toISOString()
  });

  const updating = Boolean(row.provider_reference);
  const endpoint = updating ? `${TP_API}/v2/workouts/plan/${encodeURIComponent(row.provider_reference)}` : `${TP_API}/v2/workouts/plan`;
  try {
    const response = await fetch(endpoint, {
      method: updating ? "PUT" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "FrogPace/1.0"
      },
      body: JSON.stringify(updating ? { ...payload, Id: Number(row.provider_reference) || row.provider_reference } : payload)
    });
    const result = await readResponse(response, updating ? "Mise à jour TrainingPeaks" : "Export TrainingPeaks");
    const reference = String(result?.Id || result?.id || row.provider_reference || "");
    return await markExport(row.id, {
      status: "exported",
      provider_reference: reference || null,
      provider_response: result || {},
      blocker_code: null,
      blocker_message: null,
      exported_at: new Date().toISOString()
    });
  } catch (error: any) {
    const is403 = Number(error?.status) === 403;
    return await markExport(row.id, {
      status: is403 ? "blocked" : "failed",
      blocker_code: is403 ? "TRAININGPEAKS_PREMIUM_OR_PERMISSION_REQUIRED" : "TRAININGPEAKS_EXPORT_FAILED",
      blocker_message: is403
        ? "TrainingPeaks a refusé la planification future. Vérifie le niveau du compte et les permissions workouts:plan."
        : safeMessage(error),
      provider_response: error?.body || {}
    });
  }
}

async function exportActivePlan(userId: string) {
  const { data: plan, error: planError } = await service.from("training_plans")
    .select("id").eq("user_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (planError) throw planError;
  if (!plan) throw new Error("Aucun plan actif");
  const { data: workouts, error: workoutError } = await service.from("planned_workouts")
    .select("id").eq("user_id", userId).eq("plan_id", plan.id).eq("status", "planned").eq("device_export_ready", true)
    .gte("scheduled_date", new Date().toISOString().slice(0,10)).order("scheduled_date");
  if (workoutError) throw workoutError;
  const results: any[] = [];
  for (const workout of workouts || []) results.push(await exportWorkout(userId, workout.id));
  return {
    total: results.length,
    exported: results.filter((item) => item.status === "exported").length,
    blocked: results.filter((item) => item.status === "blocked").length,
    failed: results.filter((item) => item.status === "failed").length,
    results
  };
}

async function disconnect(userId: string) {
  const connection = await connectionFor(userId);
  if (connection?.id) {
    try {
      const accessToken = await loadAccessToken(connection.id);
      await fetch(`${TP_OAUTH}/oauth/deauthorize`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    } catch { /* local disconnect still proceeds */ }
    await service.from("provider_connections").update({ status: "disconnected", external_user_id: null, last_error: null }).eq("id", connection.id);
  }
  await service.from("provider_oauth_states").delete().eq("user_id", userId).eq("provider", PROVIDER);
  return { disconnected: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const user = await currentUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");

    if (action === "status") {
      const [config, connection] = await Promise.all([partnerConfig(), connectionFor(user.id)]);
      const { data: exports } = await service.from("workout_exports")
        .select("status").eq("user_id", user.id).eq("provider", PROVIDER);
      return json({
        partnerConfigured: config.configured,
        connected: connection?.status === "connected",
        connectionStatus: connection?.status || "disconnected",
        scopes: connection?.scopes || [],
        exports: {
          total: exports?.length || 0,
          exported: (exports || []).filter((x) => x.status === "exported").length,
          blocked: (exports || []).filter((x) => x.status === "blocked").length
        },
        blockerCode: config.configured ? null : "TRAININGPEAKS_PARTNER_ACCESS_REQUIRED"
      });
    }
    if (action === "start") return json(await startOAuth(user.id, body?.redirectUri));
    if (action === "finish") return json(await finishOAuth(user.id, body?.code, body?.state));
    if (action === "disconnect") return json(await disconnect(user.id));
    if (action === "prepare") return json({ export: await prepareExport(user.id, String(body?.workoutId || "")) });
    if (action === "export") return json({ export: await exportWorkout(user.id, String(body?.workoutId || "")) });
    if (action === "export_plan") return json(await exportActivePlan(user.id));
    return json({ error: "Action TrainingPeaks inconnue" }, 400);
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }
});
