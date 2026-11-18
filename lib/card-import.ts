import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_IMPORT_CARDS = 100;
export const MAX_IMPORT_BYTES = 512 * 1024;
export const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export type AgentConfig = { url?: string; serviceKey?: string; apiKey?: string; userId?: string };
export type ImportedCard = {
  external_id: string;
  word: string;
  japanese_meaning: string;
  explanation: string;
  example: string;
  part_of_speech: string | null;
  source_url: string | null;
};

export function getAgentConfig(): AgentConfig {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    apiKey: process.env.AGENT_API_KEY?.trim(),
    userId: process.env.AGENT_USER_ID?.trim(),
  };
}

export function agentSetupErrors(config: AgentConfig): string[] {
  const errors: string[] = [];
  if (!config.apiKey || !/^[a-z\d_-]{32,}$/i.test(config.apiKey)) {
    errors.push("AGENT_API_KEY は英数字・_-からなる32文字以上のランダムなキーを指定してください");
  }
  if (!config.userId || !UUID_PATTERN.test(config.userId)) {
    errors.push("AGENT_USER_ID は保存先のSupabase AuthユーザーのUUIDを指定してください");
  }
  return errors;
}

class ImportError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, name: string, max: number, required = false): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max) {
    throw new ImportError(`${name} は${required ? "空でない" : ""}${max}文字以内の文字列にしてください`, 400);
  }
  return value.trim();
}

export function parseImportedCards(input: unknown): ImportedCard[] {
  if (!record(input) || Object.keys(input).some((key) => !["cards", "folder_name", "set_name"].includes(key)) || !Array.isArray(input.cards)
    || input.cards.length === 0 || input.cards.length > MAX_IMPORT_CARDS) {
    throw new ImportError(`cards に1〜${MAX_IMPORT_CARDS}件の単語を指定してください`, 400);
  }
  if ((input.folder_name === undefined) !== (input.set_name === undefined)) throw new ImportError("folder_name と set_name は両方指定してください", 400);
  if (input.folder_name !== undefined) { text(input.folder_name, "folder_name", 100, true); text(input.set_name, "set_name", 100, true); }
  const ids = new Set<string>();
  const fields = ["external_id", "word", "japanese_meaning", "explanation", "example", "part_of_speech", "source_url"];
  return input.cards.map((item, index) => {
    const prefix = `cards[${index}]`;
    if (!record(item) || Object.keys(item).some((key) => !fields.includes(key))) {
      throw new ImportError(`${prefix} に未対応のフィールドがあります`, 400);
    }
    const externalId = text(item.external_id, `${prefix}.external_id`, 128, true);
    if (!/^[a-z\d][a-z\d._:-]*$/i.test(externalId)) {
      throw new ImportError(`${prefix}.external_id は英数字で始まる英数字・._:-で指定してください`, 400);
    }
    if (ids.has(externalId)) throw new ImportError(`${prefix}.external_id が同じリクエスト内で重複しています`, 400);
    ids.add(externalId);
    const sourceUrl = item.source_url == null ? null : text(item.source_url, `${prefix}.source_url`, 2048);
    if (sourceUrl) {
      try {
        if (!["http:", "https:"].includes(new URL(sourceUrl).protocol)) throw new Error();
      } catch {
        throw new ImportError(`${prefix}.source_url はhttp(s)のURLにしてください`, 400);
      }
    }
    return {
      external_id: externalId,
      word: text(item.word, `${prefix}.word`, 200, true),
      japanese_meaning: text(item.japanese_meaning, `${prefix}.japanese_meaning`, 2000, true),
      explanation: text(item.explanation, `${prefix}.explanation`, 4000),
      example: text(item.example, `${prefix}.example`, 4000),
      part_of_speech: item.part_of_speech == null ? null : text(item.part_of_speech, `${prefix}.part_of_speech`, 80) || null,
      source_url: sourceUrl || null,
    };
  });
}

export async function readBody(request: Request, maxBytes = MAX_IMPORT_BYTES): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ImportError("JSONの本文が必要です", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ImportError("リクエストは512KiB以内にしてください", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ImportError("正しいJSONを送信してください", 400);
  }
}

export async function saveImportedCards(admin: SupabaseClient, userId: string, input: unknown) {
  const cards = parseImportedCards(input);
  if (record(input) && input.folder_name !== undefined) {
    const folderName = text(input.folder_name, "folder_name", 100, true);
    const setName = text(input.set_name, "set_name", 100, true);
    const { error } = await admin.rpc("import_vocabulary_to_set", { p_user_id: userId, p_folder_name: folderName, p_set_name: setName, p_cards: cards });
    if (error) {
      if (error.code === "P0001") throw new ImportError("同じ名前のフォルダーまたはセットが複数あります。名前を整理してから再試行してください", 409);
      throw new Error("card import failed");
    }
    return { ok: true, total: cards.length, external_ids: cards.map((card) => card.external_id), folder_name: folderName, set_name: setName };
  }
  const updatedAt = new Date().toISOString();
  const { error } = await admin.from("cards").upsert(
    cards.map((card) => ({ ...card, user_id: userId, updated_at: updatedAt })),
    { onConflict: "user_id,external_id", defaultToNull: false },
  );
  if (error) throw new Error("card import failed");
  return { ok: true, total: cards.length, external_ids: cards.map((card) => card.external_id) };
}

function json(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createCardImportHandler(config: AgentConfig, createAdmin: () => SupabaseClient) {
  return async (request: Request): Promise<Response> => {
    if (!config.url || !config.serviceKey || agentSetupErrors(config).length) {
      return json({ error: "単語登録APIのサーバー設定が不足しています" }, 503);
    }
    const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token || !timingSafeEqual(
      createHash("sha256").update(token).digest(),
      createHash("sha256").update(config.apiKey!).digest(),
    )) {
      return json({ error: "有効なAPIキーが必要です" }, 401);
    }
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Content-Typeをapplication/jsonにしてください" }, 415);
    }
    try {
      // Only vocabulary fields are updated. The caller cannot select another user
      // or overwrite a card's ID, review schedule, or review logs.
      const input = await readBody(request);
      parseImportedCards(input);
      return json(await saveImportedCards(createAdmin(), config.userId!, input));
    } catch (error) {
      if (error instanceof ImportError) return json({ error: error.message }, error.status);
      console.error("card import failed");
      return json({ error: "単語を保存できませんでした。サーバー設定とデータベースを確認してください" }, 500);
    }
  };
}
