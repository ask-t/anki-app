import { mcpRoute, mcpRuntime } from "@/lib/mcp-runtime";
import { approveConsent, OAuthFailure, oauthJson, readOAuthJson, requireOwner } from "@/lib/mcp-oauth";
export const runtime = "nodejs";
export function POST(request: Request) {
  return mcpRoute(async () => {
    const { config, admin, store } = mcpRuntime();
    const user = await requireOwner(config, admin, request);
    const body = await readOAuthJson(request);
    if (!body || typeof body.request !== "string" || typeof body.approve !== "boolean") throw new OAuthFailure("invalid_request", "接続リクエストが不正です");
    return oauthJson({ redirect_to: await approveConsent(config, store, user.id, body.request, body.approve) });
  });
}
export function DELETE(request: Request) {
  return mcpRoute(async () => {
    const { config, admin, store } = mcpRuntime();
    const user = await requireOwner(config, admin, request);
    await store.revoke("", user.id);
    return oauthJson({ ok: true });
  });
}
