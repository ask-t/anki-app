import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { getSupabasePublicConfig } from "../lib/supabase-config.ts";
import { agentSetupErrors, getAgentConfig } from "../lib/card-import.ts";
import { getMcpConfig, mcpSetupErrors } from "../lib/mcp-config.ts";

// Same precedence as a Next.js production build; exported variables win.
for (const file of [".env.production.local", ".env.local", ".env.production", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const errors = required.filter((key) => !process.env[key]?.trim()).map((key) => `${key} が未設定です`);
errors.push(...agentSetupErrors(getAgentConfig()));
errors.push(...mcpSetupErrors(getMcpConfig()));
if (!getSupabasePublicConfig().key) {
  errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY または NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です");
}

if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    errors.push("NEXT_PUBLIC_SUPABASE_URL は http(s) のURLを指定してください");
  }
}

if (errors.length) {
  console.error("デプロイ設定を確認してください:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("必要な環境変数が設定されています（外部サービスへの接続確認は別途必要です）。");
}
