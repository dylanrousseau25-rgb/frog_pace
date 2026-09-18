import { createHash, randomBytes, randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { execute, row } from "@/lib/db";

const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
const COROS_SCOPES = "openid offline_access mcp.tools";
const PROVIDER = "coros";

type CorosAction = "start" | "finish" | "sync" | "disconnect";

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 4000);
}

function base64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function randomBase64Url(bytes = 32) {
  return base64url(randomBytes(bytes));
}

function sha256Base64Url(value: string) {
  return base64url(createHash("sha256").update(value).digest());
}

async function readJsonResponse(response: Response, label: string) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`${label}: ${body?.error_description || body?.error || body?.message || text || response.status}`);
  return body;
}

function validateRedirectUri(value: unknown) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.hostname !== "frogpace.kumazel.fr" || url.pathname !== "/api/coros/callback") {
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
      token_endpoint_auth_method: "none",
    }),
    cache: "no-store",
  });
  const registration = await readJsonResponse(registrationResponse, "Inscription OAuth COROS");
  if (!registration.client_id) throw new Error("COROS n’a pas renvoyé de client_id");

  const verifier = randomBase64Url(48);
  const state = randomBase64Url(24);
  const challenge = sha256Base64Url(verifier);
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  await execute("delete from provider_oauth_states where user_id=? and provider=?", [userId, PROVIDER]);
  await execute(
    "insert into provider_oauth_states (id,user_id,provider,state,client_id,code_verifier,redirect_uri,scopes,expires_at) values (?,?,?,?,?,?,?,?,?)",
    [randomUUID(), userId, PROVIDER, state, registration.client_id, verifier, redirectUri, JSON.stringify(COROS_SCOPES.split(" ")), expiresAt]
  );

  const existing = await row<any>("select id from provider_connections where user_id=? and provider=?", [userId, PROVIDER]);
  if (existing) {
    await execute("update provider_connections set status='connecting',scopes=?,last_error=null,metadata=? where id=? and user_id=?", [JSON.stringify(COROS_SCOPES.split(" ")), JSON.stringify({ oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 3 }), existing.id, userId]);
  } else {
    await execute("insert into provider_connections (id,user_id,provider,status,scopes,metadata) values (?,?,'coros','connecting',?,?)", [randomUUID(), userId, JSON.stringify(COROS_SCOPES.split(" ")), JSON.stringify({ oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 3 })]);
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope: COROS_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: COROS_MCP_URL,
    state,
  });
  return { authorizationUrl: `${COROS_ISSUER}/oauth2/authorize?${params.toString()}` };
}

async function exchangeToken(form: Record<string, string>) {
  const response = await fetch(`${COROS_ISSUER}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  return readJsonResponse(response, "Token COROS");
}

async function storeCredentials(connectionId: string, clientId: string, token: any) {
  const expiresIn = Math.max(60, Number(token.expires_in || 3600));
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const existing = await row<any>("select provider_connection_id,refresh_token_encrypted from provider_credentials where provider_connection_id=?", [connectionId]);
  const access = encryptSecret(token.access_token || null);
  const refresh = token.refresh_token ? encryptSecret(token.refresh_token) : existing?.refresh_token_encrypted || null;
  const client = encryptSecret(clientId);
  if (existing) {
    await execute("update provider_credentials set client_id_encrypted=?,access_token_encrypted=?,refresh_token_encrypted=?,expires_at=?,scope=?,token_type=? where provider_connection_id=?", [client, access, refresh, expiresAt, token.scope || COROS_SCOPES, token.token_type || "Bearer", connectionId]);
  } else {
    await execute("insert into provider_credentials (provider_connection_id,client_id_encrypted,access_token_encrypted,refresh_token_encrypted,expires_at,scope,token_type) values (?,?,?,?,?,?,?)", [connectionId, client, access, refresh, expiresAt, token.scope || COROS_SCOPES, token.token_type || "Bearer"]);
  }
  return expiresAt;
}

async function finishOAuth(userId: string, codeInput: unknown, stateInput: unknown) {
  const code = String(codeInput || "");
  const state = String(stateInput || "");
  if (!code || !state) throw new Error("Réponse OAuth COROS incomplète");

  const pending = await row<any>("select * from provider_oauth_states where user_id=? and provider=? and state=? limit 1", [userId, PROVIDER, state]);
  if (!pending) throw new Error("Session de connexion COROS introuvable ou déjà utilisée");
  if (new Date(String(pending.expires_at).replace(" ", "T") + "Z").getTime() < Date.now()) throw new Error("Session de connexion COROS expirée");

  const token = await exchangeToken({
    grant_type: "authorization_code",
    client_id: pending.client_id,
    code,
    redirect_uri: pending.redirect_uri,
    code_verifier: pending.code_verifier,
  });
  if (!token.access_token || !token.refresh_token) throw new Error("COROS n’a pas renvoyé les jetons attendus");

  const connection = await row<any>("select id from provider_connections where user_id=? and provider=?", [userId, PROVIDER]);
  const connectionId = connection?.id || randomUUID();
  if (connection) {
    await execute("update provider_connections set status='connected',scopes=?,last_error=null,metadata=? where id=? and user_id=?", [JSON.stringify(String(token.scope || COROS_SCOPES).split(/\s+/).filter(Boolean)), JSON.stringify({ oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 3 }), connectionId, userId]);
  } else {
    await execute("insert into provider_connections (id,user_id,provider,status,scopes,metadata) values (?,?,'coros','connected',?,?)", [connectionId, userId, JSON.stringify(String(token.scope || COROS_SCOPES).split(/\s+/).filter(Boolean)), JSON.stringify({ oauth_issuer: COROS_ISSUER, mcp_url: COROS_MCP_URL, bridge_version: 3 })]);
  }
  await storeCredentials(connectionId, pending.client_id, token);
  await execute("delete from provider_oauth_states where id=? and user_id=?", [pending.id, userId]);
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
    if (!line) { if (lines.length) payloads.push(lines.join("\n")); lines = []; continue; }
    if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
  }
  if (lines.length) payloads.push(lines.join("\n"));
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch { /* next */ }
  }
  throw new Error("Réponse MCP COROS illisible");
}

let rpcId = 1;
async function mcpRpc(accessToken: string, method: string, params: any) {
  const response = await fetch(COROS_MCP_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params: params || {} }),
    cache: "no-store",
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
  const values = (Array.isArray(result.content) ? result.content : []).filter((item: any) => item && typeof item.text === "string").map((item: any) => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length) return values;
  return result;
}

async function mcpTool(accessToken: string, name: string, args: Record<string, unknown> = {}) {
  await mcpRpc(accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Frog Pace", version: "3.0.0" } });
  const payload = await mcpRpc(accessToken, "tools/call", { name, arguments: args });
  return extractToolData(payload?.result);
}

async function loadAccessToken(connectionId: string) {
  const credentials = await row<any>("select * from provider_credentials where provider_connection_id=?", [connectionId]);
  if (!credentials) throw new Error("Identifiants COROS introuvables");
  const clientId = decryptSecret(credentials.client_id_encrypted);
  const refreshToken = decryptSecret(credentials.refresh_token_encrypted);
  const accessToken = decryptSecret(credentials.access_token_encrypted);
  if (!clientId || !refreshToken) throw new Error("Identifiants COROS incomplets");
  const expiry = credentials.expires_at ? new Date(String(credentials.expires_at).replace(" ", "T") + "Z").getTime() : 0;
  if (accessToken && expiry > Date.now() + 60_000) return accessToken;
  const token = await exchangeToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
  if (!token.access_token) throw new Error("COROS n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connectionId, clientId, token);
  return String(token.access_token);
}

function normalizeKey(value: unknown) { return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function findStructured(root: any, candidateKeys: string[]) {
  const wanted = new Set(candidateKeys.map(normalizeKey)); const queue = [root]; const seen = new Set<any>();
  while (queue.length) { const current = queue.shift(); if (!current || typeof current !== "object" || seen.has(current)) continue; seen.add(current); if (Array.isArray(current)) { queue.push(...current); continue; } for (const [key, value] of Object.entries(current)) { if (wanted.has(normalizeKey(key)) && ["string", "number", "boolean"].includes(typeof value) && value !== "") return value; if (value && typeof value === "object") queue.push(value); } }
  return null;
}
function flattenText(root: any): string { if (root == null) return ""; if (typeof root === "string") return root; const lines: string[] = []; const queue = [root]; const seen = new Set<any>(); while (queue.length) { const current = queue.shift(); if (current == null) continue; if (typeof current === "string") { lines.push(current); continue; } if (typeof current !== "object" || seen.has(current)) continue; seen.add(current); if (Array.isArray(current)) { queue.push(...current); continue; } for (const [key, value] of Object.entries(current)) { if (["string","number","boolean"].includes(typeof value)) lines.push(`${key}: ${value}`); else if (value && typeof value === "object") queue.push(value); } } return lines.join("\n"); }
function numberValue(value: unknown) { if (typeof value === "number" && Number.isFinite(value)) return value; const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/); return match ? Number(match[0]) : null; }
function textNumber(root: any, keys: string[], regexes: RegExp[]) { const direct = numberValue(findStructured(root, keys)); if (direct !== null) return direct; const text = flattenText(root); for (const regex of regexes) { const match = text.match(regex); if (match) { const value = numberValue(match[1]); if (value !== null) return value; } } return null; }
function textValue(root: any, keys: string[], regexes: RegExp[]) { const direct = findStructured(root, keys); if (direct !== null && direct !== "") return String(direct).trim(); const text = flattenText(root); for (const regex of regexes) { const match = text.match(regex); if (match?.[1]) return match[1].trim(); } return null; }
function latestDatedBlock(root: any) { const text = flattenText(root); const matches = [...text.matchAll(/(?:^|\n)(20\d{2}-\d{2}-\d{2})(?::|\s*$)/gm)]; if (!matches.length) return { date: null as string | null, text }; let chosen = matches[0]; for (const match of matches) if (String(match[1]) > String(chosen[1])) chosen = match; const index = chosen.index || 0; const next = matches.find((match) => (match.index || 0) > index); return { date: chosen[1], text: text.slice(index, next?.index || text.length) }; }
function durationMinutes(text: string | null) { if (!text) return null; const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0); const minutes = Number(text.match(/(\d+)\s*(?:min|m)\b/i)?.[1] || 0); if (hours || minutes) return hours * 60 + minutes; const colon = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (colon) return colon[3] != null ? Number(colon[1]) * 60 + Number(colon[2]) + Number(colon[3]) / 60 : Number(colon[1]) * 60 + Number(colon[2]) / 60; return numberValue(text); }
function parseRecovery(raw: any) { return textNumber(raw,["recoveryPercentage","recoveryPercent","recoveryScore","recoveryRate","recovery"],[/(?:Recovery\s*(?:Percentage|Percent|Score|Rate)?|Recovery)\s*[:=]\s*(\d+(?:\.\d+)?)/i]); }
function parseLoad(raw: any) { return { short:textNumber(raw,["shortTermLoad","shortLoad","shortTermTrainingLoad","atl"],[/Short[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i,/ATL\s*[:=]\s*(\d+(?:\.\d+)?)/i]), long:textNumber(raw,["longTermLoad","longLoad","longTermTrainingLoad","ctl"],[/Long[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i,/CTL\s*[:=]\s*(\d+(?:\.\d+)?)/i]), ratio:textNumber(raw,["loadRatio","trainingLoadRatio","ratio"],[/Load\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i,/(?:ACWR|Ratio)\s*[:=]\s*(\d+(?:\.\d+)?)/i]) }; }
function parseFitness(raw: any) { const text=flattenText(raw); const prediction=(label:string)=>text.match(new RegExp(`${label}\\s*Prediction\\s*[:=]\\s*([^\\n|]+)`,"i"))?.[1]?.trim()||null; return { vo2max:textNumber(raw,["vo2max","vo2Max","runningVo2max"],[/(?:VO2\s*Max|VO₂max|VO2max)\s*[:=]\s*(\d+(?:\.\d+)?)/i]), thresholdPace:textValue(raw,["thresholdPace","lactateThresholdPace","ltPace"],[/(?:Threshold|Lactate\s*Threshold)\s*Pace\s*[:=]\s*([^\n|]+)/i]), thresholdHr:textNumber(raw,["thresholdHeartRate","lactateThresholdHeartRate","thresholdHr","ltHr"],[/(?:Threshold|Lactate\s*Threshold)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]), racePredictions:{"5k":prediction("5\\s*km"),"10k":prediction("10\\s*km"),half:prediction("Half\\s*Marathon"),marathon:prediction("Marathon")} }; }
function parseSleep(raw:any){ const block=latestDatedBlock(raw); const mainSleep=textValue(block.text,["mainSleepDuration","sleepDuration"],[/Main\s*Sleep\s*[:=]\s*([^\n|]+)/i,/(?:Main\s*)?Sleep\s*Duration\s*[:=]\s*([^\n|]+)/i]); return {wake_date:block.date,sleepScore:textNumber(block.text,["sleepScore","sleepQualityScore","score"],[/Sleep\s*Score\s*[:=]\s*(\d+(?:\.\d+)?)/i]),main_sleep:mainSleep,main_sleep_minutes:durationMinutes(mainSleep),deep_ratio:textNumber(block.text,[],[/Deep\s*Sleep\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),light_ratio:textNumber(block.text,[],[/Light\s*Sleep\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i]),rem_ratio:textNumber(block.text,[],[/REM\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i])}; }
function parseHrv(raw:any){ const block=latestDatedBlock(raw); const range=block.text.match(/Normal\s*Range\s*[:=]\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*ms/i); const evalMatch=block.text.match(/HRV\s*Avg\s*[:=]\s*\d+(?:\.\d+)?\s*ms\s*[—-]\s*([^\n|]+)/i); return {wake_date:block.date,avg_ms:textNumber(block.text,["hrvAvg","averageHrv"],[/HRV\s*Avg\s*[:=]\s*(\d+(?:\.\d+)?)/i]),normal_min_ms:range?Number(range[1]):null,normal_max_ms:range?Number(range[2]):null,baseline_ms:textNumber(block.text,["baseline"],[/Baseline\s*[:=]\s*(\d+(?:\.\d+)?)/i]),evaluation:evalMatch?.[1]?.trim()||null}; }
function parseRestingHr(raw:any){ const text=flattenText(raw); const direct=textNumber(raw,["restingHeartRate","restingHr"],[]); if(direct!==null)return direct; const dated=[...text.matchAll(/20\d{2}-\d{2}-\d{2}\s*:\s*(\d+(?:\.\d+)?)\s*bpm/gi)]; return dated.length?Number(dated[0][1]):null; }
function formatDate(date: Date) { return `${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,"0")}${String(date.getUTCDate()).padStart(2,"0")}`; }
function sportName(code:unknown){ const map:Record<number,string>={100:"Course",101:"Course tapis",102:"Trail",103:"Piste",104:"Randonnée",105:"Alpinisme",200:"Vélo",201:"Vélo indoor",202:"Vélo électrique",203:"Gravel",204:"VTT",205:"VTTAE",300:"Natation piscine",301:"Eau libre",400:"Cardio",401:"Cardio GPS",402:"Renforcement",900:"Marche",901:"Corde à sauter",904:"Yoga",905:"Pilates",10000:"Triathlon"}; const numeric=Number(code); return map[numeric]||(Number.isFinite(numeric)?`Sport COROS ${numeric}`:"Activité COROS"); }
function toDate(value:unknown){ const numeric=numberValue(value); if(!numeric||numeric<1_000_000_000)return null; return new Date(numeric>10_000_000_000?numeric:numeric*1000); }
function parseDurationSeconds(value:unknown){ if(typeof value==="number"&&Number.isFinite(value))return Math.round(value); const text=String(value||"").trim(); if(!text)return null; const h=Number(text.match(/(\d+)\s*h/i)?.[1]||0),m=Number(text.match(/(\d+)\s*(?:min|m)\b/i)?.[1]||0),s=Number(text.match(/(\d+)\s*s\b/i)?.[1]||0); if(h||m||s)return h*3600+m*60+s; const colon=text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if(colon)return colon[3]!=null?Number(colon[1])*3600+Number(colon[2])*60+Number(colon[3]):Number(colon[1])*60+Number(colon[2]); return numberValue(text); }
function parseDistanceMeters(value:unknown){ const text=String(value||"").trim(); const numeric=numberValue(value); if(numeric===null)return null; if(/\bkm\b/i.test(text))return Math.round(numeric*1000); if(/\bmi\b/i.test(text))return Math.round(numeric*1609.344); if(/\bm\b/i.test(text))return Math.round(numeric); return numeric>200?Math.round(numeric):Math.round(numeric*1000); }
function paceSeconds(value:unknown){ const match=String(value||"").match(/(\d{1,2}):(\d{2})/); return match?Number(match[1])*60+Number(match[2]):null; }
function structuredActivityRecords(root:any){ const found:any[]=[]; const queue=[root]; const seen=new Set<any>(); while(queue.length){const current=queue.shift();if(!current||typeof current!=="object"||seen.has(current))continue;seen.add(current);if(Array.isArray(current)){queue.push(...current);continue;}const labelId=current.labelId??current.LabelId??current.labelID;const sportType=current.sportType??current.SportType??current.sportTypeCode;if(labelId!=null)found.push({...current,labelId,sportType});queue.push(...Object.values(current).filter((value)=>value&&typeof value==="object"));}const unique=new Map<string,any>();for(const item of found)unique.set(String(item.labelId),item);return [...unique.values()]; }
function textActivityRecords(root:any){ const text=flattenText(root); const matches=[...text.matchAll(/(?:Label\s*Id|labelId)\s*[:=]\s*([A-Za-z0-9_-]+)/gi)]; return matches.map((match,index)=>{const start=index===0?0:(matches[index-1].index||0)+matches[index-1][0].length;const end=index+1<matches.length?(matches[index+1].index||text.length):text.length;const block=text.slice(start,end);return{labelId:match[1],sportType:textNumber(block,[],[/(?:Sport\s*Type(?:\s*Code)?|sportType)\s*[:=]\s*(\d+)/i]),startTimestamp:textNumber(block,[],[/(?:Start\s*Timestamp|startTimestamp)\s*[:=]\s*(\d{9,13})/i]),endTimestamp:textNumber(block,[],[/(?:End\s*Timestamp|endTimestamp)\s*[:=]\s*(\d{9,13})/i]),sportName:textValue(block,["sportName","sportTypeName"],[/(?:Sport\s*Name|Sport|Activity\s*Name|Workout\s*Name)\s*[:=]\s*([^\n|]+)/i]),distance:textValue(block,["distanceKm","distance","totalDistance"],[/Distance\s*[:=]\s*([^\n|]+)/i]),duration:textValue(block,["duration","workoutTime","durationSeconds"],[/(?:Duration|Workout\s*Time)\s*[:=]\s*([^\n|]+)/i]),averagePace:textValue(block,["averagePace","avgPace","pace"],[/(?:Average|Avg)\s*Pace\s*[:=]\s*([^\n|]+)/i,/Pace\s*[:=]\s*([^\n|]+)/i]),averageSpeed:textValue(block,["averageSpeed","avgSpeed"],[/(?:Average|Avg)\s*Speed\s*[:=]\s*([^\n|]+)/i]),avgHr:textNumber(block,["avgHr","averageHeartRate"],[/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),maxHr:textNumber(block,["maxHr","maxHeartRate"],[/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),elevationGain:textNumber(block,["elevationGain","totalAscent"],[/(?:Elevation\s*Gain|Total\s*Ascent)\s*[:=]\s*(\d+(?:\.\d+)?)/i]),trainingLoad:textNumber(block,["trainingLoad"],[/Training\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i]),trainingFocus:textValue(block,["trainingFocus","focus"],[/Training\s*Focus\s*[:=]\s*([^\n|]+)/i]),__rawText:block};}); }
function activityRecords(root:any){const structured=structuredActivityRecords(root);return structured.length?structured:textActivityRecords(root);}
function normalizeActivity(record:any){ const providerId=String(record?.labelId||record?.provider_activity_id||"").trim(); if(!providerId)return null; const sportType=numberValue(record?.sportType??record?.sportTypeCode); return{provider_activity_id:providerId,sport:record?.sportName||record?.sportTypeName||sportName(sportType),sport_type:sportType,started_at:toDate(record?.startTimestamp),ended_at:toDate(record?.endTimestamp),distance_m:parseDistanceMeters(record?.distanceKm??record?.distance??record?.totalDistance),duration_s:parseDurationSeconds(record?.durationSeconds??record?.workoutTimeSeconds??record?.elapsedSeconds??record?.duration??record?.workoutTime),avg_hr:numberValue(record?.avgHr??record?.averageHeartRate??record?.avgHeartRate),max_hr:numberValue(record?.maxHr??record?.maxHeartRate),pace_seconds_per_km:paceSeconds(record?.averagePace??record?.avgPace??record?.pace),avg_speed_kmh:numberValue(record?.averageSpeed??record?.avgSpeed),elevation_gain_m:numberValue(record?.elevationGain??record?.elevationGainM??record?.totalAscent),training_load:numberValue(record?.trainingLoad),training_effect:record?.trainingEffect&&typeof record.trainingEffect==="object"?record.trainingEffect:{},training_focus:record?.trainingFocus||record?.focus||null,raw_provider_data:record?.__rawText?{text:record.__rawText}:record}; }
async function safeTool(token:string,name:string,args:Record<string,unknown>,errors:string[]){try{return await mcpTool(token,name,args);}catch(error){errors.push(`${name}: ${safeMessage(error)}`);return null;}}
async function queryActivities(token:string,startDate:string,endDate:string,timezone:string,errors:string[]){let last:any=null;for(const args of [{startDate,endDate,limit:100,timezone},{startDate,endDate,sportTypeCodes:[65535],limit:100,timezone}]){try{const raw=await mcpTool(token,"querySportRecords",args);last=raw;if(activityRecords(raw).length||/no\s+(?:matching\s+)?(?:workout|sport|activity)\s+records?/i.test(flattenText(raw)))return raw;}catch(error){errors.push(`querySportRecords: ${safeMessage(error)}`);}}return last;}

async function syncCoros(userId:string,syncType="manual"){
  const connection=await row<any>("select * from provider_connections where user_id=? and provider='coros' limit 1",[userId]);
  if(!connection||connection.status!=="connected")throw new Error("COROS n’est pas connecté");
  const syncId=randomUUID();
  await execute("insert into provider_syncs (id,user_id,provider,sync_type,status) values (?,?,'coros',?,'running')",[syncId,userId,syncType]);
  try{
    const accessToken=await loadAccessToken(connection.id);
    const profile=await row<any>("select timezone from user_profiles where user_id=?",[userId]); const timezone=profile?.timezone||"Europe/Paris";
    const today=new Date(),start=new Date(today.getTime()-60*86400_000),errors:string[]=[];
    const activitiesRaw=await queryActivities(accessToken,formatDate(start),formatDate(today),timezone,errors);
    const [recoveryRaw,loadRaw,fitnessRaw,sleepRaw,restingHrRaw,hrvRaw,dailyHealthRaw,devicesRaw]=await Promise.all([
      safeTool(accessToken,"queryRecoveryStatus",{},errors),safeTool(accessToken,"queryTrainingLoadAssessment",{days:14},errors),safeTool(accessToken,"queryFitnessAssessmentOverview",{},errors),safeTool(accessToken,"querySleepData",{startDate:"",endDate:"",days:7,timezone},errors),safeTool(accessToken,"queryRestingHeartRate",{days:7,timezone},errors),safeTool(accessToken,"querySleepHrv",{startDate:"",endDate:"",days:7,timezone},errors),safeTool(accessToken,"queryDailyHealthData",{days:7,timezone},errors),safeTool(accessToken,"queryDevices",{},errors)
    ]);
    const records=activityRecords(activitiesRaw); const normalized=records.map(normalizeActivity).filter(Boolean) as any[];
    for(const activity of normalized){ const id=randomUUID(); await execute(`insert into activities (id,user_id,provider,provider_activity_id,sport,sport_type,started_at,ended_at,distance_m,duration_s,avg_hr,max_hr,pace_seconds_per_km,avg_speed_kmh,elevation_gain_m,training_load,training_effect,training_focus,raw_provider_data) values (?,?,'coros',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on duplicate key update sport=values(sport),sport_type=values(sport_type),started_at=values(started_at),ended_at=values(ended_at),distance_m=values(distance_m),duration_s=values(duration_s),avg_hr=values(avg_hr),max_hr=values(max_hr),pace_seconds_per_km=values(pace_seconds_per_km),avg_speed_kmh=values(avg_speed_kmh),elevation_gain_m=values(elevation_gain_m),training_load=values(training_load),training_effect=values(training_effect),training_focus=values(training_focus),raw_provider_data=values(raw_provider_data)`,[id,userId,activity.provider_activity_id,activity.sport,activity.sport_type,activity.started_at,activity.ended_at,activity.distance_m,activity.duration_s,activity.avg_hr,activity.max_hr,activity.pace_seconds_per_km,activity.avg_speed_kmh,activity.elevation_gain_m,activity.training_load,JSON.stringify(activity.training_effect),activity.training_focus,JSON.stringify(activity.raw_provider_data)]); }
    const recovery=parseRecovery(recoveryRaw),load=parseLoad(loadRaw),fitness=parseFitness(fitnessRaw),sleep=parseSleep(sleepRaw),hrv=parseHrv(hrvRaw),restingHr=parseRestingHr(restingHrRaw);
    await execute("insert into fitness_snapshots (id,user_id,provider,recovery,sleep,hrv,resting_hr,short_load,long_load,load_ratio,vo2max,threshold_pace,threshold_hr,race_predictions,raw_provider_data) values (?,?,'coros',?,?,?,?,?,?,?,?,?,?,?,?)",[randomUUID(),userId,recovery,JSON.stringify(sleep),JSON.stringify(hrv),restingHr,load.short,load.long,load.ratio,fitness.vo2max,fitness.thresholdPace,fitness.thresholdHr,JSON.stringify(fitness.racePredictions),JSON.stringify({recovery:recoveryRaw,load:loadRaw,fitness:fitnessRaw,sleep:sleepRaw,restingHeartRate:restingHrRaw,sleepHrv:hrvRaw,dailyHealth:dailyHealthRaw})]);
    const activityText=flattenText(activitiesRaw); const explicitEmpty=/no\s+(?:matching\s+)?(?:workout|sport|activity)\s+records?/i.test(activityText); if(!normalized.length&&activityText.trim()&&!explicitEmpty)errors.push("querySportRecords: réponse reçue mais aucun identifiant d’activité n’a pu être normalisé");
    const status=errors.length?"partial":"success"; const metadata={...(connection.metadata||{}),devices:devicesRaw||null,last_sync_window_days:60,bridge_version:3};
    await execute("update provider_connections set status='connected',last_sync_at=utc_timestamp(3),last_error=?,metadata=? where id=? and user_id=?",[errors.length?errors.join(" | ").slice(0,2000):null,JSON.stringify(metadata),connection.id,userId]);
    await execute("update provider_syncs set status=?,completed_at=utc_timestamp(3),imported_activities=?,details=?,error_message=? where id=? and user_id=?",[status,normalized.length,JSON.stringify({activity_records:records.length,activity_text_length:activityText.length,errors,window_days:60,normalized_metrics:{recovery:recovery!==null,sleep:sleep.sleepScore!==null,hrv:hrv.avg_ms!==null,short_load:load.short!==null,vo2max:fitness.vo2max!==null}}),errors.length?errors.join(" | ").slice(0,4000):null,syncId,userId]);
    return{status,importedActivities:normalized.length,metrics:{recovery,sleepScore:sleep.sleepScore,hrv:hrv.avg_ms,shortLoad:load.short,loadRatio:load.ratio,vo2max:fitness.vo2max,thresholdPace:fitness.thresholdPace},warnings:errors};
  }catch(error){const message=safeMessage(error);await execute("update provider_syncs set status='error',completed_at=utc_timestamp(3),error_message=? where id=? and user_id=?",[message,syncId,userId]);await execute("update provider_connections set last_error=? where id=? and user_id=?",[message,connection.id,userId]);throw error;}
}

async function disconnectCoros(userId:string){const connection=await row<any>("select id from provider_connections where user_id=? and provider='coros'",[userId]);if(!connection)return{disconnected:true};await execute("delete from provider_credentials where provider_connection_id=?",[connection.id]);await execute("delete from provider_oauth_states where user_id=? and provider='coros'",[userId]);await execute("update provider_connections set status='disconnected',last_error=null,scopes='[]' where id=? and user_id=?",[connection.id,userId]);return{disconnected:true};}

export async function callCorosBridge(action: CorosAction, payload: Record<string, unknown> = {}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Session Frog Pace expirée. Reconnecte-toi.");
  if (action === "start") return startOAuth(user.id, payload.redirectUri);
  if (action === "finish") return finishOAuth(user.id, payload.code, payload.state);
  if (action === "sync") return syncCoros(user.id, String(payload.syncType || "manual"));
  if (action === "disconnect") return disconnectCoros(user.id);
  throw new Error("Action COROS inconnue");
}
