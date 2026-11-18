# ChatGPTから単語を登録する

ブラウザー版ChatGPTには、専用のリモートMCPをカスタム接続として追加します。
カスタムGPTの作成やOpenAI APIキーは必要ありません。利用できる接続メニューはChatGPTのプラン・管理者設定によって異なります。

このアプリの公開URLは **https://anki.ask-t.org/**、接続URLは **https://anki.ask-t.org/mcp** です。以下の「あなたの本番ドメイン」には `anki.ask-t.org` を指定します。

## このアプリで公開する機能

- URL: `https://あなたの本番ドメイン/mcp`
- ツール: `import_vocabulary` の1つだけ
- 認証: OAuth認証コード + PKCE S256。事前設定したChatGPT用クライアントのみ受け付けます。
- 権限: `cards:write`。本人の単語の追加・更新と、指定したフォルダー・セットの作成、単語のセット移動。
- 同じ外部IDは上書き。復習日・学習履歴は保持します。詳細な入力形式は [agent-api.md](agent-api.md) を参照してください。

Supabaseの管理用MCPとは別の接続です。ChatGPTにはSupabaseの管理キーを渡しません。
Supabase Authは本人確認に使い、ChatGPTにはこのアプリ専用の不透明なトークンを発行します。
Supabase側のOAuth Server機能を有効にする必要はありません。
OAuthテーブルはRLSを有効にし、ブラウザー用ロールの権限とポリシーを設けず、サーバーだけが操作します。このためSupabaseの [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) がINFOとして表示されるのは、この2テーブルでは意図した状態です。

## 1. サーバー用の設定

`.env.local` に既存のSupabase公開URL・publishableキーを設定したうえで、次を追加します。

```dotenv
SUPABASE_SERVICE_ROLE_KEY=サーバー用キー
AGENT_USER_ID=単語帳で使うユーザーのUUID
```

サーバー用キーは **Supabase → Settings → API Keys** で取得します。新しい `sb_secret_...` のSecret key、またはLegacyの `service_role` をこの環境変数に指定できます。ブラウザー用publishableキーとは異なります。
User UIDは **Authentication → Users → ログインに使っているメールアドレスのユーザー** でコピーします。プロジェクトIDではありません。
キーはチャットに貼らず、`.env.local` またはVercelの環境変数へ保存してください。

```sh
npm run setup:agent
npm run check:env
```

`setup:agent` は不足している `AGENT_API_KEY`、`MCP_CLIENT_ID`、`MCP_CLIENT_SECRET` を生成します。既存の値は維持し、値をログへ出力しません。生成後はエディターで `.env.local` を開いて必要な設定欄にコピーできます。
`AGENT_API_KEY` はREST API用で、ChatGPTのOAuth設定には使いません。

## 2. Vercelへ公開

1. Supabaseに最新の [schema.sql](../supabase/schema.sql) を適用します。旧Notion用の列名の移行と、サーバーだけが読み書きできるOAuthテーブルを含みます。
2. [READMEのデプロイ手順](../README.md#vercelへのデプロイ) に従って、まず `MCP_ENABLED=false` でアプリを公開します。
3. 本番URLが分かったらVercelの環境変数に次を設定して再デプロイします。`APP_BASE_URL` は末尾の `/` なしで、パスを付けません。

```dotenv
MCP_ENABLED=true
APP_BASE_URL=https://あなたの本番ドメイン
MCP_CLIENT_ID=生成済みのクライアントID
MCP_CLIENT_SECRET=生成済みの64文字以上の秘密キー
MCP_REDIRECT_URI=https://chatgpt.com/connector_platform_oauth_redirect
```

4. SupabaseのRedirect URLsに本番アプリのルートURLを追加します。単語帳でメールリンクまたはパスワードでログインしてから接続すると、そのセッションを利用できます。
5. 本番URLの `/.well-known/oauth-authorization-server` がJSONを返し、`/mcp` が未認証では401になることを確認します。Vercelのログインが必要なプレビューURLではなく、外部から到達できる本番URLを使います。

## 3. ChatGPTへ追加

1. [ChatGPTのPlugins](https://chatgpt.com/plugins) を開き、**＋ → Add custom MCP server** を選びます。
2. 名前を `Anki App 単語帳`、接続URLを `https://あなたの本番ドメイン/mcp` にします。
3. 認証を **OAuth** にし、事前設定クライアントの入力欄に `MCP_CLIENT_ID` と `MCP_CLIENT_SECRET` を登録します。秘密キーはチャット本文に貼りません。
4. ChatGPTが示すコールバックURLが `MCP_REDIRECT_URI` と完全に一致することを確認します。別のURLが表示される場合は、その正確なURLにサーバー設定を変更して再デプロイします。ワイルドカードは使いません。
5. **Create as a plugin** を選択し、接続許可の画面で単語帳と同じアカウントでログインします。メールリンクを使った場合は、単語帳でログイン後にChatGPTの接続画面からやり直します。アプリのアカウントを確認して **単語の追加・更新を許可** を押します。
6. 接続後のツール一覧が `import_vocabulary` だけになっていることを確認します。

認証の発見用URLとトークン発行先は自動取得されます。手入力が必要な場合:

| 項目 | URL |
| --- | --- |
| Authorization URL | `https://あなたの本番ドメイン/oauth/authorize` |
| Token URL | `https://あなたの本番ドメイン/oauth/token` |
| Scope | `cards:write` |

## 4. 最初の登録

新しい会話で `@` から接続したプラグインを選択し、例えば次のように依頼します。

> Anki App単語帳のフォルダー「英検」、セット「基本単語」に「be wise / 賢明である」を例文付きで登録してください。フォルダーとセットがなければ作成し、external_idはvocab:be-wiseを使ってください。

ツールの成功応答を確認したら、アプリの **単語を更新** を押してください。
同名フォルダー・セットが1つずつあれば再利用します。同名候補が複数あれば登録を中止します。同じ外部IDは同じカードを更新し、保存先を指定するとそのセットに移動します。学習履歴は維持されます。フォルダーとセットを省略した場合、新規カードは未分類、既存カードは現在のセットのままです。
本番でこの操作が成功するまでは、ChatGPT接続完了とは扱いません。

## 取り消しとトラブル対応

- アプリ上部の **AIとの接続** → **接続許可をすべて取り消す** で、発行済みのアクセストークンと更新トークンを無効にできます。通常の単語帳ログアウトだけではChatGPT接続は解除されません。
- `MCP_ENABLED=false` に変更して再デプロイすると、MCP経由の接続を止められます。
- 401: 接続し直してください。アクセストークンは1時間、更新トークンは30日で期限切れになり、更新ごとにトークンを交換します。
- 503: MCP用環境変数とサーバー用キーを確認してください。
- 許可できない: `AGENT_USER_ID` とログイン中のアカウントが一致しているか確認してください。
- パスワードが未設定・不明: プロジェクトのターミナルで `npm run setup:password` を実行します。パスワードはChatGPTに渡しません。
- 接続画面が期限切れ: ChatGPTの接続画面からやり直してください。接続リクエストは10分、認証コードは60秒で期限切れになります。
- 本番ドメイン・クライアントIDを変更したら再接続します。秘密キーを変更する際も先に既存の接続許可を取り消してください。
- 期限切れレコードを掃除する場合は、サーバー管理者が `mcp_oauth_grants` の古い `expires_at`、`mcp_oauth_sessions` の期限切れ `refresh_expires_at` を条件に削除します。

参考: [ChatGPTでの接続](https://developers.openai.com/plugins/deploy/connect-chatgpt)、[OAuth設定](https://developers.openai.com/plugins/build/auth)、[Supabase APIキー](https://supabase.com/docs/guides/getting-started/api-keys)、[パスワード認証](https://supabase.com/docs/guides/auth/passwords)。
