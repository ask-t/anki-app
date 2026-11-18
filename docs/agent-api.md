# AIエージェント用の単語登録API

## 用途と権限

`POST /api/cards/import` は、単語の追加・語彙情報の更新だけを行います。
保存先はサーバーの `AGENT_USER_ID` で固定します。リクエストから保存先ユーザーや内部カードIDを指定することはできません。
復習日・回答回数・学習履歴の変更、カード削除、任意SQLの実行は公開していません。

Supabase MCPはDBの開発・管理用として使えます。単語登録を日常的にAIへ任せる場合は、この限定APIを使う方が権限を狭くできます。
MCPで接続する場合も、このAPIだけを呼ぶ専用MCPを入口にする構成にできます。REST APIとMCPは別のプロトコルなので、このAPIのURLをMCPのURL欄に入れるだけでは接続できません。

ChatGPT・Claude・Geminiでの接続方法はWeb版・デスクトップ版・CLI・APIとプランによって異なります。このリポジトリには登録用REST API・OpenAPI定義と、ChatGPT用のOAuth認証付きMCPを実装しています。ChatGPTの手順は [chatgpt-connection.md](chatgpt-connection.md) を参照してください。

### ブラウザー版から使う場合

| サービス | 接続経路 |
| --- | --- |
| ChatGPT | 新しい接続はプラグイン／カスタムMCPを確認。既存の編集可能なカスタムGPTではGPT ActionsによるAPI接続も可能 |
| Claude | 公開HTTPSの専用リモートMCPをカスタムコネクターとして追加 |
| Gemini | Gemini Apps Developer Modeで公開HTTPSの専用MCPを検証。Connected Apps Platformのプレビュー利用条件・認証設定を確認 |

ChatGPTではカスタムGPTの提供終了・プラグイン移行が案内されており、個人アカウントでの新規GPT作成は制限されています。新規の接続には、アカウントで利用可能なプラグイン／カスタムMCPの設定を確認してください。
既存の編集可能なGPTでActionsを使う場合は、本番URLに直した `openapi.json` を読み込み、API KeyのBearer認証に `AGENT_API_KEY` を設定します。
このMCPは現在、事前設定した1クライアント・1ユーザーに限定しています。Claude・Geminiでの実接続は未検証で、同時接続にはクライアント管理の拡張が必要です。
Supabase MCPの管理用OAuth認証とは別の接続です。各サービスでの利用可能性は、プラン・プレビューへの参加状況・管理者設定で異なります。

公式ドキュメント: [GPT Actions](https://developers.openai.com/api/docs/actions/introduction)、[GPT作成の利用条件](https://help.openai.com/en/articles/8554397-creating-a-gpt)、[カスタムGPTの移行](https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq)、[ClaudeのリモートMCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)、[Gemini Apps Developer Mode](https://developers.google.com/connected-apps/mcp/dev-mode/usage)。

## 認証

```http
Authorization: Bearer YOUR_AGENT_API_KEY
Content-Type: application/json
```

`AGENT_API_KEY` はエージェントのシークレット設定へ登録してください。Supabaseのservice-roleキーはサーバーだけが使用します。

## リクエスト例

```json
{
  "folder_name": "英検",
  "set_name": "基本単語",
  "cards": [
    {
      "external_id": "vocab:be-wise",
      "word": "be wise",
      "japanese_meaning": "賢明である",
      "explanation": "状況をよく考え、適切な判断をすること。",
      "example": "Be wise and choose carefully.",
      "part_of_speech": "phrase",
      "source_url": "https://example.com/source"
    }
  ]
}
```

| フィールド | 必須 | 制限 |
| --- | --- | --- |
| folder_name / set_name | いいえ | 両方を指定。各100文字以内。既存の同名を再利用、なければ作成 |
| external_id | はい | 1〜128文字。英数字で始まり、英数字・`.`・`_`・`:`・`-`のみ |
| word | はい | 空でない200文字以内の文字列 |
| japanese_meaning | はい | 空でない2000文字以内の文字列 |
| explanation | いいえ | 4000文字以内。省略時は空文字 |
| example | いいえ | 4000文字以内。省略時は空文字 |
| part_of_speech | いいえ | 80文字以内またはnull。省略時はnull |
| source_url | いいえ | 2048文字以内のhttp(s) URLまたはnull。省略時はnull |

1リクエストに1〜100件、本文はUTF-8で512KiBまでです。未対応のフィールドと、同じリクエスト内の外部ID重複は拒否します。
すべての単語を検証してから1回のDB書き込みを行います。不正な単語が混ざる場合は一括でエラーになり、書き込みません。

## 更新と重複防止

- フォルダーとセットを両方指定すると既存カードもそのセットへ移動します。指定なしでは既存の所属を保持します。同名が複数ある場合は409で中止します。
- 同じユーザーと `external_id` の組み合わせは同じカードとして更新します。再試行でも同じIDを使ってください。
- `external_id` は一度割り当てたら変更しないでください。別IDを送ると別カードになります。
- 語彙情報はリクエストの内容で上書きします。省略した任意フィールドは上表の初期値になります。解説・例文を残す場合は更新時にも送信してください。
- カードの内部UUID、復習日、復習間隔、回答回数、学習履歴は更新しません。

成功レスポンス:

```json
{"ok":true,"total":1,"external_ids":["vocab:be-wise"]}
```

`total` は受け付けて保存した件数で、新規作成と既存更新の合計です。

## curlでの呼び出し

エージェントの実行環境に `TANGO_BASE_URL` と `TANGO_AGENT_API_KEY` を設定し、送信するJSONを `cards.json` に保存します。

```sh
curl --fail-with-body \
  "$TANGO_BASE_URL/api/cards/import" \
  -H "Authorization: Bearer $TANGO_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @cards.json
```

保存後、アプリで **単語を更新** を押すと学習対象に反映されます。

## エージェントへの指示例

> 英単語と日本語の意味を確認し、安定したexternal_idを付けてください。
> 利用者が指定した単語を登録APIのcards形式でまとめ、1リクエスト100件以内で送信してください。
> 再送・修正時は同じexternal_idを使い、残すべき解説や例文も含めてください。
> APIキーは設定済みのシークレットから読み取り、会話やログに出力しないでください。
> 200レスポンスを確認してから登録完了と報告してください。

## エラー

| HTTPステータス | 意味 |
| --- | --- |
| 400 | JSON形式・フィールド・件数・同一リクエスト内の重複IDが不正 |
| 401 | APIキーが未指定または不正 |
| 409 | 同名フォルダーまたはセットが複数あるため中止 |
| 413 | 本文が512KiBを超過 |
| 415 | Content-Typeがapplication/jsonではない |
| 500 | DB書き込み失敗。サーバー設定とSQL適用を確認 |
| 503 | サーバーの必須設定が不足または不正 |

ネットワーク切断や500で再試行するときも、同じexternal_idを使ってください。

## OpenAPI

公開後は `https://your-app.vercel.app/openapi.json` から定義を取得できます。
OpenAPIの `servers` は相対URL `/` です。利用する連携機能が絶対URLを要求する場合は、取り込んだ定義の `servers[0].url` を本番URLに変更してください。
