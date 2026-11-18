import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/check-env.mjs", import.meta.url));
const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "secret-test-key",
  AGENT_API_KEY: "test-agent-key-0123456789abcdef0123456789",
  AGENT_USER_ID: "00000000-0000-4000-8000-000000000001",
};

function run(env, files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "tango-env-test-"));
  try {
    for (const [file, contents] of Object.entries(files)) writeFileSync(join(cwd, file), contents);
    return spawnSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("missing configuration fails with variable names", () => {
  const result = run({});
  assert.equal(result.status, 1);
  for (const name of Object.keys(valid)) assert.ok(result.stderr.includes(name));
});

test("valid configuration succeeds without printing secrets", () => {
  const result = run(valid);
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes(valid.SUPABASE_SERVICE_ROLE_KEY));
  assert.ok(!result.stdout.includes(valid.AGENT_API_KEY));
});

test("legacy anon key remains supported when publishable key is absent or blank", () => {
  const { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, ...rest } = valid;
  assert.equal(run({ ...rest, NEXT_PUBLIC_SUPABASE_ANON_KEY: key }).status, 0);
  assert.equal(run({ ...rest, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "  ", NEXT_PUBLIC_SUPABASE_ANON_KEY: key }).status, 0);
});

test("missing both public keys fails even if other settings are present", () => {
  const result = run({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "  " });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(result.stderr, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test("invalid URLs, owner IDs and weak agent keys fail", () => {
  const result = run({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)", AGENT_USER_ID: "invalid", AGENT_API_KEY: "short" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(result.stderr, /AGENT_USER_ID/);
  assert.match(result.stderr, /AGENT_API_KEY/);
  assert.ok(!result.stderr.includes(valid.AGENT_API_KEY));
});

test("production env precedence matches Next.js and keeps exported values", () => {
  const result = run({ ...valid, AGENT_API_KEY: valid.AGENT_API_KEY }, {
    ".env.production.local": "AGENT_API_KEY=invalid\nAGENT_USER_ID=00000000-0000-4000-8000-000000000001\n",
    ".env.local": "AGENT_USER_ID=invalid\n",
  });
  assert.equal(result.status, 0);
});

test("enabling MCP requires a canonical public origin and confidential client configuration", () => {
  const missing = run({ ...valid, MCP_ENABLED: "true" });
  assert.equal(missing.status, 1);
  for (const name of ["APP_BASE_URL", "MCP_CLIENT_ID", "MCP_CLIENT_SECRET"]) assert.match(missing.stderr, new RegExp(name));
  const result = run({ ...valid, MCP_ENABLED: "true", APP_BASE_URL: "https://tango.example", MCP_CLIENT_ID: "tango-chatgpt", MCP_CLIENT_SECRET: "a".repeat(64) });
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes("a".repeat(64)));
});
