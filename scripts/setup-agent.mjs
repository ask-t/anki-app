import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";

const file = ".env.local";
let contents = existsSync(file) ? readFileSync(file, "utf8") : "";
if (existsSync(file)) loadEnvFile(file);
const generated = {
  AGENT_API_KEY: () => randomBytes(32).toString("hex"),
  MCP_CLIENT_ID: () => `tango-chatgpt-${randomBytes(6).toString("hex")}`,
  MCP_CLIENT_SECRET: () => randomBytes(32).toString("hex"),
  MCP_ENABLED: () => "false",
};
for (const [name, generate] of Object.entries(generated)) {
  if (process.env[name]?.trim()) continue;
  const line = `${name}=${generate()}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
  console.log(`${name} を設定しました`);
}
writeFileSync(file, contents, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(".env.local に保存しました。キーの値は出力しません。既存の設定値は維持します。");
