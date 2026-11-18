import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_IMPORT_BYTES, parseImportedCards, saveImportedCards } from "./card-import.ts";
import type { McpConfig } from "./mcp-config.ts";
import { MCP_SCOPE } from "./mcp-config.ts";

const cardSchema = z.object({
  external_id: z.string().min(1).max(128).regex(/^[a-z\d][a-z\d._:-]*$/i).describe("再送・修正時も同じIDを使う。例: vocab:be-wise"),
  word: z.string().min(1).max(200),
  japanese_meaning: z.string().min(1).max(2000),
  explanation: z.string().max(4000).optional(), example: z.string().max(4000).optional(),
  part_of_speech: z.string().max(80).nullable().optional(),
  source_url: z.string().max(2048).nullable().optional(),
}).strict();
const inputSchema = z.object({
  cards: z.array(cardSchema).min(1).max(100),
  folder_name: z.string().trim().min(1).max(100).optional().describe("保存先フォルダー名。set_nameと一緒に指定。なければ作成"),
  set_name: z.string().trim().min(1).max(100).optional().describe("保存先セット名。folder_nameと一緒に指定。なければ作成"),
}).strict();
const securitySchemes = [{ type: "oauth2", scopes: [MCP_SCOPE] }];

export async function handleMcpRequest(config: McpConfig, admin: SupabaseClient, request: Request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin");
  if (origin && ![config.baseUrl, "https://chatgpt.com", "https://chat.openai.com"].includes(origin)) {
    return new Response(null, { status: 403 });
  }
  const server = new Server({ name: "tango-vocabulary", version: "1.0.0" }, {
    capabilities: { tools: {} },
    instructions: "利用者が登録を依頼した英単語と日本語の意味をAnki Appへ保存します。import_vocabularyの成功応答を確認してから完了と伝えてください。同じ単語の再送・修正には同じexternal_idを使い、残す解説・例文も含めてください。フォルダーとセットの指定があれば両方の名前を渡してください。同名がなければ作成します。既存カードの指定先への移動は明示された場合にだけ行います。保存先は本人のアカウントに固定されています。",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: "import_vocabulary", title: "Anki Appに単語を登録",
    description: "利用者が指定した単語を1〜100件追加・更新する。同じexternal_idは語彙情報を上書きする。省略した任意項目は空になるため、更新で残す内容も送る。folder_nameとset_nameを両方指定すると、同名のフォルダーとセットを再利用または作成し、単語をそこに保存する。既存の単語も指定先へ移動する。指定がなければ既存の所属を保持し、新規は未分類。復習日・履歴は保持される。",
    inputSchema: z.toJSONSchema(inputSchema) as { type: "object" },
    securitySchemes, _meta: { securitySchemes },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name !== "import_vocabulary") throw new McpError(ErrorCode.InvalidParams, "未対応のツールです");
    const parsed = inputSchema.safeParse(params.arguments);
    if (!parsed.success) return { isError: true, content: [{ type: "text", text: "単語の形式・件数・文字数を確認してください。未対応の項目は送信できません。" }] };
    try { parseImportedCards(parsed.data); }
    catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "単語の形式が不正です" }] }; }
    try {
      const result = await saveImportedCards(admin, config.userId, parsed.data);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      if (error instanceof Error && error.message.includes("同じ名前の")) return { isError: true, content: [{ type: "text", text: error.message }] };
      console.error("MCP card import failed");
      return { isError: true, content: [{ type: "text", text: "単語を保存できませんでした。サーバー設定を確認してください。" }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_IMPORT_BYTES,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { await server.close(); }
}
