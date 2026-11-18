import { createClient } from "@supabase/supabase-js";
import { getMcpConfig } from "./mcp-config.ts";
import { assertMcpReady, authChallenge, OAuthFailure, oauthError } from "./mcp-oauth.ts";
import { createMcpStore } from "./mcp-store.ts";

export function mcpRuntime() {
  const config = getMcpConfig();
  assertMcpReady(config);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new OAuthFailure("temporarily_unavailable", "MCP接続のサーバー設定が不足しています", 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return { config, admin, store: createMcpStore(admin) };
}
export async function mcpRoute(work: () => Response | Promise<Response>) {
  try { return await work(); }
  catch (error) {
    const response = oauthError(error);
    if (response.status === 401) response.headers.set("WWW-Authenticate", authChallenge(getMcpConfig()));
    return response;
  }
}
