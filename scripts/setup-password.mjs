import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

class SetupError extends Error {}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError("このコマンドは手元のターミナルから実行してください。");
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const userId = process.env.AGENT_USER_ID?.trim();
  if (!url || !key || !userId || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(userId)) {
    throw new SetupError(".env.local のSupabase URL・サーバー用キー・AGENT_USER_IDを確認してください。");
  }
  console.log("AGENT_USER_IDで指定された既存アカウントのパスワードを設定します。");
  console.log("パスワードは表示・ファイル保存しません。12〜128文字で指定してください。");
  const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  input.on("SIGINT", () => { input.close(); process.exit(130); });
  let password = "";
  let confirmation = "";
  try {
    process.stdout.write("新しいパスワード: ");
    password = await input.question("");
    process.stdout.write("\nもう一度入力: ");
    confirmation = await input.question("");
    process.stdout.write("\n");
  } finally { input.close(); }
  if (password.length < 12 || password.length > 128 || !password.trim()) throw new SetupError("パスワードは12〜128文字で指定してください。変更は行っていません。");
  if (password !== confirmation) throw new SetupError("入力が一致しません。変更は行っていません。");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
  password = ""; confirmation = "";
  if (error) throw new SetupError(`設定できませんでした。サーバー用キーとSupabaseのパスワードポリシーを確認してください（HTTP ${error.status || "unknown"}）。`);
  if (data.user.id !== userId) throw new SetupError("保存先アカウントを確認してください。");
  console.log("パスワードを設定しました。同じアカウントのメールアドレスと、このパスワードでログインできます。");
}

main().catch((error) => {
  // Do not print API errors that might contain request details or credentials.
  console.error(error instanceof SetupError ? error.message : "パスワード設定を完了できませんでした。接続と環境変数を確認してください。");
  process.exitCode = 1;
});
