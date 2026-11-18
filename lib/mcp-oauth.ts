import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { McpConfig } from "./mcp-config.ts";
import { MCP_SCOPE, mcpSetupErrors } from "./mcp-config.ts";
import type { McpStore, TokenSession } from "./mcp-store.ts";

const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 30 * 24 * 3600;
const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const equals = (a: string, b: string) => timingSafeEqual(Buffer.from(tokenHash(a)), Buffer.from(tokenHash(b)));
export type ConsentRequest = {
  nonce: string; exp: number; client_id: string; redirect_uri: string;
  resource: string; scope: string; code_challenge: string; state?: string;
};

export class OAuthFailure extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export function oauthJson(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: {
    "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", ...headers,
  } });
}
export function oauthError(error: unknown) {
  if (error instanceof OAuthFailure) return oauthJson({ error: error.code, error_description: error.message }, error.status);
  console.error("MCP authorization request failed");
  return oauthJson({ error: "server_error", error_description: "認証処理に失敗しました" }, 500);
}
export function assertMcpReady(config: McpConfig) {
  if (!config.enabled || mcpSetupErrors(config).length) throw new OAuthFailure("temporarily_unavailable", "MCP接続はまだ設定されていません", 503);
}
export function oauthMetadata(config: McpConfig) {
  assertMcpReady(config);
  return {
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    revocation_endpoint: `${config.baseUrl}/oauth/revoke`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], scopes_supported: [MCP_SCOPE],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
  };
}
export function protectedMetadata(config: McpConfig) {
  assertMcpReady(config);
  return { resource: `${config.baseUrl}/mcp`, authorization_servers: [config.baseUrl], scopes_supported: [MCP_SCOPE], resource_name: "Anki App 単語登録" };
}
export function authChallenge(config: McpConfig) {
  return `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`;
}

function signature(config: McpConfig, payload: string) {
  return createHmac("sha256", config.clientSecret).update(`tango-consent-v1:${payload}`).digest("base64url");
}
export function readConsent(config: McpConfig, signed: string): ConsentRequest {
  assertMcpReady(config);
  if (signed.length > 12_000) throw new OAuthFailure("invalid_request", "接続リクエストが不正です");
  const [payload, sig, extra] = signed.split(".");
  if (!payload || !sig || extra || !equals(sig, signature(config, payload))) throw new OAuthFailure("invalid_request", "接続リクエストが不正です");
  let data: ConsentRequest;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new OAuthFailure("invalid_request", "接続リクエストが不正です"); }
  if (data.exp <= Date.now() / 1000 || data.client_id !== config.clientId || data.redirect_uri !== config.redirectUri
    || data.resource !== `${config.baseUrl}/mcp` || data.scope !== MCP_SCOPE) {
    throw new OAuthFailure("invalid_request", "接続リクエストの有効期限が切れています。ChatGPTから接続し直してください");
  }
  return data;
}
function callback(config: McpConfig, consent: Pick<ConsentRequest, "redirect_uri" | "state">, values: Record<string, string>) {
  const url = new URL(consent.redirect_uri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  url.searchParams.set("iss", config.baseUrl);
  if (consent.state !== undefined) url.searchParams.set("state", consent.state);
  return url.href;
}
function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function unique(params: URLSearchParams) {
  for (const key of params.keys()) if (params.getAll(key).length !== 1) throw new OAuthFailure("invalid_request", "同じパラメーターを複数指定できません");
}
export function authorize(config: McpConfig, request: Request) {
  assertMcpReady(config);
  const params = new URL(request.url).searchParams;
  unique(params);
  if (params.get("client_id") !== config.clientId || params.get("redirect_uri") !== config.redirectUri) {
    throw new OAuthFailure("invalid_request", "接続先またはコールバックURLが不正です");
  }
  const state = params.get("state") ?? undefined;
  try {
    if (request.url.length > 10_000 || (state?.length || 0) > 2048) throw new OAuthFailure("invalid_request", "リクエストが大きすぎます");
    if (params.get("response_type") !== "code") throw new OAuthFailure("unsupported_response_type", "認証コード方式を指定してください");
    const challenge = params.get("code_challenge") || "";
    if (params.get("code_challenge_method") !== "S256" || !/^[a-z\d_-]{43}$/i.test(challenge)) throw new OAuthFailure("invalid_request", "PKCE S256が必要です");
    if (params.get("resource") !== `${config.baseUrl}/mcp`) throw new OAuthFailure("invalid_target", "resourceが接続先と一致しません");
    if (params.get("scope") !== MCP_SCOPE) throw new OAuthFailure("invalid_scope", "単語登録権限を指定してください");
    const consent: ConsentRequest = {
      nonce: randomToken(), exp: Math.floor(Date.now() / 1000) + 600,
      client_id: config.clientId, redirect_uri: config.redirectUri, resource: `${config.baseUrl}/mcp`,
      scope: MCP_SCOPE, code_challenge: challenge, ...(state === undefined ? {} : { state }),
    };
    const payload = Buffer.from(JSON.stringify(consent)).toString("base64url");
    const url = new URL("/oauth/consent", config.baseUrl);
    url.searchParams.set("request", `${payload}.${signature(config, payload)}`);
    return redirect(url.href);
  } catch (error) {
    if (!(error instanceof OAuthFailure)) throw error;
    return redirect(callback(config, { redirect_uri: config.redirectUri, state }, { error: error.code, error_description: error.message }));
  }
}

async function limitedText(request: Request, limit = 16_384) {
  const reader = request.body?.getReader();
  if (!reader) throw new OAuthFailure("invalid_request", "本文が必要です");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new OAuthFailure("invalid_request", "本文が大きすぎます", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function readOAuthJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new OAuthFailure("invalid_request", "JSON形式で送信してください", 415);
  try { return JSON.parse(await limitedText(request)); }
  catch (error) { if (error instanceof OAuthFailure) throw error; throw new OAuthFailure("invalid_request", "JSON形式が不正です"); }
}
export async function requireOwner(config: McpConfig, admin: SupabaseClient, request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || token.length > 16_384) throw new OAuthFailure("access_denied", "アプリにログインしてください", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user || data.user.id !== config.userId || !data.user.email_confirmed_at) {
    throw new OAuthFailure("access_denied", "単語の保存先アカウントでログインしてください", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== config.baseUrl) throw new OAuthFailure("access_denied", "接続元が不正です", 403);
  return data.user;
}
export async function approveConsent(config: McpConfig, store: McpStore, userId: string, signed: string, approve: boolean) {
  const consent = readConsent(config, signed);
  if (userId !== config.userId) throw new OAuthFailure("access_denied", "保存先アカウントが一致しません", 403);
  if (!approve) return callback(config, consent, { error: "access_denied" });
  const code = randomToken();
  const saved = await store.saveGrant({
    code_hash: tokenHash(code), request_hash: tokenHash(consent.nonce), client_id: consent.client_id,
    user_id: userId, redirect_uri: consent.redirect_uri, resource: consent.resource, scope: consent.scope,
    code_challenge: consent.code_challenge, expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null,
  });
  if (!saved) throw new OAuthFailure("invalid_request", "この接続リクエストは使用済みです。ChatGPTから接続し直してください");
  return callback(config, consent, { code });
}
async function clientParams(config: McpConfig, request: Request) {
  assertMcpReady(config);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") {
    throw new OAuthFailure("invalid_request", "フォーム形式で送信してください", 415);
  }
  const params = new URLSearchParams(await limitedText(request));
  unique(params);
  let clientId = params.get("client_id") || "";
  let secret = params.get("client_secret") || "";
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (params.has("client_secret") || !authorization.startsWith("Basic ")) throw new OAuthFailure("invalid_client", "クライアント認証が不正です", 401);
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) throw new Error();
      const basicId = decodeURIComponent(decoded.slice(0, colon));
      if (clientId && clientId !== basicId) throw new Error();
      clientId = basicId;
      secret = decodeURIComponent(decoded.slice(colon + 1));
    } catch { throw new OAuthFailure("invalid_client", "クライアント認証が不正です", 401); }
  }
  if (clientId !== config.clientId || !equals(secret, config.clientSecret)) throw new OAuthFailure("invalid_client", "クライアント認証が不正です", 401);
  return params;
}
function sessionTokens(config: McpConfig) {
  const access = randomToken();
  const refresh = randomToken();
  const session: TokenSession = {
    access_hash: tokenHash(access), refresh_hash: tokenHash(refresh), client_id: config.clientId, user_id: config.userId,
    resource: `${config.baseUrl}/mcp`, scope: MCP_SCOPE,
    access_expires_at: new Date(Date.now() + ACCESS_SECONDS * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + REFRESH_SECONDS * 1000).toISOString(),
  };
  return { session, response: { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: MCP_SCOPE } };
}
export async function exchangeToken(config: McpConfig, store: McpStore, request: Request) {
  const params = await clientParams(config, request);
  if (params.get("resource") !== `${config.baseUrl}/mcp`) throw new OAuthFailure("invalid_target", "resourceが接続先と一致しません");
  const tokens = sessionTokens(config);
  if (params.get("grant_type") === "authorization_code") {
    const code = params.get("code") || "";
    if (!/^[a-z\d_-]{43}$/i.test(code)) throw new OAuthFailure("invalid_grant", "認証コードが不正です");
    const grant = await store.findGrant(tokenHash(code));
    const verifier = params.get("code_verifier") || "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!grant || grant.consumed_at || Date.parse(grant.expires_at) <= Date.now() || grant.client_id !== config.clientId
      || grant.user_id !== config.userId || grant.resource !== tokens.session.resource || grant.scope !== MCP_SCOPE
      || grant.redirect_uri !== params.get("redirect_uri") || !/^[a-z\d._~-]{43,128}$/i.test(verifier) || !equals(challenge, grant.code_challenge)) {
      throw new OAuthFailure("invalid_grant", "認証コードまたはPKCE検証が不正です");
    }
    if (!await store.consumeGrant(tokenHash(code), new Date().toISOString())) throw new OAuthFailure("invalid_grant", "認証コードは使用済みです");
    await store.createSession(tokens.session);
  } else if (params.get("grant_type") === "refresh_token") {
    if (params.has("scope") && params.get("scope") !== MCP_SCOPE) throw new OAuthFailure("invalid_scope", "権限を変更できません");
    const refresh = params.get("refresh_token") || "";
    if (!/^[a-z\d_-]{43}$/i.test(refresh) || !await store.rotateSession(tokenHash(refresh), tokens.session, new Date().toISOString())) {
      throw new OAuthFailure("invalid_grant", "更新トークンが無効です。接続し直してください");
    }
  } else throw new OAuthFailure("unsupported_grant_type", "未対応の認証方式です");
  return oauthJson(tokens.response);
}
export async function verifyMcpToken(config: McpConfig, store: McpStore, request: Request) {
  assertMcpReady(config);
  const token = request.headers.get("authorization")?.match(/^Bearer\s+([a-z\d_-]{43})$/i)?.[1];
  const session = token ? await store.findSession(tokenHash(token)) : null;
  if (!session || session.client_id !== config.clientId || session.user_id !== config.userId || session.resource !== `${config.baseUrl}/mcp`
    || session.scope !== MCP_SCOPE || Date.parse(session.access_expires_at) <= Date.now()) {
    throw new OAuthFailure("invalid_token", "ChatGPTから接続してログインしてください", 401);
  }
  return { token: token!, clientId: session.client_id, scopes: [MCP_SCOPE], resource: new URL(session.resource), expiresAt: Date.parse(session.access_expires_at) / 1000 };
}
export async function revokeToken(config: McpConfig, store: McpStore, request: Request) {
  const params = await clientParams(config, request);
  await store.revoke(tokenHash(params.get("token") || ""));
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
