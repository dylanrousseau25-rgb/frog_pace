import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
const PROVIDER = "coros";

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" }
  });
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 1200);
}

async function currentUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Session Frog Pace manquante");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error("Session Frog Pace invalide");
  return data.user;
}

async function readJsonResponse(response: Response, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`${label}: ${body?.error_description || body?.error || body?.message || text || response.status}`);
  return body;
}

async function exchangeToken(form: Record<string, string>) {
  const response = await fetch(`${COROS_ISSUER}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form)
  });
  return readJsonResponse(response, "Token COROS");
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
    p_scope: token.scope || null,
    p_token_type: token.token_type || "Bearer"
  });
  if (error) throw error;
}

async function loadAccessToken(connectionId: string) {
  const { data, error } = await service.rpc("service_get_provider_credentials", { p_connection_id: connectionId });
  if (error) throw error;
  const credentials = Array.isArray(data) ? data[0] : data;
  if (!credentials?.client_id || !credentials?.refresh_token) throw new Error("Identifiants COROS incomplets");

  const expiry = credentials.expires_at ? new Date(credentials.expires_at).getTime() : 0;
  if (credentials.access_token && expiry > Date.now() + 60_000) return credentials.access_token as string;

  const token = await exchangeToken({
    grant_type: "refresh_token",
    client_id: credentials.client_id,
    refresh_token: credentials.refresh_token
  });
  if (!token.access_token) throw new Error("COROS n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, credentials.client_id, token);
  return token.access_token as string;
}

function parseSseOrJson(text: string, contentType: string | null) {
  if (!text) return {};
  if (!String(contentType || "").includes("text/event-stream")) {
    try { return JSON.parse(text); } catch { return { result: { content: [{ type: "text", text }] } }; }
  }
  const payloads: string[] = [];
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (lines.length) payloads.push(lines.join("\n"));
      lines = [];
      continue;
    }
    if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
  }
  if (lines.length) payloads.push(lines.join("\n"));
  for (let i = payloads.length - 1; i >= 0; i--) {
    try { return JSON.parse(payloads[i]); } catch { /* continue */ }
  }
  throw new Error("Réponse MCP COROS illisible");
}

let rpcId = 1;
async function mcpRpc(accessToken: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(COROS_MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 220)}`);
  const payload = parseSseOrJson(text, response.headers.get("content-type"));
  if (payload?.error) throw new Error(payload.error.message || "Erreur MCP COROS");
  return payload;
}

async function listTools(accessToken: string) {
  await mcpRpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Frog Pace Workout Export", version: "1.0.0" }
  });
  const payload = await mcpRpc(accessToken, "tools/list", {});
  return Array.isArray(payload?.result?.tools) ? payload.result.tools : [];
}

function toolCapability(tools: any[]) {
  const names = tools.map(tool => String(tool?.name || ""));
  const relevant = tools.filter(tool => /trainingplan|workout/i.test(String(tool?.name || "")));
  const generate = names.find(name => name === "generateTrainingPlan") || null;
  const update = names.find(name => name === "updateTrainingPlan") || null;
  const detail = names.find(name => name === "queryTrainingPlanDetail") || null;
  const writeAvailable = Boolean(generate || update);
  return {
    writeAvailable,
    generateTool: generate,
    updateTool: update,
    detailTool: detail,
    toolCount: names.length,
    relevantTools: relevant.map(tool => ({ name: tool.name, description: tool.description || null, inputSchema: tool.inputSchema || null }))
  };
}

function sportTypeCode(sport: string) {
  if (sport === "trail") return 102;
  if (sport === "road_cycling") return 200;
  if (sport === "gravel") return 203;
  return 100;
}

function durationTarget(step: any) {
  const seconds = Number(step?.duration_s);
  if (Number.isFinite(seconds) && seconds > 0) return { type: "time", seconds: Math.round(seconds) };
  const meters = Number(step?.distance_m);
  if (Number.isFinite(meters) && meters > 0) return { type: "distance", meters: Math.round(meters) };
  return { type: "open" };
}

function paceTarget(step: any) {
  const seconds = Number(step?.target_pace_seconds_per_km);
  if (Number.isFinite(seconds) && seconds > 0) return { type: "pace", secondsPerKm: Math.round(seconds) };
  return { type: "open" };
}

function exportSteps(steps: any[]) {
  const mapped: any[] = [];
  const notes: string[] = [];
  for (const step of steps) {
    const kind = String(step?.kind || "");
    if (kind === "guidance") {
      if (step?.target_pace_seconds_per_km) notes.push(`Allure indicative ${Math.round(Number(step.target_pace_seconds_per_km))} s/km`);
      continue;
    }
    if (kind === "repeat") {
      mapped.push({
        type: "repeat",
        count: Math.max(1, Math.round(Number(step?.repetitions) || 1)),
        work: {
          duration: { type: "time", seconds: Math.max(1, Math.round(Number(step?.work_duration_s) || 1)) },
          target: paceTarget(step)
        },
        recovery: {
          duration: { type: "time", seconds: Math.max(1, Math.round(Number(step?.recovery_duration_s) || 1)) },
          target: { type: "easy" }
        }
      });
      continue;
    }
    if (["warmup", "cooldown", "steady"].includes(kind)) {
      mapped.push({ type: kind, duration: durationTarget(step), target: paceTarget(step), intensity: step?.intensity || null });
    }
  }
  return { steps: mapped, notes };
}

function buildCanonicalPayload(workout: any) {
  const structured = Array.isArray(workout.structured_steps) ? workout.structured_steps : [];
  const converted = exportSteps(structured);
  return {
    schema: "frog-coros-v1",
    generatedAt: new Date().toISOString(),
    workout: {
      frogWorkoutId: workout.id,
      name: workout.title,
      scheduledDate: workout.scheduled_date,
      description: workout.description || null,
      sport: workout.sport,
      corosSportTypeCode: sportTypeCode(workout.sport),
      durationSeconds: workout.duration_s == null ? null : Number(workout.duration_s),
      distanceMeters: workout.distance_m == null ? null : Number(workout.distance_m),
      intensity: workout.intensity || null,
      steps: converted.steps,
      notes: converted.notes
    }
  };
}

async function connectionFor(userId: string) {
  const { data, error } = await service.from("provider_connections")
    .select("id,status,metadata")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status !== "connected") throw new Error("COROS n’est pas connecté");
  return data;
}

async function capabilities(userId: string) {
  const connection = await connectionFor(userId);
  const accessToken = await loadAccessToken(connection.id);
  const tools = await listTools(accessToken);
  const capability = toolCapability(tools);
  const metadata = { ...(connection.metadata || {}), training_write_capability: { ...capability, checkedAt: new Date().toISOString() } };
  await service.from("provider_connections").update({ metadata }).eq("id", connection.id);
  return capability;
}

async function loadWorkout(userId: string, workoutId: string) {
  const { data, error } = await service.from("planned_workouts")
    .select("id,user_id,plan_id,scheduled_date,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,device_export_ready,workout_schema_version,status")
    .eq("id", workoutId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Séance introuvable");
  if (!data.device_export_ready) throw new Error("Cette séance n’est pas compatible avec un export montre");
  return data;
}

async function prepareOne(userId: string, workoutId: string, capability?: any) {
  const workout = await loadWorkout(userId, workoutId);
  const cap = capability || await capabilities(userId);
  const payload = buildCanonicalPayload(workout);
  const blocked = !cap.writeAvailable;
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    planned_workout_id: workout.id,
    provider: PROVIDER,
    status: blocked ? "blocked" : "ready",
    payload,
    provider_tool: cap.generateTool || cap.updateTool || null,
    blocker_code: blocked ? "COROS_MCP_WRITE_UNAVAILABLE" : "COROS_ADAPTER_SCHEMA_REVIEW",
    blocker_message: blocked
      ? "COROS expose actuellement son MCP en lecture seule. Frog est prêt, mais COROS n’autorise pas encore la création ou mise à jour de plans via MCP."
      : "Un outil COROS d’écriture vient d’apparaître. Frog a détecté son schéma et doit valider l’adaptateur avant le premier envoi réel.",
    updated_at: now
  };
  const { data, error } = await service.from("workout_exports")
    .upsert(row, { onConflict: "planned_workout_id,provider" })
    .select("*")
    .single();
  if (error) throw error;
  return { export: data, capability: cap };
}

async function prepareAll(userId: string) {
  const cap = await capabilities(userId);
  const { data: plan } = await service.from("training_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) return { prepared: 0, capability: cap };
  const { data: workouts, error } = await service.from("planned_workouts")
    .select("id")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .eq("device_export_ready", true)
    .order("scheduled_date");
  if (error) throw error;
  let prepared = 0;
  for (const workout of workouts || []) {
    await prepareOne(userId, workout.id, cap);
    prepared += 1;
  }
  return { prepared, capability: cap };
}

async function exportOne(userId: string, workoutId: string) {
  const cap = await capabilities(userId);
  const prepared = await prepareOne(userId, workoutId, cap);
  const now = new Date().toISOString();
  if (!cap.writeAvailable) {
    await service.from("workout_exports").update({
      status: "blocked",
      attempt_count: Number(prepared.export.attempt_count || 0) + 1,
      last_attempt_at: now,
      blocker_code: "COROS_MCP_WRITE_UNAVAILABLE",
      blocker_message: "COROS n’expose pas encore d’outil d’écriture de plan dans le MCP actif."
    }).eq("id", prepared.export.id);
    return { exported: false, blocked: true, reason: "COROS_MCP_WRITE_UNAVAILABLE", capability: cap };
  }

  await service.from("workout_exports").update({
    status: "blocked",
    attempt_count: Number(prepared.export.attempt_count || 0) + 1,
    last_attempt_at: now,
    blocker_code: "COROS_ADAPTER_SCHEMA_REVIEW",
    blocker_message: "L’outil d’écriture COROS est visible, mais Frog bloque le premier envoi tant que son nouveau schéma n’a pas été validé."
  }).eq("id", prepared.export.id);
  return { exported: false, blocked: true, reason: "COROS_ADAPTER_SCHEMA_REVIEW", capability: cap };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const user = await currentUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "status");
    if (action === "capabilities") return json(await capabilities(user.id));
    if (action === "prepare_all") return json(await prepareAll(user.id));
    if (action === "prepare") return json(await prepareOne(user.id, String(body?.workoutId || "")));
    if (action === "export") return json(await exportOne(user.id, String(body?.workoutId || "")));
    return json({ error: "Action d’export COROS inconnue" }, 400);
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }
});
