import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
const COROS_SCOPES = "openid offline_access mcp.tools";
const PROVIDER = "coros";

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function randomBase64Url(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readJsonResponse(response: Response, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) {
    const safe = body?.error_description || body?.error || body?.message || text || String(response.status);
    throw new Error(`${label}: ${safe}`);
  }
  return body;
}

async function currentUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("Session Frog Pace manquante");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error("Session Frog Pace invalide");
  return data.user;
}

function validateRedirectUri(value: unknown) {
  const url = new URL(String(value || ""));
  const validHost = url.hostname === "frog-pace.vercel.app" || url.hostname.endsWith("-coros-app-s-projects.vercel.app");
  if (url.protocol !== "https:" || !validHost || url.pathname !== "/api/coros/callback") {
    throw new Error("URL de retour Frog Pace invalide");
  }
  return url.toString();
}

async function startOAuth(userId: string, redirectUriInput: unknown) {
  const redirectUri = validateRedirectUri(redirectUriInput);
  const registrationResponse = await fetch(`${COROS_ISSUER}/connect/register`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Frog Pace",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: COROS_SCOPES,
      token_endpoint_auth_method: "none"
    })
  });
  const registration = await readJsonResponse(registrationResponse, "Inscription OAuth COROS");
  if (!registration.client_id) throw new Error("COROS n’a pas renvoyé de client_id");

  const verifier = randomBase64Url(48);
  const state = randomBase64Url(24);
  const challenge = await sha256Base64Url(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await service.from("provider_oauth_states").delete().eq("user_id", userId).eq("provider", PROVIDER);
  const { error: stateError } = await service.from("provider_oauth_states").insert({
    user_id: userId,
    provider: PROVIDER,
    state,
    client_id: registration.client_id,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    scopes: COROS_SCOPES.split(" "),
    expires_at: expiresAt
  });
  if (stateError) throw stateError;

  const { error: connectionError } = await service.from("provider_connections").upsert({
    user_id: userId,
    provider: PROVIDER,
    status: "connecting",
    scopes: COROS_SCOPES.split(" "),
    last_error: null,
    metadata: { oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL }
  }, { onConflict: "user_id,provider" });
  if (connectionError) throw connectionError;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope: COROS_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: COROS_MCP_URL,
    state
  });

  return { authorizationUrl: `${COROS_ISSUER}/oauth2/authorize?${params.toString()}` };
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
    p_scope: token.scope || COROS_SCOPES,
    p_token_type: token.token_type || "Bearer"
  });
  if (error) throw error;
  return expiresAt;
}

async function finishOAuth(userId: string, code: unknown, stateInput: unknown) {
  const state = String(stateInput || "");
  const authorizationCode = String(code || "");
  if (!state || !authorizationCode) throw new Error("Réponse OAuth COROS incomplète");

  const { data: pending, error: pendingError } = await service
    .from("provider_oauth_states")
    .select("id,client_id,code_verifier,redirect_uri,expires_at")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .eq("state", state)
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (!pending) throw new Error("Session de connexion COROS introuvable ou déjà utilisée");
  if (new Date(pending.expires_at).getTime() < Date.now()) throw new Error("Session de connexion COROS expirée");

  const token = await exchangeToken({
    grant_type: "authorization_code",
    client_id: pending.client_id,
    code: authorizationCode,
    redirect_uri: pending.redirect_uri,
    code_verifier: pending.code_verifier
  });
  if (!token.access_token || !token.refresh_token) throw new Error("COROS n’a pas renvoyé les jetons attendus");

  const scopes = String(token.scope || COROS_SCOPES).split(/\s+/).filter(Boolean);
  const { data: connection, error: connectionError } = await service
    .from("provider_connections")
    .upsert({
      user_id: userId,
      provider: PROVIDER,
      status: "connected",
      scopes,
      last_error: null,
      metadata: { oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL }
    }, { onConflict: "user_id,provider" })
    .select("id")
    .single();
  if (connectionError || !connection) throw connectionError || new Error("Connexion COROS introuvable");

  await storeCredentials(connection.id, pending.client_id, token);
  await service.from("provider_oauth_states").delete().eq("id", pending.id);
  return { connected: true };
}

function parseSseOrJson(text: string, contentType: string | null) {
  if (!text) return {};
  if (!String(contentType || "").includes("text/event-stream")) return JSON.parse(text);
  const payloads: string[] = [];
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (lines.length) { payloads.push(lines.join("\n")); lines = []; }
      continue;
    }
    if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
  }
  if (lines.length) payloads.push(lines.join("\n"));
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch { /* continue */ }
  }
  throw new Error("Réponse MCP COROS illisible");
}

async function mcpRpc(accessToken: string, method: string, params: any, id: number) {
  const response = await fetch(COROS_MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 240)}`);
  const payload = parseSseOrJson(text, response.headers.get("content-type"));
  if (payload?.error) throw new Error(payload.error.message || "Erreur MCP COROS");
  return payload;
}

function parseMaybeJson(text: unknown) {
  if (typeof text !== "string") return text;
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { return text; }
}

function extractToolData(result: any) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const values = content
    .filter((item: any) => item && (item.type === "text" || typeof item.text === "string"))
    .map((item: any) => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length > 1) return values;
  return result;
}

let rpcId = 1;
async function mcpTool(accessToken: string, name: string, args: Record<string, unknown> = {}) {
  const initId = rpcId++;
  await mcpRpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Frog Pace", version: "1.0.0" }
  }, initId);
  const callId = rpcId++;
  const payload = await mcpRpc(accessToken, "tools/call", { name, arguments: args }, callId);
  return extractToolData(payload?.result);
}

async function loadAccessToken(connectionId: string) {
  const { data, error } = await service.rpc("service_get_provider_credentials", { p_connection_id: connectionId });
  if (error) throw error;
  const credentials = Array.isArray(data) ? data[0] : data;
  if (!credentials?.client_id || !credentials?.refresh_token) throw new Error("Identifiants COROS incomplets");

  const expiry = credentials.expires_at ? new Date(credentials.expires_at).getTime() : 0;
  if (credentials.access_token && expiry > Date.now() + 60_000) {
    return { accessToken: credentials.access_token as string, clientId: credentials.client_id as string };
  }

  const token = await exchangeToken({
    grant_type: "refresh_token",
    client_id: credentials.client_id,
    refresh_token: credentials.refresh_token
  });
  if (!token.access_token) throw new Error("COROS n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, credentials.client_id, token);
  return { accessToken: token.access_token as string, clientId: credentials.client_id as string };
}

function normalizeKey(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findValue(root: any, candidateKeys: string[]) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && ["string", "number", "boolean"].includes(typeof value)) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function findObject(root: any, candidateKeys: string[]) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && value && typeof value === "object") return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return {};
}

function findRecordArray(root: any): any[] {
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some(item => item && typeof item === "object" && ("labelId" in item || "sportType" in item || "startTimestamp" in item))) return current;
      queue.push(...current);
      continue;
    }
    queue.push(...Object.values(current).filter(value => value && typeof value === "object"));
  }
  return [];
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function paceSeconds(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sportName(code: unknown) {
  const map: Record<number, string> = {
    100: "Course", 101: "Course tapis", 102: "Trail", 103: "Piste", 104: "Randonnée", 105: "Alpinisme",
    200: "Vélo", 201: "Vélo indoor", 202: "Vélo électrique", 203: "Gravel", 204: "VTT", 205: "VTTAE",
    300: "Natation piscine", 301: "Eau libre", 400: "Cardio", 401: "Cardio GPS", 402: "Renforcement",
    900: "Marche", 901: "Corde à sauter", 904: "Yoga", 905: "Pilates", 10000: "Triathlon"
  };
  const numeric = Number(code);
  return map[numeric] || (Number.isFinite(numeric) ? `Sport COROS ${numeric}` : "Activité COROS");
}

function isoFromUnix(value: unknown) {
  const number = numberValue(value);
  if (!number || number < 1_000_000_000) return null;
  return new Date(number * 1000).toISOString();
}

function normalizeActivity(userId: string, record: any) {
  const providerId = String(record?.labelId || `${record?.startTimestamp || "unknown"}-${record?.sportType || "sport"}`);
  const distanceKm = numberValue(record?.distanceKm ?? record?.distance ?? record?.totalDistance);
  const rawDurationSeconds = numberValue(record?.durationSeconds ?? record?.workoutTimeSeconds ?? record?.elapsedSeconds);
  return {
    user_id: userId,
    provider: PROVIDER,
    provider_activity_id: providerId,
    sport: record?.sportName || record?.sportTypeName || sportName(record?.sportType),
    sport_type: numberValue(record?.sportType),
    started_at: isoFromUnix(record?.startTimestamp),
    ended_at: isoFromUnix(record?.endTimestamp),
    distance_m: distanceKm === null ? null : Math.round(distanceKm * 1000),
    duration_s: rawDurationSeconds === null ? null : Math.round(rawDurationSeconds),
    avg_hr: numberValue(record?.avgHr ?? record?.averageHeartRate ?? record?.avgHeartRate),
    max_hr: numberValue(record?.maxHr ?? record?.maxHeartRate),
    pace_seconds_per_km: paceSeconds(record?.averagePace ?? record?.avgPace ?? record?.pace),
    avg_speed_kmh: numberValue(record?.averageSpeed ?? record?.avgSpeed),
    elevation_gain_m: numberValue(record?.elevationGain ?? record?.elevationGainM ?? record?.totalAscent),
    training_load: numberValue(record?.trainingLoad),
    training_effect: record?.trainingEffect && typeof record.trainingEffect === "object" ? record.trainingEffect : {},
    training_focus: record?.trainingFocus || record?.focus || null,
    raw_provider_data: record
  };
}

function formatDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function safeTool(accessToken: string, name: string, args: Record<string, unknown>, errors: string[]) {
  try { return await mcpTool(accessToken, name, args); }
  catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); return null; }
}

async function syncCoros(userId: string, syncType = "manual") {
  const { data: connection, error: connectionError } = await service
    .from("provider_connections")
    .select("id,status,metadata")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.status !== "connected") throw new Error("COROS n’est pas connecté");

  const { data: syncRow, error: syncStartError } = await service
    .from("provider_syncs")
    .insert({ user_id: userId, provider: PROVIDER, sync_type: syncType, status: "running" })
    .select("id")
    .single();
  if (syncStartError || !syncRow) throw syncStartError || new Error("Impossible de démarrer la synchronisation");

  try {
    const { accessToken } = await loadAccessToken(connection.id);
    const { data: profile } = await service.from("user_profiles").select("timezone").eq("user_id", userId).maybeSingle();
    const timezone = profile?.timezone || "Europe/Paris";
    const errors: string[] = [];
    const today = new Date();
    const start = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);

    let activitiesRaw: any = null;
    try {
      activitiesRaw = await mcpTool(accessToken, "querySportRecords", {
        startDate: formatDate(start),
        endDate: formatDate(today),
        sportTypeCodes: [65535],
        limit: 100,
        timezone
      });
    } catch {
      try {
        activitiesRaw = await mcpTool(accessToken, "querySportRecords", {
          startDate: formatDate(start),
          endDate: formatDate(today),
          sportTypeCodes: [65535],
          minDistanceKm: 0,
          maxDistanceKm: 100000,
          minDurationMinutes: 0,
          maxDurationMinutes: 100000,
          maxAveragePace: "",
          locationKeyword: "",
          limit: 100,
          timezone
        });
      } catch (secondError) {
        errors.push(`querySportRecords: ${secondError instanceof Error ? secondError.message : String(secondError)}`);
      }
    }

    const [recovery, load, fitness, sleep, restingHr, sleepHrv, dailyHealth, devices] = await Promise.all([
      safeTool(accessToken, "queryRecoveryStatus", {}, errors),
      safeTool(accessToken, "queryTrainingLoadAssessment", { days: 14 }, errors),
      safeTool(accessToken, "queryFitnessAssessmentOverview", {}, errors),
      safeTool(accessToken, "querySleepData", { startDate: "", endDate: "", days: 7, timezone }, errors),
      safeTool(accessToken, "queryRestingHeartRate", { days: 7, timezone }, errors),
      safeTool(accessToken, "querySleepHrv", { startDate: "", endDate: "", days: 7, timezone }, errors),
      safeTool(accessToken, "queryDailyHealthData", { days: 7, timezone }, errors),
      safeTool(accessToken, "queryDevices", {}, errors)
    ]);

    const records = findRecordArray(activitiesRaw);
    const rows = records.map(record => normalizeActivity(userId, record));
    if (rows.length) {
      const { error: upsertError } = await service.from("activities").upsert(rows, {
        onConflict: "user_id,provider,provider_activity_id"
      });
      if (upsertError) throw upsertError;
    }

    const recoveryValue = numberValue(findValue(recovery, ["recoveryPercentage", "recoveryPercent", "recovery"]));
    const shortLoad = numberValue(findValue(load, ["shortTermLoad", "shortLoad", "shortTermTrainingLoad"]));
    const longLoad = numberValue(findValue(load, ["longTermLoad", "longLoad", "longTermTrainingLoad"]));
    const loadRatio = numberValue(findValue(load, ["loadRatio", "ratio"]));
    const vo2max = numberValue(findValue(fitness, ["vo2max", "vo2Max"]));
    const thresholdPace = findValue(fitness, ["thresholdPace", "lactateThresholdPace"]);
    const thresholdHr = numberValue(findValue(fitness, ["thresholdHeartRate", "thresholdHr", "lactateThresholdHeartRate"]));
    const restingHrValue = numberValue(findValue(restingHr, ["restingHeartRate", "restingHr"]));
    const racePredictions = findObject(fitness, ["racePredictions", "racePrediction", "predictions"]);

    const { error: snapshotError } = await service.from("fitness_snapshots").insert({
      user_id: userId,
      provider: PROVIDER,
      recovery: recoveryValue,
      sleep: sleep || {},
      hrv: sleepHrv || {},
      resting_hr: restingHrValue,
      short_load: shortLoad,
      long_load: longLoad,
      load_ratio: loadRatio,
      vo2max,
      threshold_pace: typeof thresholdPace === "string" ? thresholdPace : thresholdPace == null ? null : String(thresholdPace),
      threshold_hr: thresholdHr,
      race_predictions: racePredictions || {},
      raw_provider_data: {
        recovery: recovery || null,
        load: load || null,
        fitness: fitness || null,
        sleep: sleep || null,
        restingHeartRate: restingHr || null,
        sleepHrv: sleepHrv || null,
        dailyHealth: dailyHealth || null
      }
    });
    if (snapshotError) throw snapshotError;

    const metadata = {
      ...(connection.metadata || {}),
      devices: devices || null,
      last_sync_window_days: 60
    };
    const resultStatus = errors.length ? "partial" : "success";
    const now = new Date().toISOString();
    await service.from("provider_connections").update({
      status: "connected",
      last_sync_at: now,
      last_error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      metadata
    }).eq("id", connection.id);
    await service.from("provider_syncs").update({
      status: resultStatus,
      completed_at: now,
      imported_activities: rows.length,
      details: { activity_records: records.length, errors, window_days: 60 },
      error_message: errors.length ? errors.join(" | ").slice(0, 4000) : null
    }).eq("id", syncRow.id);

    return { status: resultStatus, importedActivities: rows.length, warnings: errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    await service.from("provider_syncs").update({ status: "error", completed_at: now, error_message: message }).eq("id", syncRow.id);
    await service.from("provider_connections").update({ last_error: message }).eq("id", connection.id);
    throw error;
  }
}

async function disconnectCoros(userId: string) {
  const { data: connection, error } = await service
    .from("provider_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw error;
  if (!connection) return { disconnected: true };
  const { error: deleteCredentialsError } = await service.rpc("service_delete_provider_credentials", { p_connection_id: connection.id });
  if (deleteCredentialsError) throw deleteCredentialsError;
  await service.from("provider_oauth_states").delete().eq("user_id", userId).eq("provider", PROVIDER);
  const { error: updateError } = await service.from("provider_connections").update({
    status: "disconnected",
    last_error: null,
    scopes: []
  }).eq("id", connection.id);
  if (updateError) throw updateError;
  return { disconnected: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const user = await currentUser(req);
    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case "start": return json(await startOAuth(user.id, body.redirectUri));
      case "finish": return json(await finishOAuth(user.id, body.code, body.state));
      case "sync": return json(await syncCoros(user.id, body.syncType || "manual"));
      case "disconnect": return json(await disconnectCoros(user.id));
      default: return json({ error: "Action COROS inconnue" }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 400);
  }
});
