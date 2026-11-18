export const MCP_SCOPE = "cards:write";
export type McpConfig = {
  enabled: boolean;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  userId: string;
};

export function getMcpConfig(): McpConfig {
  return {
    enabled: process.env.MCP_ENABLED === "true",
    baseUrl: process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "",
    clientId: process.env.MCP_CLIENT_ID?.trim() || "",
    clientSecret: process.env.MCP_CLIENT_SECRET?.trim() || "",
    redirectUri: process.env.MCP_REDIRECT_URI?.trim() || "https://chatgpt.com/connector_platform_oauth_redirect",
    userId: process.env.AGENT_USER_ID?.trim() || "",
  };
}

export function mcpSetupErrors(config: McpConfig): string[] {
  if (!config.enabled) return [];
  const errors: string[] = [];
  try {
    const url = new URL(config.baseUrl);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.pathname !== "/"
      || url.search || url.hash || url.username || url.password || url.origin !== config.baseUrl) throw new Error();
  } catch { errors.push("APP_BASE_URL はアプリの公開HTTPSオリジンを指定してください"); }
  if (!/^[a-z\d_-]{8,128}$/i.test(config.clientId)) errors.push("MCP_CLIENT_ID は8〜128文字の英数字・_-で指定してください");
  if (!/^[a-z\d_-]{64,256}$/i.test(config.clientSecret)) errors.push("MCP_CLIENT_SECRET は64文字以上のランダム値を指定してください");
  try {
    const url = new URL(config.redirectUri);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error();
  } catch { errors.push("MCP_REDIRECT_URI はクライアントの正確なHTTPSコールバックURLを指定してください"); }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(config.userId)) errors.push("AGENT_USER_ID が不正です");
  return errors;
}
