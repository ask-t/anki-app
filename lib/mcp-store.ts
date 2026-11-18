import type { SupabaseClient } from "@supabase/supabase-js";

export type Grant = {
  code_hash: string; request_hash: string; client_id: string; user_id: string;
  redirect_uri: string; resource: string; scope: string; code_challenge: string;
  expires_at: string; consumed_at: string | null;
};
export type TokenSession = {
  access_hash: string; refresh_hash: string; client_id: string; user_id: string;
  resource: string; scope: string; access_expires_at: string; refresh_expires_at: string;
};
export interface McpStore {
  saveGrant(grant: Grant): Promise<boolean>;
  findGrant(hash: string): Promise<Grant | null>;
  consumeGrant(hash: string, now: string): Promise<boolean>;
  createSession(session: TokenSession): Promise<void>;
  findSession(hash: string): Promise<TokenSession | null>;
  rotateSession(hash: string, session: TokenSession, now: string): Promise<TokenSession | null>;
  revoke(hash: string, userId?: string): Promise<void>;
}

export function createMcpStore(admin: SupabaseClient): McpStore {
  return {
    async saveGrant(grant) {
      // Expired requests cannot be approved again: their signed consent also expires.
      const cleanup = await admin.from("mcp_oauth_grants").delete().lt("expires_at", new Date(Date.now() - 3600_000).toISOString());
      if (cleanup.error) throw new Error("OAuth storage unavailable");
      const { error } = await admin.from("mcp_oauth_grants").insert(grant);
      if (error?.code === "23505") return false;
      if (error) throw new Error("OAuth storage unavailable");
      return true;
    },
    async findGrant(hash) {
      const { data, error } = await admin.from("mcp_oauth_grants").select("*").eq("code_hash", hash).maybeSingle();
      if (error) throw new Error("OAuth storage unavailable");
      return data;
    },
    async consumeGrant(hash, now) {
      // Conditional UPDATE is atomic: concurrent exchanges cannot consume twice.
      const { data, error } = await admin.from("mcp_oauth_grants").update({ consumed_at: now })
        .eq("code_hash", hash).is("consumed_at", null).gt("expires_at", now).select("code_hash");
      if (error) throw new Error("OAuth storage unavailable");
      return data?.length === 1;
    },
    async createSession(session) {
      const { error } = await admin.from("mcp_oauth_sessions").insert(session);
      if (error) throw new Error("OAuth storage unavailable");
    },
    async findSession(hash) {
      const { data, error } = await admin.from("mcp_oauth_sessions").select("*").eq("access_hash", hash).maybeSingle();
      if (error) throw new Error("OAuth storage unavailable");
      return data;
    },
    async rotateSession(hash, session, now) {
      const { data, error } = await admin.from("mcp_oauth_sessions").update(session)
        .eq("refresh_hash", hash).eq("client_id", session.client_id).eq("user_id", session.user_id)
        .eq("resource", session.resource).eq("scope", session.scope)
        .gt("refresh_expires_at", now).select("*").maybeSingle();
      if (error) throw new Error("OAuth storage unavailable");
      return data;
    },
    async revoke(hash, userId) {
      if (userId) {
        const { error } = await admin.from("mcp_oauth_grants").delete().eq("user_id", userId);
        if (error) throw new Error("OAuth storage unavailable");
      }
      let query = admin.from("mcp_oauth_sessions").delete();
      query = userId ? query.eq("user_id", userId) : query.or(`access_hash.eq.${hash},refresh_hash.eq.${hash}`);
      const { error } = await query;
      if (error) throw new Error("OAuth storage unavailable");
    },
  };
}
