import { mcpRoute, mcpRuntime } from "@/lib/mcp-runtime";
import { verifyMcpToken } from "@/lib/mcp-oauth";
import { handleMcpRequest } from "@/lib/mcp-server";

export const runtime = "nodejs";
export const maxDuration = 30;
export function POST(request: Request) {
  return mcpRoute(async () => {
    const { config, admin, store } = mcpRuntime();
    await verifyMcpToken(config, store, request);
    return handleMcpRequest(config, admin, request);
  });
}
export const GET = POST;
export const DELETE = POST;
