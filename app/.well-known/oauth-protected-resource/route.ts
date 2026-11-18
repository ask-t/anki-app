import { getMcpConfig } from "@/lib/mcp-config";
import { oauthJson, protectedMetadata } from "@/lib/mcp-oauth";
import { mcpRoute } from "@/lib/mcp-runtime";
export const runtime = "nodejs";
export function GET() { return mcpRoute(() => oauthJson(protectedMetadata(getMcpConfig()))); }
