import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { execute, row } from "@/lib/db";

const COROS_ISSUER = "https://mcpeu.coros.com";
const COROS_MCP_URL = "https://mcpeu.coros.com/mcp";
let rpcId = 1000;

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Erreur"))
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

async function exchangeToken(form: Record<string, string>) {
  const response = await fetch(`${COROS_ISSUER}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form),
    cache: "no-store",
  });
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) throw new Error(`Token COROS: ${body?.error_description || body?.error || body?.message || text || response.status}`);
  return body;
}

async function storeCredentials(connectionId: string, clientId: string, token: any) {
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000);
  const existing = await row<any>("select refresh_token_encrypted from provider_credentials where provider_connection_id=?", [connectionId]);
  const access = encryptSecret(token.access_token || null);
  const refresh = token.refresh_token ? encryptSecret(token.refresh_token) : existing?.refresh_token_encrypted || null;
  const client = encryptSecret(clientId);
  if (existing) {
    await execute("update provider_credentials set client_id_encrypted=?,access_token_encrypted=?,refresh_token_encrypted=?,expires_at=?,scope=?,token_type=? where provider_connection_id=?", [client, access, refresh, expiresAt, token.scope || null, token.token_type || "Bearer", connectionId]);
  } else {
    await execute("insert into provider_credentials (provider_connection_id,client_id_encrypted,access_token_encrypted,refresh_token_encrypted,expires_at,scope,token_type) values (?,?,?,?,?,?,?)", [connectionId, client, access, refresh, expiresAt, token.scope || null, token.token_type || "Bearer"]);
  }
}

export async function getCorosConnection(userId: string) {
  const connection = await row<any>("select * from provider_connections where user_id=? and provider='coros' limit 1", [userId]);
  if (!connection || connection.status !== "connected") throw new Error("COROS n’est pas connecté");
  return connection;
}

export async function getCorosAccessToken(userId: string) {
  const connection = await getCorosConnection(userId);
  const credentials = await row<any>("select * from provider_credentials where provider_connection_id=?", [connection.id]);
  if (!credentials) throw new Error("Identifiants COROS introuvables");
  const clientId = decryptSecret(credentials.client_id_encrypted);
  const refreshToken = decryptSecret(credentials.refresh_token_encrypted);
  const accessToken = decryptSecret(credentials.access_token_encrypted);
  if (!clientId || !refreshToken) throw new Error("Identifiants COROS incomplets");
  const expiry = credentials.expires_at ? new Date(String(credentials.expires_at).replace(" ", "T") + "Z").getTime() : 0;
  if (accessToken && expiry > Date.now() + 60_000) return { accessToken, connection };
  const token = await exchangeToken({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
  if (!token.access_token) throw new Error("COROS n’a pas renouvelé le jeton d’accès");
  await storeCredentials(connection.id, clientId, token);
  return { accessToken: String(token.access_token), connection };
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
  for (let i = payloads.length - 1; i >= 0; i--) {
    try { return JSON.parse(payloads[i]); } catch { /* continue */ }
  }
  throw new Error("Réponse MCP COROS illisible");
}

export async function corosMcpRpc(accessToken: string, method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(COROS_MCP_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 240)}`);
  const payload = parseSseOrJson(text, response.headers.get("content-type"));
  if (payload?.error) throw new Error(payload.error.message || "Erreur MCP COROS");
  return payload;
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") return value;
  let text = value.trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); } catch { return value; }
}

export async function corosMcpTool(accessToken: string, name: string, args: Record<string, unknown> = {}) {
  await corosMcpRpc(accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Frog Pace", version: "3.0.0" } });
  const payload = await corosMcpRpc(accessToken, "tools/call", { name, arguments: args });
  const result = payload?.result;
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const values = (Array.isArray(result.content) ? result.content : [])
    .filter((item: any) => item && typeof item.text === "string")
    .map((item: any) => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length) return values;
  return result;
}

export async function listCorosTools(accessToken: string) {
  await corosMcpRpc(accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Frog Pace", version: "3.0.0" } });
  const payload = await corosMcpRpc(accessToken, "tools/list", {});
  return Array.isArray(payload?.result?.tools) ? payload.result.tools : [];
}

export { safeMessage };
