import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createCardImportHandler, MAX_IMPORT_BYTES, MAX_IMPORT_CARDS } from "../lib/card-import.ts";

const config = {
  url: "https://example.supabase.co", serviceKey: "test-service-key",
  apiKey: "test-agent-key-0123456789abcdef0123456789", userId: "00000000-0000-4000-8000-000000000001",
};
const card = { external_id: "vocab:be-wise", word: "be wise", japanese_meaning: "賢明である" };
function setup(databaseStatus = 201) {
  const writes = [];
  let clients = 0;
  const handler = createCardImportHandler(config, () => {
    clients++;
    return createClient(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url, options) => {
        writes.push({ url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) });
        return databaseStatus === 201 ? new Response(null, { status: 201 })
          : Response.json({ message: "database unavailable" }, { status: databaseStatus });
      } },
    });
  });
  return { handler, writes, clients: () => clients };
}
function request(body = { cards: [card] }, headers = {}) {
  return new Request("https://tango.example/api/cards/import", {
    method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("authorized import uses only the configured owner and preserves review fields", async () => {
  const { handler, writes } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, total: 1, external_ids: [card.external_id] });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(writes.length, 1);
  assert.equal(new URL(writes[0].url).searchParams.get("on_conflict"), "user_id,external_id");
  assert.match(writes[0].headers.get("prefer"), /resolution=merge-duplicates/);
  assert.match(writes[0].headers.get("prefer"), /missing=default/);
  assert.equal(writes[0].body[0].user_id, config.userId);
  assert.equal(writes[0].body[0].word, card.word);
  assert.deepEqual(Object.keys(writes[0].body[0]).sort(), ["external_id", "word", "japanese_meaning", "explanation", "example", "part_of_speech", "source_url", "user_id", "updated_at"].sort());
});

test("missing and incorrect keys cannot initialize a database client or write", async () => {
  for (const authorization of ["", "Bearer wrong", "Basic test", `Bearer ${config.apiKey} extra`]) {
    const { handler, writes, clients } = setup();
    const response = await handler(request("not JSON", { Authorization: authorization }));
    assert.equal(response.status, 401);
    assert.equal(clients(), 0);
    assert.equal(writes.length, 0);
  }
});

test("incomplete or weak server configuration fails closed", async () => {
  for (const overrides of [{ apiKey: "" }, { apiKey: "short" }, { userId: "not-a-uuid" }, { serviceKey: undefined }]) {
    const handler = createCardImportHandler({ ...config, ...overrides }, () => { throw new Error("must not be called"); });
    assert.equal((await handler(request())).status, 503);
  }
});

test("malformed, empty, duplicate, oversized and privileged fields are rejected before any write", async () => {
  const inputs = [
    "{broken", null, [], {}, { cards: [] }, { cards: [null] },
    { cards: [card], user_id: config.userId },
    { cards: [{ ...card, user_id: config.userId }] },
    { cards: [{ ...card, due_at: "2099-01-01" }] },
    { cards: [{ ...card, repetitions: 100 }] },
    { cards: [{ ...card, word: " " }] },
    { cards: [{ ...card, word: "x".repeat(201) }] },
    { cards: [{ ...card, japanese_meaning: "" }] },
    { cards: [{ ...card, external_id: "id with spaces" }] },
    { cards: [{ ...card, source_url: "javascript:alert(1)" }] },
    { cards: [card, card] },
    { cards: Array.from({ length: MAX_IMPORT_CARDS + 1 }, (_, i) => ({ ...card, external_id: `id-${i}` })) },
  ];
  for (const input of inputs) {
    const { handler, writes } = setup();
    const response = await handler(request(input));
    assert.equal(response.status, 400, `unexpected status for ${JSON.stringify(input).slice(0, 100)}`);
    assert.equal(writes.length, 0);
  }
});

test("only JSON content types are accepted", async () => {
  const { handler, writes } = setup();
  assert.equal((await handler(request(undefined, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal(writes.length, 0);
  assert.equal((await handler(request(undefined, { "Content-Type": "application/json; charset=utf-8" }))).status, 200);
});

test("streamed body size is bounded without relying on Content-Length", async () => {
  const { handler, writes } = setup();
  const response = await handler(request(" ".repeat(MAX_IMPORT_BYTES + 1)));
  assert.equal(response.status, 413);
  assert.equal(writes.length, 0);
});

test("a batch is written once, with validated details and defaults", async () => {
  const { handler, writes } = setup();
  const response = await handler(request({ cards: Array.from({ length: MAX_IMPORT_CARDS }, (_, i) => ({ ...card,
    external_id: `word-${i}`, explanation: "解説", example: "An example.", part_of_speech: "phrase", source_url: "https://example.com/source",
  })) }));
  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.length, MAX_IMPORT_CARDS);
  assert.equal(writes[0].body[0].source_url, "https://example.com/source");
});

test("database errors return no credentials or internal database messages", async (t) => {
  t.mock.method(console, "error", () => {});
  const { handler } = setup(400);
  const response = await handler(request());
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.ok(!body.includes(config.serviceKey));
  assert.ok(!body.includes(config.apiKey));
  assert.ok(!body.includes("database unavailable"));
});

test('folder and set must both be valid before any database operation', async () => {
  for (const extra of [{ folder_name: '英検' }, { set_name: '基本' }, { folder_name: ' ', set_name: '基本' }, { folder_name: 'x'.repeat(101), set_name: '基本' }]) {
    const { handler, writes } = setup();
    assert.equal((await handler(request({ cards: [card], ...extra }))).status, 400);
    assert.equal(writes.length, 0);
  }
});

test('named import uses one atomic RPC with owner fixed and validated cards', async () => {
  const { handler, writes } = setup();
  const response = await handler(request({ cards: [card], folder_name: ' 英検 ', set_name: ' 基本 ' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, total: 1, external_ids: [card.external_id], folder_name: '英検', set_name: '基本' });
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /\/rpc\/import_vocabulary_to_set$/);
  assert.equal(writes[0].body.p_user_id, config.userId);
  assert.equal(writes[0].body.p_folder_name, '英検');
  assert.equal(writes[0].body.p_set_name, '基本');
  assert.equal(writes[0].body.p_cards[0].external_id, card.external_id);
  assert.ok(!Object.keys(writes[0].body.p_cards[0]).includes('due_at'));
});
