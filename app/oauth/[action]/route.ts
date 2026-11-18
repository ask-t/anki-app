import { getMcpConfig } from "@/lib/mcp-config";
import { authorize, exchangeToken, revokeToken } from "@/lib/mcp-oauth";
import { mcpRoute, mcpRuntime } from "@/lib/mcp-runtime";
export const runtime = "nodejs";
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, { params }: Context) {
  const { action } = await params;
  return mcpRoute(() => action === "authorize" ? authorize(getMcpConfig(), request) : new Response(null, { status: 404 }));
}
export async function POST(request: Request, { params }: Context) {
  const { action } = await params;
  return mcpRoute(async () => {
    if (!["token", "revoke"].includes(action)) return new Response(null, { status: 404 });
    const { config, store } = mcpRuntime();
    return action === "token" ? exchangeToken(config, store, request) : revokeToken(config, store, request);
  });
}
