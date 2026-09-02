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

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 4000);
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
    throw new Error(`${label}: ${body?.error_description || body?.error || body?.message || text || response.status}`);
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
    metadata: { oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 2 }
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

async function finishOAuth(userId: string, codeInput: unknown, stateInput: unknown) {
  const code = String(codeInput || "");
  const state = String(stateInput || "");
  if (!code || !state) throw new Error("Réponse OAuth COROS incomplète");

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
    code,
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
      metadata: { oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 2 }
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
  const values = (Array.isArray(result.content) ? result.content : [])
    .filter((item: any) => item && typeof item.text === "string")
    .map((item: any) => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length) return values;
  return result;
}

let rpcId = 1;
async function mcpTool(accessToken: string, name: string, args: Record<string, unknown> = {}) {
  await mcpRpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "Frog Pace", version: "2.0.0" }
  }, rpcId++);
  const payload = await mcpRpc(accessToken, "tools/call", { name, arguments: args }, rpcId++);
  return extractToolData(payload?.result);
}

async function loadAccessToken(connectionId: string) {
  const { data, error } = await service.rpc("service_get_provider_credentials", { p_connection_id: connectionId });
  if (error) throw error;
  const credentials = Array.isArray(data) ? data[0] : data;
  if (!credentials?.client_id || !credentials?.refresh_token) throw new Error("Identifiants COROS incomplets");

  const expiry = credentials.expires_at ? new Date(credentials.expires_at).getTime() : 0;
  if (credentials.access_token && expiry > Date.now() + 60_000) {
    return { accessToken: credentials.access_token as string };
  }

  const token = await exchangeToken({
    grant_type: "refresh_token",
    client_id: credentials.client_id,
    refresh_token: credentials.refresh_token
  });
  if (!token.access_token) throw new Error("COROS n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, credentials.client_id, token);
  return { accessToken: token.access_token as string };
}

function normalizeKey(value: unknown) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function findStructured(root: any, candidateKeys: string[]) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
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

function textNumber(root: any, structuredKeys: string[], regexes: RegExp[]) {
  const direct = numberValue(findStructured(root, structuredKeys));
  if (direct !== null) return direct;
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      const value = numberValue(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function textValue(root: any, structuredKeys: string[], regexes: RegExp[]) {
  const structured = findStructured(root, structuredKeys);
  if (structured !== null && structured !== "") return String(structured).trim();
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function latestDatedBlock(root: any) {
  const text = flattenText(root);
  const matches = [...text.matchAll(/(?:^|\n)(20\d{2}-\d{2}-\d{2})(?::|\s*$)/gm)];
  if (!matches.length) return { date: null as string | null, text };
  let chosen = matches[0];
  for (const match of matches) if (String(match[1]) > String(chosen[1])) chosen = match;
  const index = chosen.index || 0;
  const next = matches.find(match => (match.index || 0) > index);
  return { date: chosen[1], text: text.slice(index, next?.index || text.length) };
}

function parseRecovery(raw: any) {
  return textNumber(raw,
    ["recoveryPercentage", "recoveryPercent", "recoveryScore", "recoveryRate", "recovery"],
    [/(?:Recovery\s*(?:Percentage|Percent|Score|Rate)?|Recovery)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
}

function parseLoad(raw: any) {
  return {
    short: textNumber(raw, ["shortTermLoad", "shortLoad", "shortTermTrainingLoad", "atl"], [/Short[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i, /ATL\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    long: textNumber(raw, ["longTermLoad", "longLoad", "longTermTrainingLoad", "ctl"], [/Long[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i, /CTL\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    ratio: textNumber(raw, ["loadRatio", "trainingLoadRatio", "ratio"], [/Load\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i, /(?:ACWR|Ratio)\s*[:=]\s*(\d+(?:\.\d+)?)/i])
  };
}

function parseFitness(raw: any) {
  const text = flattenText(raw);
  const prediction = (label: string) => {
    const match = text.match(new RegExp(`${label}\\s*Prediction\\s*[:=]\\s*([^\\n|]+)`, "i"));
    return match?.[1]?.trim() || null;
  };
  return {
    vo2max: textNumber(raw, ["vo2max", "vo2Max", "runningVo2max"], [/(?:VO2\s*Max|VO₂max|VO2max)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    thresholdPace: textValue(raw, ["thresholdPace", "lactateThresholdPace", "ltPace"], [/(?:Threshold|Lactate\s*Threshold)\s*Pace\s*[:=]\s*([^\n|]+)/i]),
    thresholdHr: textNumber(raw, ["thresholdHeartRate", "lactateThresholdHeartRate", "thresholdHr", "ltHr"], [/(?:Threshold|Lactate\s*Threshold)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    racePredictions: {
      "5k": prediction("5\\s*km"),
      "10k": prediction("10\\s*km"),
      half: prediction("Half\\s*Marathon"),
      marathon: prediction("Marathon")
    }
  };
}

function durationMinutes(text: string | null) {
  if (!text) return null;
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*(?:min|m)\b/i)?.[1] || 0);
  if (hours || minutes) return hours * 60 + minutes;
  const colon = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (colon) {
    if (colon[3] != null) return Number(colon[1]) * 60 + Number(colon[2]) + Number(colon[3]) / 60;
    return Number(colon[1]) * 60 + Number(colon[2]) / 60;
  }
  return numberValue(text);
}

function parseSleep(raw: any) {
  const block = latestDatedBlock(raw);
  const score = textNumber(block.text, ["sleepScore", "sleepQualityScore", "score"], [/Sleep\s*Score\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const mainSleep = textValue(block.text, ["mainSleepDuration", "sleepDuration"], [/Main\s*Sleep\s*[:=]\s*([^\n|]+)/i, /(?:Main\s*)?Sleep\s*Duration\s*[:=]\s*([^\n|]+)/i]);
  return {
    wake_date: block.date,
    sleepScore: score,
    main_sleep: mainSleep,
    main_sleep_minutes: durationMinutes(mainSleep),
    deep_ratio: textNumber(block.text, [], [/Deep\s*Sleep\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    light_ratio: textNumber(block.text, [], [/Light\s*Sleep\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    rem_ratio: textNumber(block.text, [], [/REM\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    awake_ratio: textNumber(block.text, [], [/Awake\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    awake_minutes: textNumber(block.text, [], [/Awake\s*Time\s*[:=]\s*(\d+(?:\.\d+)?)\s*min/i])
  };
}

function parseHrv(raw: any) {
  const block = latestDatedBlock(raw);
  const range = block.text.match(/Normal\s*Range\s*[:=]\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*ms/i);
  const evalMatch = block.text.match(/HRV\s*Avg\s*[:=]\s*\d+(?:\.\d+)?\s*ms\s*[—-]\s*([^\n|]+)/i);
  return {
    wake_date: block.date,
    avg_ms: textNumber(block.text, ["hrvAvg", "averageHrv"], [/HRV\s*Avg\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    normal_min_ms: range ? Number(range[1]) : null,
    normal_max_ms: range ? Number(range[2]) : null,
    baseline_ms: textNumber(block.text, ["baseline"], [/Baseline\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
    evaluation: evalMatch?.[1]?.trim() || null
  };
}

function parseRestingHr(raw: any) {
  const text = flattenText(raw);
  const direct = textNumber(raw, ["restingHeartRate", "restingHr"], []);
  if (direct !== null) return direct;
  const dated = [...text.matchAll(/20\d{2}-\d{2}-\d{2}\s*:\s*(\d+(?:\.\d+)?)\s*bpm/gi)];
  return dated.length ? Number(dated[0][1]) : null;
}

function formatDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
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

function toIsoTimestamp(value: unknown) {
  const numeric = numberValue(value);
  if (!numeric || numeric < 1_000_000_000) return null;
  const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(ms).toISOString();
}

function parseDurationSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const text = String(value || "").trim();
  if (!text) return null;
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*(?:min|m)\b/i)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)\s*s\b/i)?.[1] || 0);
  if (hours || minutes || seconds) return hours * 3600 + minutes * 60 + seconds;
  const colon = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (colon) return colon[3] != null
    ? Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3])
    : Number(colon[1]) * 60 + Number(colon[2]);
  const numeric = numberValue(text);
  return numeric == null ? null : Math.round(numeric);
}

function parseDistanceMeters(value: unknown) {
  const text = String(value || "").trim();
  const numeric = numberValue(value);
  if (numeric === null) return null;
  if (/\bkm\b/i.test(text)) return Math.round(numeric * 1000);
  if (/\bmi\b/i.test(text)) return Math.round(numeric * 1609.344);
  if (/\bm\b/i.test(text)) return Math.round(numeric);
  return numeric > 200 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function paceSeconds(value: unknown) {
  const text = String(value || "");
  const match = text.match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function structuredActivityRecords(root: any) {
  const found: any[] = [];
  const queue = [root];
  const seen = new Set<any>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current); continue; }
    const labelId = current.labelId ?? current.LabelId ?? current.labelID;
    const sportType = current.sportType ?? current.SportType ?? current.sportTypeCode;
    if (labelId != null) found.push({ ...current, labelId, sportType });
    queue.push(...Object.values(current).filter(value => value && typeof value === "object"));
  }
  const unique = new Map<string, any>();
  for (const item of found) unique.set(String(item.labelId), item);
  return [...unique.values()];
}

function textActivityRecords(root: any) {
  const text = flattenText(root);
  const matches = [...text.matchAll(/(?:Label\s*Id|labelId)\s*[:=]\s*([A-Za-z0-9_-]+)/gi)];
  return matches.map((match, index) => {
    const start = index === 0 ? 0 : (matches[index - 1].index || 0) + matches[index - 1][0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length;
    const block = text.slice(start, end);
    const sportType = textNumber(block, [], [/(?:Sport\s*Type(?:\s*Code)?|sportType)\s*[:=]\s*(\d+)/i]);
    const timestampStart = textNumber(block, [], [/(?:Start\s*Timestamp|startTimestamp)\s*[:=]\s*(\d{9,13})/i]);
    const timestampEnd = textNumber(block, [], [/(?:End\s*Timestamp|endTimestamp)\s*[:=]\s*(\d{9,13})/i]);
    const dates = [...block.matchAll(/20\d{2}-\d{2}-\d{2}/g)];
    const date = dates.length ? dates[dates.length - 1][0] : null;
    return {
      labelId: match[1],
      sportType,
      startTimestamp: timestampStart,
      endTimestamp: timestampEnd,
      date,
      sportName: textValue(block, ["sportName", "sportTypeName"], [/(?:Sport\s*Name|Sport|Activity\s*Name|Workout\s*Name)\s*[:=]\s*([^\n|]+)/i]),
      distance: textValue(block, ["distanceKm", "distance", "totalDistance"], [/Distance\s*[:=]\s*([^\n|]+)/i]),
      duration: textValue(block, ["duration", "workoutTime", "durationSeconds"], [/(?:Duration|Workout\s*Time)\s*[:=]\s*([^\n|]+)/i]),
      averagePace: textValue(block, ["averagePace", "avgPace", "pace"], [/(?:Average|Avg)\s*Pace\s*[:=]\s*([^\n|]+)/i, /Pace\s*[:=]\s*([^\n|]+)/i]),
      averageSpeed: textValue(block, ["averageSpeed", "avgSpeed"], [/(?:Average|Avg)\s*Speed\s*[:=]\s*([^\n|]+)/i]),
      avgHr: textNumber(block, ["avgHr", "averageHeartRate", "avgHeartRate"], [/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      maxHr: textNumber(block, ["maxHr", "maxHeartRate"], [/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      elevationGain: textNumber(block, ["elevationGain", "totalAscent"], [/(?:Elevation\s*Gain|Total\s*Ascent)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      trainingLoad: textNumber(block, ["trainingLoad"], [/Training\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i]),
      trainingFocus: textValue(block, ["trainingFocus", "focus"], [/Training\s*Focus\s*[:=]\s*([^\n|]+)/i]),
      __rawText: block
    };
  });
}

function activityRecords(root: any) {
  const structured = structuredActivityRecords(root);
  if (structured.length) return structured;
  return textActivityRecords(root);
}

function normalizeActivity(userId: string, record: any) {
  const providerId = String(record?.labelId || record?.provider_activity_id || "").trim();
  if (!providerId) return null;
  const sportType = numberValue(record?.sportType ?? record?.sportTypeCode);
  const startedAt = toIsoTimestamp(record?.startTimestamp) || null;
  const endedAt = toIsoTimestamp(record?.endTimestamp) || null;
  const distance = record?.distanceKm ?? record?.distance ?? record?.totalDistance;
  const duration = record?.durationSeconds ?? record?.workoutTimeSeconds ?? record?.elapsedSeconds ?? record?.duration ?? record?.workoutTime;
  const averagePace = record?.averagePace ?? record?.avgPace ?? record?.pace;
  const averageSpeed = record?.averageSpeed ?? record?.avgSpeed;
  return {
    user_id: userId,
    provider: PROVIDER,
    provider_activity_id: providerId,
    sport: record?.sportName || record?.sportTypeName || sportName(sportType),
    sport_type: sportType,
    started_at: startedAt,
    ended_at: endedAt,
    distance_m: parseDistanceMeters(distance),
    duration_s: parseDurationSeconds(duration),
    avg_hr: numberValue(record?.avgHr ?? record?.averageHeartRate ?? record?.avgHeartRate),
    max_hr: numberValue(record?.maxHr ?? record?.maxHeartRate),
    pace_seconds_per_km: paceSeconds(averagePace),
    avg_speed_kmh: numberValue(averageSpeed),
    elevation_gain_m: numberValue(record?.elevationGain ?? record?.elevationGainM ?? record?.totalAscent),
    training_load: numberValue(record?.trainingLoad),
    training_effect: record?.trainingEffect && typeof record.trainingEffect === "object" ? record.trainingEffect : {},
    training_focus: record?.trainingFocus || record?.focus || null,
    raw_provider_data: record?.__rawText ? { text: record.__rawText, date: record.date || null } : record
  };
}

async function safeTool(accessToken: string, name: string, args: Record<string, unknown>, errors: string[]) {
  try { return await mcpTool(accessToken, name, args); }
  catch (error) { errors.push(`${name}: ${safeMessage(error)}`); return null; }
}

async function queryActivities(accessToken: string, startDate: string, endDate: string, timezone: string, errors: string[]) {
  const attempts = [
    { startDate, endDate, limit: 100, timezone },
    { startDate, endDate, sportTypeCodes: [65535], limit: 100, timezone }
  ];
  let last: any = null;
  for (const args of attempts) {
    try {
      const raw = await mcpTool(accessToken, "querySportRecords", args);
      last = raw;
      if (activityRecords(raw).length || /no\s+(?:matching\s+)?(?:workout|sport|activity)\s+records?/i.test(flattenText(raw))) return raw;
    } catch (error) {
      errors.push(`querySportRecords: ${safeMessage(error)}`);
    }
  }
  return last;
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
    const today = new Date();
    const start = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);
    const errors: string[] = [];

    const activitiesRaw = await queryActivities(accessToken, formatDate(start), formatDate(today), timezone, errors);
    const [recoveryRaw, loadRaw, fitnessRaw, sleepRaw, restingHrRaw, hrvRaw, dailyHealthRaw, devicesRaw] = await Promise.all([
      safeTool(accessToken, "queryRecoveryStatus", {}, errors),
      safeTool(accessToken, "queryTrainingLoadAssessment", { days: 14 }, errors),
      safeTool(accessToken, "queryFitnessAssessmentOverview", {}, errors),
      safeTool(accessToken, "querySleepData", { startDate: "", endDate: "", days: 7, timezone }, errors),
      safeTool(accessToken, "queryRestingHeartRate", { days: 7, timezone }, errors),
      safeTool(accessToken, "querySleepHrv", { startDate: "", endDate: "", days: 7, timezone }, errors),
      safeTool(accessToken, "queryDailyHealthData", { days: 7, timezone }, errors),
      safeTool(accessToken, "queryDevices", {}, errors)
    ]);

    const parsedRecords = activityRecords(activitiesRaw);
    const rows = parsedRecords.map(record => normalizeActivity(userId, record)).filter(Boolean);
    if (rows.length) {
      const { error: upsertError } = await service.from("activities").upsert(rows, {
        onConflict: "user_id,provider,provider_activity_id"
      });
      if (upsertError) throw upsertError;
    }

    const recovery = parseRecovery(recoveryRaw);
    const load = parseLoad(loadRaw);
    const fitness = parseFitness(fitnessRaw);
    const sleep = parseSleep(sleepRaw);
    const hrv = parseHrv(hrvRaw);
    const restingHr = parseRestingHr(restingHrRaw);

    const { error: snapshotError } = await service.from("fitness_snapshots").insert({
      user_id: userId,
      provider: PROVIDER,
      recovery,
      sleep,
      hrv,
      resting_hr: restingHr,
      short_load: load.short,
      long_load: load.long,
      load_ratio: load.ratio,
      vo2max: fitness.vo2max,
      threshold_pace: fitness.thresholdPace,
      threshold_hr: fitness.thresholdHr,
      race_predictions: fitness.racePredictions,
      raw_provider_data: {
        recovery: recoveryRaw,
        load: loadRaw,
        fitness: fitnessRaw,
        sleep: sleepRaw,
        restingHeartRate: restingHrRaw,
        sleepHrv: hrvRaw,
        dailyHealth: dailyHealthRaw
      }
    });
    if (snapshotError) throw snapshotError;

    const activityText = flattenText(activitiesRaw);
    const explicitEmpty = /no\s+(?:matching\s+)?(?:workout|sport|activity)\s+records?/i.test(activityText);
    if (!rows.length && activityText.trim() && !explicitEmpty) {
      errors.push("querySportRecords: réponse reçue mais aucun identifiant d’activité n’a pu être normalisé");
    }

    const now = new Date().toISOString();
    const status = errors.length ? "partial" : "success";
    const metadata = {
      ...(connection.metadata || {}),
      devices: devicesRaw || null,
      last_sync_window_days: 60,
      bridge_version: 2
    };

    await service.from("provider_connections").update({
      status: "connected",
      last_sync_at: now,
      last_error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      metadata
    }).eq("id", connection.id);

    await service.from("provider_syncs").update({
      status,
      completed_at: now,
      imported_activities: rows.length,
      details: {
        activity_records: parsedRecords.length,
        activity_text_length: activityText.length,
        activity_label_mentions: (activityText.match(/(?:Label\s*Id|labelId)\s*[:=]/gi) || []).length,
        errors,
        window_days: 60,
        normalized_metrics: {
          recovery: recovery !== null,
          sleep: sleep.sleepScore !== null,
          hrv: hrv.avg_ms !== null,
          short_load: load.short !== null,
          vo2max: fitness.vo2max !== null
        }
      },
      error_message: errors.length ? errors.join(" | ").slice(0, 4000) : null
    }).eq("id", syncRow.id);

    return {
      status,
      importedActivities: rows.length,
      metrics: {
        recovery,
        sleepScore: sleep.sleepScore,
        hrv: hrv.avg_ms,
        shortLoad: load.short,
        loadRatio: load.ratio,
        vo2max: fitness.vo2max,
        thresholdPace: fitness.thresholdPace
      },
      warnings: errors
    };
  } catch (error) {
    const message = safeMessage(error);
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
    return json({ error: safeMessage(error) }, 400);
  }
});
