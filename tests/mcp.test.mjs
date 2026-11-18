import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpSetupErrors } from "../lib/mcp-config.ts";
import {
  authorize, approveConsent, authChallenge, exchangeToken, oauthError, oauthMetadata,
  protectedMetadata, readConsent, requireOwner, revokeToken, tokenHash, verifyMcpToken,
} from "../lib/mcp-oauth.ts";
import { handleMcpRequest } from "../lib/mcp-server.ts";

const config = {
  enabled: true, baseUrl: "https://tango.example", clientId: "tango-chatgpt", clientSecret: "a".repeat(64),
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect", userId: "00000000-0000-4000-8000-000000000001",
};
const verifier = "correct-verifier-".repeat(4);
const card = { external_id: "vocab:be-wise", word: "be wise", japanese_meaning: "賢明である" };

function memoryStore() {
  const grants = new Map();
  const sessions = new Map();
  return {
    grants, sessions,
    async saveGrant(grant) {
      if ([...grants.values()].some((row) => row.request_hash === grant.request_hash)) return false;
      grants.set(grant.code_hash, { ...grant }); return true;
    },
    async findGrant(hash) { return grants.get(hash) || null; },
    async consumeGrant(hash, now) {
      const grant = grants.get(hash);
      if (!grant || grant.consumed_at || grant.expires_at <= now) return false;
      grant.consumed_at = now; return true;
    },
    async createSession(session) { sessions.set(session.access_hash, session); },
    async findSession(hash) { return sessions.get(hash) || null; },
    async rotateSession(hash, next, now) {
      const previous = [...sessions.values()].find((session) => session.refresh_hash === hash
        && session.client_id === next.client_id && session.user_id === next.user_id
        && session.resource === next.resource && session.scope === next.scope && session.refresh_expires_at > now);
      if (!previous) return null;
      sessions.delete(previous.access_hash); sessions.set(next.access_hash, next); return next;
    },
    async revoke(hash, userId) {
      for (const [key, row] of sessions) if (userId ? row.user_id === userId : [row.access_hash, row.refresh_hash].includes(hash)) sessions.delete(key);
    },
  };
}
function authorization(overrides = {}) {
  const url = new URL("/oauth/authorize", config.baseUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "cards:write",
    resource: `${config.baseUrl}/mcp`, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), state: "opaque-client-state", ...overrides,
  }).toString();
  return new Request(url);
}
function tokenRequest(overrides = {}, headers = {}) {
  return new Request(`${config.baseUrl}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      grant_type: "authorization_code", redirect_uri: config.redirectUri, resource: `${config.baseUrl}/mcp`, code_verifier: verifier, ...overrides }),
  });
}
async function grant(store) {
  const response = authorize(config, authorization());
  assert.equal(response.status, 302);
  const signed = new URL(response.headers.get("location")).searchParams.get("request");
  const callback = new URL(await approveConsent(config, store, config.userId, signed, true));
  assert.equal(callback.origin + callback.pathname, config.redirectUri);
  assert.equal(callback.searchParams.get("state"), "opaque-client-state");
  assert.equal(callback.searchParams.get("iss"), config.baseUrl);
  return { signed, code: callback.searchParams.get("code") };
}
async function login(store) {
  const { code } = await grant(store);
  return (await exchangeToken(config, store, tokenRequest({ code }))).json();
}
function bearer(token) { return new Request(`${config.baseUrl}/mcp`, { headers: { Authorization: `Bearer ${token}` } }); }

test("OAuth metadata binds one resource, uses PKCE, and advertises preregistered confidential clients", () => {
  assert.deepEqual(mcpSetupErrors(config), []);
  assert.equal(protectedMetadata(config).resource, `${config.baseUrl}/mcp`);
  const metadata = oauthMetadata(config);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(metadata.registration_endpoint, undefined);
  assert.ok(!JSON.stringify(metadata).includes(config.clientSecret));
  assert.match(authChallenge(config), /scope="cards:write"/);
  for (const overrides of [{ enabled: false }, { baseUrl: "https://bad.example/path" }, { clientSecret: "short" }, { redirectUri: "https://client.example/#fragment" }]) {
    assert.throws(() => oauthMetadata({ ...config, ...overrides }));
  }
});

test("unregistered callbacks and clients never redirect", () => {
  for (const overrides of [{ redirect_uri: "https://evil.example/" }, { client_id: "other-client" }]) {
    assert.throws(() => authorize(config, authorization(overrides)), { code: "invalid_request" });
  }
});

test("authorization errors include issuer and state, and never accept plain PKCE or another resource", () => {
  for (const overrides of [{ code_challenge_method: "plain" }, { resource: "https://elsewhere.example/mcp" }, { scope: "admin" }]) {
    const url = new URL(authorize(config, authorization(overrides)).headers.get("location"));
    assert.equal(url.origin + url.pathname, config.redirectUri);
    assert.ok(url.searchParams.has("error"));
    assert.equal(url.searchParams.get("iss"), config.baseUrl);
    assert.equal(url.searchParams.get("state"), "opaque-client-state");
  }
  const duplicate = new URL(authorization().url); duplicate.searchParams.append("resource", "https://evil.example/");
  assert.throws(() => authorize(config, new Request(duplicate)), { code: "invalid_request" });
});

test("consent cannot be altered, reused, or approved by a different user; denial issues no code", async () => {
  const store = memoryStore();
  const { signed } = await grant(store);
  assert.throws(() => readConsent(config, signed + "tampered"), { code: "invalid_request" });
  await assert.rejects(approveConsent(config, store, "other-user", signed, true), { code: "access_denied" });
  await assert.rejects(approveConsent(config, store, config.userId, signed, true), { code: "invalid_request" });
  const denied = new URL(await approveConsent(config, store, config.userId, signed, false));
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("iss"), config.baseUrl);
  assert.equal(denied.searchParams.get("code"), null);
  assert.ok(!JSON.stringify([...store.grants.values()]).includes(signed));
});

test("consent verifies the signed-in owner and confirmed email on the server", async () => {
  for (const [id, confirmed, status] of [[config.userId, true, 200], ["other-user", true, 403], [config.userId, false, 403]]) {
    const admin = createClient("https://auth.example", "test-key", { auth: { persistSession: false }, global: {
      fetch: async () => Response.json({ id, email: "owner@example.com", email_confirmed_at: confirmed ? "2026-01-01" : null }),
    } });
    if (status === 200) assert.equal((await requireOwner(config, admin, bearer("test-supabase-session"))).id, config.userId);
    else await assert.rejects(requireOwner(config, admin, bearer("test-supabase-session")), { status });
    await assert.rejects(requireOwner(config, admin, new Request(config.baseUrl)), { status: 401 });
    if (status === 200) await assert.rejects(requireOwner(config, admin, new Request(config.baseUrl, { headers: { Authorization: "Bearer test", Origin: "https://evil.example" } })), { status: 403 });
  }
});

test("consent requests and authorization codes expire", async (t) => {
  const store = memoryStore();
  const { signed, code } = await grant(store);
  store.grants.get(tokenHash(code)).expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(exchangeToken(config, store, tokenRequest({ code })), { code: "invalid_grant" });
  const future = Date.now() + 601_000;
  t.mock.method(Date, "now", () => future);
  assert.throws(() => readConsent(config, signed), { code: "invalid_request" });
  assert.equal(store.sessions.size, 0);
});

test("token exchange requires client secret, exact callback, resource, PKCE and a fresh code", async () => {
  const store = memoryStore();
  const { code } = await grant(store);
  for (const overrides of [{ client_secret: "wrong" }, { code_verifier: "wrong" }, { redirect_uri: "https://evil.example/" }, { resource: "https://evil.example/mcp" }]) {
    await assert.rejects(exchangeToken(config, store, tokenRequest({ code, ...overrides })));
    assert.equal(store.sessions.size, 0);
  }
  const tokens = await (await exchangeToken(config, store, tokenRequest({ code }))).json();
  assert.equal((await verifyMcpToken(config, store, bearer(tokens.access_token))).clientId, config.clientId);
  await assert.rejects(exchangeToken(config, store, tokenRequest({ code })), { code: "invalid_grant" });
  assert.equal(store.sessions.size, 1);
  for (const row of store.sessions.values()) {
    assert.ok(!JSON.stringify(row).includes(tokens.access_token));
    assert.ok(!JSON.stringify(row).includes(tokens.refresh_token));
  }
});

test("concurrent exchanges yield at most one access token", async () => {
  const store = memoryStore();
  const { code } = await grant(store);
  const results = await Promise.allSettled([exchangeToken(config, store, tokenRequest({ code })), exchangeToken(config, store, tokenRequest({ code }))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(store.sessions.size, 1);
});

test("refresh rotates both tokens; old tokens and privilege changes are rejected", async () => {
  const store = memoryStore();
  const tokens = await login(store);
  const params = { grant_type: "refresh_token", refresh_token: tokens.refresh_token };
  await assert.rejects(exchangeToken(config, store, tokenRequest({ ...params, scope: "admin" })), { code: "invalid_scope" });
  const rotated = await (await exchangeToken(config, store, tokenRequest(params))).json();
  assert.notEqual(rotated.access_token, tokens.access_token);
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  await assert.rejects(verifyMcpToken(config, store, bearer(tokens.access_token)), { status: 401 });
  await assert.rejects(exchangeToken(config, store, tokenRequest(params)), { code: "invalid_grant" });
  assert.equal((await verifyMcpToken(config, store, bearer(rotated.access_token))).scopes[0], "cards:write");
});

test("access tokens reject expiry, changed owner, client and resource", async () => {
  for (const overrides of [{ access_expires_at: "2000-01-01" }, { user_id: "other" }, { client_id: "other" }, { resource: "https://evil.example/mcp" }, { scope: "admin" }]) {
    const store = memoryStore();
    const tokens = await login(store);
    Object.assign(store.sessions.get(tokenHash(tokens.access_token)), overrides);
    await assert.rejects(verifyMcpToken(config, store, bearer(tokens.access_token)), { status: 401 });
  }
  await assert.rejects(verifyMcpToken(config, memoryStore(), bearer("wrong")), { status: 401 });
});

test("OAuth revocation supports confidential Basic auth and invalidates access and refresh", async () => {
  const store = memoryStore();
  const tokens = await login(store);
  const body = new URLSearchParams({ token: tokens.refresh_token });
  const request = () => new Request(`${config.baseUrl}/oauth/revoke`, { method: "POST", headers: {
    "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
  }, body });
  assert.equal((await revokeToken(config, store, request())).status, 200);
  assert.equal((await revokeToken(config, store, request())).status, 200);
  await assert.rejects(verifyMcpToken(config, store, bearer(tokens.access_token)), { status: 401 });
  await assert.rejects(exchangeToken(config, store, tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token })), { code: "invalid_grant" });
});

test("official MCP client discovers one write tool, imports vocabulary, and cannot change another user's review data", async () => {
  const store = memoryStore();
  const tokens = await login(store);
  const writes = [];
  const admin = createClient("https://db.example", "server-secret", { auth: { persistSession: false }, global: {
    fetch: async (url, init) => { writes.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); },
  } });
  const client = new Client({ name: "tango-protocol-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${config.baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    fetch: async (url, init) => {
      const request = new Request(url, init);
      try { await verifyMcpToken(config, store, request); return await handleMcpRequest(config, admin, request); }
      catch (error) { return oauthError(error); }
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["import_vocabulary"]);
    assert.equal(tools[0].annotations.readOnlyHint, false);
    assert.equal(tools[0].annotations.destructiveHint, true);
    assert.deepEqual(tools[0]._meta.securitySchemes[0].scopes, ["cards:write"]);
    const result = await client.callTool({ name: "import_vocabulary", arguments: { cards: [card] } });
    assert.equal(result.structuredContent.total, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].user_id, config.userId);
    assert.ok(!Object.keys(writes[0][0]).includes("due_at"));
    for (const extra of [{ user_id: "other" }, { repetitions: 999 }, { due_at: "2099-01-01" }]) {
      const denied = await client.callTool({ name: "import_vocabulary", arguments: { cards: [{ ...card, ...extra }] } });
      assert.equal(denied.isError, true);
    }
    const duplicate = await client.callTool({ name: "import_vocabulary", arguments: { cards: [card, card] } });
    assert.equal(duplicate.isError, true);
    await assert.rejects(client.callTool({ name: "execute_sql", arguments: { query: "delete from cards" } }));
    assert.equal(writes.length, 1);
    const grouped = await client.callTool({ name: "import_vocabulary", arguments: { cards: [card], folder_name: "英検", set_name: "基本" } });
    assert.equal(grouped.structuredContent.folder_name, "英検");
    assert.equal(grouped.structuredContent.set_name, "基本");
    assert.equal(writes[1].p_user_id, config.userId);
    assert.equal(writes[1].p_cards[0].external_id, card.external_id);
    const incomplete = await client.callTool({ name: "import_vocabulary", arguments: { cards: [card], folder_name: "英検" } });
    assert.equal(incomplete.isError, true);
    assert.equal(writes.length, 2);
  } finally { await client.close(); }
});
