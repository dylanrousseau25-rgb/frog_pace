import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
const PROVIDER = "coros";
const HISTORY_YEARS = 3;
const INITIAL_WINDOW_DAYS = 45;
const COROS_RESULT_CAP = 20;

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

async function mcpTool(accessToken: string, name: string, args: Record<string, unknown>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mcpRpc(accessToken, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Frog Pace History", version: "1.0.0" }
      });
      const payload = await mcpRpc(accessToken, "tools/call", { name, arguments: args });
      return extractToolData(payload?.result);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  throw lastError;
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function textNumber(text: string, regexes: RegExp[]) {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) return numberValue(match[1]);
  }
  return null;
}

function textValue(text: string, regexes: RegExp[]) {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function sportName(code: unknown) {
  const map: Record<number, string> = {
    100: "Course", 101: "Course tapis", 102: "Trail", 103: "Piste", 104: "Randonnée", 105: "Alpinisme",
    200: "Vélo", 201: "Vélo indoor", 202: "Vélo électrique", 203: "Gravel", 204: "VTT", 205: "VTTAE",
    300: "Natation piscine", 301: "Eau libre", 400: "Cardio", 401: "Cardio GPS", 402: "Renforcement",
    500: "Ski", 501: "Snowboard", 502: "Ski de fond", 503: "Ski de randonnée",
    900: "Marche", 901: "Corde à sauter", 904: "Yoga", 905: "Pilates", 10000: "Triathlon"
  };
  const numeric = Number(code);
  return map[numeric] || (Number.isFinite(numeric) ? `Sport COROS ${numeric}` : "Activité COROS");
}

function structuredRecords(root: any) {
  const found: any[] = [];
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    const labelId = current.labelId ?? current.LabelId ?? current.labelID;
    if (labelId != null) found.push({ ...current, labelId });
    queue.push(...Object.values(current).filter(value => value && typeof value === "object"));
  }
  const unique = new Map<string, any>();
  for (const record of found) unique.set(String(record.labelId), record);
  return [...unique.values()];
}

function textRecords(root: any) {
  const text = flattenText(root);
  const matches = [...text.matchAll(/(?:Label\s*Id|labelId)\s*[:=]\s*([A-Za-z0-9_-]+)/gi)];
  return matches.map((match, index) => {
    const start = index === 0 ? 0 : (matches[index - 1].index || 0) + matches[index - 1][0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length;
    const block = text.slice(start, end);
    return {
      labelId: match[1],
      sportType: textNumber(block, [/(?:Sport\s*Type(?:\s*Code)?|sportType)\s*[:=]\s*(\d+)/i]),
      startTimestamp: textNumber(block, [/(?:Start\s*Timestamp|startTimestamp)\s*[:=]\s*(\d{9,13})/i]),
      endTimestamp: textNumber(block, [/(?:End\s*Timestamp|endTimestamp)\s*[:=]\s*(\d{9,13})/i]),
      sportName: textValue(block, [/(?:Sport\s*Name|Activity\s*Name|Workout\s*Name)\s*[:=]\s*([^\n|]+)/i]),
      distance: textValue(block, [/Distance\s*[:=]\s*([^\n|]+)/i]),
      duration: textValue(block, [/(?:Duration|Workout\s*Time)\s*[:=]\s*([^\n|]+)/i]),
      averagePace: textValue(block, [/(?:Average|Avg)\s*Pace\s*[:=]\s*([^\n|]+)/i, /Pace\s*[:=]\s*([^\n|]+)/i]),
      averageSpeed: textValue(block, [/(?:Average|Avg)\s*Speed\s*[:=]\s*([^\n|]+)/i]),
      avgHr: textNumber(block, [/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      maxHr: textNumber(block, [/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      elevationGain: textNumber(block, [/(?:Elevation\s*Gain|Total\s*Ascent)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      trainingLoad: textNumber(block, [/Training\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      trainingFocus: textValue(block, [/Training\s*Focus\s*[:=]\s*([^\n|]+)/i]),
      __rawText: block
    };
  });
}

function activityRecords(root: any) {
  const structured = structuredRecords(root);
  return structured.length ? structured : textRecords(root);
}

function toIsoTimestamp(value: unknown) {
  const numeric = numberValue(value);
  if (!numeric || numeric < 1_000_000_000) return null;
  return new Date((numeric > 10_000_000_000 ? numeric : numeric * 1000)).toISOString();
}

function durationSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*(?:min|m)\b/i)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)\s*s\b/i)?.[1] || 0);
  if (hours || minutes || seconds) return hours * 3600 + minutes * 60 + seconds;
  const colon = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (colon) return colon[3] != null
    ? Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
    : Number(colon[1]) * 60 + Number(colon[2]);
  return numberValue(text);
}

function distanceMeters(value: unknown) {
  const text = String(value || "").trim();
  const numeric = numberValue(value);
  if (numeric == null) return null;
  if (/\bkm\b/i.test(text)) return Math.round(numeric * 1000);
  if (/\bmi\b/i.test(text)) return Math.round(numeric * 1609.344);
  if (/\bm\b/i.test(text)) return Math.round(numeric);
  return numeric > 200 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function paceSeconds(value: unknown) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeActivity(userId: string, record: any) {
  const providerId = String(record?.labelId || "").trim();
  if (!providerId) return null;
  const sportType = numberValue(record?.sportType ?? record?.sportTypeCode);
  return {
    user_id: userId,
    provider: PROVIDER,
    provider_activity_id: providerId,
    sport: record?.sportName || record?.sportTypeName || sportName(sportType),
    sport_type: sportType,
    started_at: toIsoTimestamp(record?.startTimestamp),
    ended_at: toIsoTimestamp(record?.endTimestamp),
    distance_m: distanceMeters(record?.distanceKm ?? record?.distance ?? record?.totalDistance),
    duration_s: durationSeconds(record?.durationSeconds ?? record?.workoutTimeSeconds ?? record?.elapsedSeconds ?? record?.duration ?? record?.workoutTime),
    avg_hr: numberValue(record?.avgHr ?? record?.averageHeartRate ?? record?.avgHeartRate),
    max_hr: numberValue(record?.maxHr ?? record?.maxHeartRate),
    pace_seconds_per_km: paceSeconds(record?.averagePace ?? record?.avgPace ?? record?.pace),
    avg_speed_kmh: numberValue(record?.averageSpeed ?? record?.avgSpeed),
    elevation_gain_m: numberValue(record?.elevationGain ?? record?.elevationGainM ?? record?.totalAscent),
    training_load: numberValue(record?.trainingLoad),
    training_effect: record?.trainingEffect && typeof record.trainingEffect === "object" ? record.trainingEffect : {},
    training_focus: record?.trainingFocus || record?.focus || null,
    raw_provider_data: record?.__rawText ? { text: record.__rawText } : record
  };
}

function isoDay(date: Date) { return date.toISOString().slice(0, 10); }
function corosDay(date: Date) { return isoDay(date).replaceAll("-", ""); }
function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
function daysBetween(a: Date, b: Date) { return Math.floor((b.getTime() - a.getTime()) / 86_400_000); }

async function queryWindow(accessToken: string, start: Date, end: Date, timezone: string) {
  const attempts = [
    { startDate: corosDay(start), endDate: corosDay(end), limit: 100, timezone },
    { startDate: corosDay(start), endDate: corosDay(end), sportTypeCodes: [65535], limit: 100, timezone }
  ];
  let last: any = null;
  for (const args of attempts) {
    const raw = await mcpTool(accessToken, "querySportRecords", args);
    last = raw;
    const records = activityRecords(raw);
    if (records.length || /no\s+(?:matching\s+)?(?:workout|sport|activity)\s+records?/i.test(flattenText(raw))) return records;
  }
  return activityRecords(last);
}

async function completeWindow(accessToken: string, start: Date, end: Date, timezone: string, depth = 0): Promise<any[]> {
  const records = await queryWindow(accessToken, start, end, timezone);
  const span = daysBetween(start, end);
  if (records.length < COROS_RESULT_CAP || span <= 0 || depth >= 8) return records;

  const leftSpan = Math.floor(span / 2);
  const mid = addDays(start, leftSpan);
  const rightStart = addDays(mid, 1);
  const left = await completeWindow(accessToken, start, mid, timezone, depth + 1);
  const right = rightStart <= end ? await completeWindow(accessToken, rightStart, end, timezone, depth + 1) : [];
  return [...left, ...right];
}

async function backfillThreeYears(userId: string) {
  const { data: connection, error: connectionError } = await service
    .from("provider_connections")
    .select("id,status,metadata")
    .eq("user_id", userId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.status !== "connected") throw new Error("COROS n’est pas connecté");

  const { count: beforeCount } = await service
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("provider", PROVIDER);

  const { data: syncRow, error: syncError } = await service
    .from("provider_syncs")
    .insert({ user_id: userId, provider: PROVIDER, sync_type: "backfill_3y", status: "running" })
    .select("id")
    .single();
  if (syncError || !syncRow) throw syncError || new Error("Impossible de démarrer l’import historique");

  try {
    const accessToken = await loadAccessToken(connection.id);
    const { data: profile } = await service.from("user_profiles").select("timezone").eq("user_id", userId).maybeSingle();
    const timezone = profile?.timezone || "Europe/Paris";
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - HISTORY_YEARS);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(0, 0, 0, 0);

    const errors: string[] = [];
    const seenIds = new Set<string>();
    let processedWindows = 0;
    let cursor = new Date(start);

    while (cursor <= end) {
      const windowEnd = addDays(cursor, INITIAL_WINDOW_DAYS - 1);
      if (windowEnd > end) windowEnd.setTime(end.getTime());
      try {
        const rawRecords = await completeWindow(accessToken, cursor, windowEnd, timezone);
        const rows = rawRecords
          .map(record => normalizeActivity(userId, record))
          .filter(Boolean)
          .filter((row: any) => {
            if (seenIds.has(row.provider_activity_id)) return false;
            seenIds.add(row.provider_activity_id);
            return true;
          });
        if (rows.length) {
          const { error: upsertError } = await service.from("activities").upsert(rows, {
            onConflict: "user_id,provider,provider_activity_id"
          });
          if (upsertError) throw upsertError;
        }
      } catch (error) {
        errors.push(`${isoDay(cursor)}→${isoDay(windowEnd)}: ${safeMessage(error)}`);
      }

      processedWindows += 1;
      await service.from("provider_syncs").update({
        imported_activities: seenIds.size,
        details: {
          years: HISTORY_YEARS,
          range_start: isoDay(start),
          range_end: isoDay(end),
          processed_windows: processedWindows,
          current_through: isoDay(windowEnd),
          unique_records_seen: seenIds.size,
          errors: errors.slice(-20)
        }
      }).eq("id", syncRow.id);

      cursor = addDays(windowEnd, 1);
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    const { count: afterCount } = await service
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("provider", PROVIDER);

    const now = new Date().toISOString();
    const status = errors.length ? "partial" : "success";
    const total = afterCount || 0;
    const added = Math.max(0, total - (beforeCount || 0));
    const metadata = {
      ...(connection.metadata || {}),
      historical_backfill_years: HISTORY_YEARS,
      historical_backfill_completed_at: now,
      historical_backfill_status: status,
      historical_backfill_range_start: isoDay(start)
    };

    await service.from("provider_connections").update({ metadata, last_sync_at: now }).eq("id", connection.id);
    await service.from("provider_syncs").update({
      status,
      completed_at: now,
      imported_activities: seenIds.size,
      details: {
        years: HISTORY_YEARS,
        range_start: isoDay(start),
        range_end: isoDay(end),
        processed_windows: processedWindows,
        unique_records_seen: seenIds.size,
        activities_before: beforeCount || 0,
        activities_after: total,
        newly_added: added,
        errors: errors.slice(-20)
      },
      error_message: errors.length ? errors.join(" | ").slice(0, 4000) : null
    }).eq("id", syncRow.id);

    return { status, years: HISTORY_YEARS, processed: seenIds.size, newlyAdded: added, totalActivities: total, warnings: errors };
  } catch (error) {
    const message = safeMessage(error);
    await service.from("provider_syncs").update({
      status: "error",
      completed_at: new Date().toISOString(),
      error_message: message
    }).eq("id", syncRow.id);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const user = await currentUser(req);
    return json(await backfillThreeYears(user.id));
  } catch (error) {
    return json({ error: safeMessage(error) }, 400);
  }
});
