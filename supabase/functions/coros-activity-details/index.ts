import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
const PROVIDER = "coros";
const DEFAULT_BATCH = 8;
const MAX_BATCH = 12;

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
    .slice(0, 1000);
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

function parseMaybeJson(text: unknown) {
  if (typeof text !== "string") return text;
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { return text; }
}

function extractToolData(result: any) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const values = (Array.isArray(result.content) ? result.content : [])
    .filter((item: any) => item && typeof item.text === "string")
    .map((item: any) => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length) return values;
  return result;
}

let rpcId = 1;
async function mcpRpc(accessToken: string, method: string, params: any) {
  const response = await fetch(COROS_MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params: params || {} })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 220)}`);
  const payload = parseSseOrJson(text, response.headers.get("content-type"));
  if (payload?.error) throw new Error(payload.error.message || "Erreur MCP COROS");
  return payload;
}

async function mcpTool(accessToken: string, name: string, args: Record<string, unknown>) {
  await mcpRpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Frog Pace Activity Detail", version: "1.0.0" }
  });
  const payload = await mcpRpc(accessToken, "tools/call", { name, arguments: args });
  return extractToolData(payload?.result);
}

function normalizeKey(value: unknown) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function flattenText(root: any): string {
  if (root == null) return "";
  if (typeof root === "string") return root;
  const lines: string[] = [];
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (current == null) continue;
    if (typeof current === "string") { lines.push(current); continue; }
    if (typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (["string", "number", "boolean"].includes(typeof value)) lines.push(`${key}: ${value}`);
      else if (value && typeof value === "object") queue.push(value);
    }
  }
  return lines.join("\n");
}

function findStructured(root: any, keys: string[]) {
  const wanted = new Set(keys.map(normalizeKey));
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key)) && ["string", "number", "boolean"].includes(typeof value) && value !== "") return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function detailNumber(root: any, keys: string[], regexes: RegExp[]) {
  const direct = numberValue(findStructured(root, keys));
  if (direct !== null) return direct;
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) return numberValue(match[1]);
  }
  return null;
}

function detailText(root: any, keys: string[], regexes: RegExp[]) {
  const direct = findStructured(root, keys);
  if (direct !== null && direct !== "") return String(direct).trim();
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normalizeDetail(raw: any) {
  return {
    avg_hr: detailNumber(raw, ["avgHr", "averageHeartRate", "avgHeartRate", "avgHeartRateBpm"], [/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    max_hr: detailNumber(raw, ["maxHr", "maxHeartRate", "maximumHeartRate", "maxHeartRateBpm"], [/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    elevation_gain_m: detailNumber(raw, ["elevationGain", "elevationGainM", "totalAscent", "ascent", "totalClimb"], [/(?:Elevation\s*Gain|Total\s*Ascent|Ascent)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    training_load: detailNumber(raw, ["trainingLoad", "exerciseLoad", "load"], [/(?:Training|Exercise)\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    avg_cadence: detailNumber(raw, ["avgCadence", "averageCadence", "cadenceAvg", "averageStepFrequency"], [/(?:Average|Avg)\s*Cadence\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    max_cadence: detailNumber(raw, ["maxCadence", "maximumCadence", "cadenceMax", "maxStepFrequency"], [/Max(?:imum)?\s*Cadence\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    training_focus: detailText(raw, ["trainingFocus", "focus", "trainingEffectLabel"], [/Training\s*Focus\s*[:=]\s*([^\n|]+)/i])
  };
}

async function enrichBatch(userId: string, requestedBatch: unknown, retryFailed: boolean) {
  const batchSize = Math.max(1, Math.min(MAX_BATCH, Number(requestedBatch) || DEFAULT_BATCH));
  const { data: connection, error: connectionError } = await service
    .from("provider_connections")
    .select("id,status")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.status !== "connected") throw new Error("COROS n’est pas connecté");

  let query = service
    .from("activities")
    .select("id,provider_activity_id,sport_type,started_at")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .not("sport_type", "is", null)
    .order("started_at", { ascending: false })
    .limit(batchSize);

  query = retryFailed
    ? query.not("detail_sync_error", "is", null)
    : query.is("detail_sync_attempted_at", null);

  const { data: activities, error: activitiesError } = await query;
  if (activitiesError) throw activitiesError;

  if (!activities?.length) {
    const { count: remaining } = await service.from("activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("provider", PROVIDER).is("detail_sync_attempted_at", null);
    return { processed: 0, succeeded: 0, failed: 0, remaining: remaining || 0, complete: (remaining || 0) === 0 };
  }

  const accessToken = await loadAccessToken(connection.id);
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const activity of activities) {
    const attemptedAt = new Date().toISOString();
    try {
      const raw = await mcpTool(accessToken, "getActivityDetail", {
        labelId: activity.provider_activity_id,
        sportType: Number(activity.sport_type)
      });
      const metrics = normalizeDetail(raw);
      const update: Record<string, unknown> = {
        detail_provider_data: raw ?? {},
        detail_sync_attempted_at: attemptedAt,
        detail_fetched_at: attemptedAt,
        detail_sync_error: null
      };
      for (const [key, value] of Object.entries(metrics)) {
        if (value !== null && value !== "") update[key] = value;
      }
      const { error: updateError } = await service.from("activities").update(update).eq("id", activity.id).eq("user_id", userId);
      if (updateError) throw updateError;
      succeeded += 1;
    } catch (error) {
      const message = safeMessage(error);
      failed += 1;
      errors.push(`${activity.provider_activity_id}: ${message}`);
      await service.from("activities").update({
        detail_sync_attempted_at: attemptedAt,
        detail_sync_error: message
      }).eq("id", activity.id).eq("user_id", userId);
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }

  const { count: remaining } = await service.from("activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("provider", PROVIDER).is("detail_sync_attempted_at", null);

  return {
    processed: activities.length,
    succeeded,
    failed,
    remaining: remaining || 0,
    complete: (remaining || 0) === 0,
    errors: errors.slice(0, 5)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const user = await currentUser(req);
    const body = await req.json().catch(() => ({}));
    return json(await enrichBatch(user.id, body?.batchSize, Boolean(body?.retryFailed)));
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }
});
