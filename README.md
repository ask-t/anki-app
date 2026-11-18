# Anki App — Conference Vocab

Next.js 16 + Supabaseで作る英日フラッシュカードアプリです。
AIエージェントが専用APIから単語を登録し、ユーザーはブラウザーで学習します。
スマートフォン・タブレット・PCに対応しています。

公開URL: **https://anki.ask-t.org/**
ChatGPT用MCP: **https://anki.ask-t.org/mcp**

## 主な機能

- Supabase Authのメールリンクまたはパスワードでログイン
- AIエージェントから英単語、日本語の意味、解説、例文、品詞、出典URLを登録
- 英語 → 日本語、日本語 → 英語のフラッシュカード
- 答えを見て左にスワイプで「もう一度」、右で「大丈夫」を選び、復習日と履歴を保存
- 同じ外部IDで単語を再送して更新。カードID・復習日・学習履歴は維持
- APIキー認証、保存先ユーザー固定、入力検証、RLSによるアクセス制限
- ChatGPT用リモートMCPとOAuth接続許可・取り消し
- フォルダーとセットの作成、セットごとの単語整理と学習
- 単語へのフラグ、直近の評価とフラグによる絞り込み復習
- 回答に応じた復習間隔と、苦手な単語を優先する出題順

## ローカル起動

Node.js **24.x** とnpmを使用します。

```sh
nvm use
npm ci
cp .env.example .env.local
```

Supabaseと登録APIを次の手順で設定し、`.env.local` に値を入力します。

```sh
npm run check:env
npm run dev
```

`http://localhost:3000/` を開き、メールリンクまたはパスワードでログインしてください。AIエージェントが単語を登録したら、アプリの **単語を更新** を押すと表示されます。

## Supabaseの設定

1. Supabaseプロジェクトを作り、SQL Editorで [`supabase/schema.sql`](supabase/schema.sql) を実行します。
2. Project URL、publishableキー、サーバー用のservice-roleキーを環境変数に設定します。
3. Authenticationの **Email** プロバイダーを有効にします。パスワード認証にもこのプロバイダーを使います。
4. 既存アカウントがあればそのまま使います。新規の場合は **Authentication → Users → Add user → Create new user** で自分のメールアドレスとパスワードを設定し、本人用アカウントとして **Auto Confirm User** を選択して作成します。招待メールは不要です。
5. そのアカウントの **User UID** をコピーし、`AGENT_USER_ID` に設定します。これはユーザーのUUIDで、プロジェクトIDやメールアドレスとは異なります。
6. 既存アカウントのパスワードが未設定の場合は、次のコマンドで設定します。

既存のNotion版から移行する場合も、更新後の `schema.sql` を実行してください。`notion_page_id` を汎用の `external_id` に変更し、既存のカードID・ユーザー・復習データ・履歴を引き継ぎます。先にSQLを適用してから新しいアプリを公開します。旧Notion同期APIは廃止しています。

### メールリンクとパスワードでのログイン

メールアドレスを入力し **メールでログインリンクを送信** を押して、届いたリンクを同じブラウザーで開きます。SupabaseのカスタムSMTPを使用し、Authentication → URL Configuration のRedirect URLsにアプリのルートURLを登録します。セッションはブラウザーに保存され自動更新されます。ログアウト、ブラウザーデータの削除、Supabaseのセッション期限などにより再ログインが必要になることがあります。

パスワードでもログインできます。

初回のみ、プロジェクトのディレクトリで実行します。

```sh
npm run setup:password
```

`.env.local` の `AGENT_USER_ID` が指定する既存アカウントに、12〜128文字のパスワードを設定します。入力は非表示で、2回入力して確認します。値をチャット・ファイル・環境変数に保存する必要はありません。既存のユーザーID・単語・学習履歴は維持します。Supabaseが受け付けるパスワードポリシーも適用されます。

アプリとChatGPTの接続画面で、同じアカウントを使います。アプリにはメールでのパスワード再設定は設けていません。忘れた場合も管理者が上のコマンドを使います。アカウントが未確認の場合は管理者が対象ユーザーの初期設定を確認してください。確認設定を一律に無効化する必要はありません。

詳細: [Supabaseのパスワード認証](https://supabase.com/docs/guides/auth/passwords)。

## フォルダーとセット

フォルダーを作り、その中にセットを作成します。単語一覧で単語を開き、セットを選択すると移動できます。「表示・学習するセット」で絞り込んで学習できます。既存の単語と保存先を指定せずAIから新しく登録した単語は、セットを選ぶまで「未分類」です。AIにフォルダー名とセット名を指定すると、自動で再利用または作成して登録できます。単語の移動で復習履歴は変わりません。

単語一覧の☆を押すとフラグを付けられます。「フラグ付きのみ」や「前回の評価」をセットと組み合わせて絞り込み、対象だけを復習できます。前回の評価には直近の「もう一度・大丈夫」を使用し、以前の「難しい・簡単」も絞り込めます。まだ回答していない単語は「未評価」です。

学習は最大10単語ごとに一区切りです。「もう一度」は10分後に復習対象となり、次に復習を開始したときに再出題されます。復習対象の順番は学習回数と難易度に基づく重み付きのランダム順です。シャッフルを有効にした場合は均等なランダム順になります。

既存環境には `supabase/folders_sets.sql`、`supabase/card_flags.sql`、`supabase/review_category.sql` を先に適用してからアプリを更新してください。

## AIエージェントからの単語登録

**ブラウザー版ChatGPTの接続手順は [docs/chatgpt-connection.md](docs/chatgpt-connection.md) を参照してください。** `https://本番ドメイン/mcp` に接続し、アプリでログインして単語登録を許可します。新しいカスタムGPTの作成は不要です。

エンドポイントは **`POST /api/cards/import`** です。仕様と接続例は [`docs/agent-api.md`](docs/agent-api.md)、機械可読の定義は [`public/openapi.json`](public/openapi.json) を参照してください。

1. 32バイト以上のランダムなAPIキーを生成します。例: `openssl rand -hex 32`。
2. 同じキーをサーバーの `AGENT_API_KEY` と、使用するエージェントの秘密情報の設定に保存します。
3. エージェントは `Authorization: Bearer <APIキー>` を付けて単語を送ります。

`AGENT_API_KEY` はこのアプリの単語登録専用です。エージェントにSupabaseのservice-roleキーを渡す必要はありません。
APIキーを変更すれば、古いキーでのアクセスを止められます。本番ではVercelの環境変数を変更して再デプロイしてください。

### 環境変数

| 名前 | 値・用途 | ブラウザー公開 |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | SupabaseのProject URL | 可 |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Supabaseのpublishableキー | 可 |
| SUPABASE_SERVICE_ROLE_KEY | Supabaseのservice-roleキー | 不可 |
| AGENT_API_KEY | 単語登録API専用キー。英数字・`_`・`-`からなる32文字以上のランダム値 | 不可 |
| AGENT_USER_ID | 登録した単語の保存先となるSupabase AuthユーザーのUUID | 不可 |
| MCP_ENABLED | ChatGPT用MCPを有効にする場合は `true`。初期値は無効 | 不可 |
| APP_BASE_URL | MCPの公開オリジン。例: `https://your-app.vercel.app` | 公開情報 |
| MCP_CLIENT_ID | ChatGPTに設定するOAuthクライアントID | 公開情報 |
| MCP_CLIENT_SECRET | OAuthクライアントの秘密キー。64文字以上のランダム値 | 不可 |
| MCP_REDIRECT_URI | ChatGPTが表示する正確なコールバックURL | 公開情報 |

既存の `NEXT_PUBLIC_SUPABASE_ANON_KEY` も利用できます。両方設定されている場合はpublishableキーを優先します。
Notion用の環境変数と `SYNC_ALLOWED_EMAILS` は使用しません。`.env.local` や秘密キーはコミットしないでください。
`check:env` は必須値と形式を検査します。外部サービスへの実接続は別途確認してください。
サーバー用の `SUPABASE_SERVICE_ROLE_KEY` には新しい `sb_secret_...` キーも指定できます。`npm run setup:agent` で不足している登録API・OAuthのキーを安全に生成できます。MCPを有効にした場合は `check:env` がMCP設定も検査します。

## Vercelへのデプロイ

サーバーAPIを使うため、Next.jsとしてデプロイします。

1. Supabaseで最新の `supabase/schema.sql` を実行します。
2. 変更をGitHubにpushし、VercelでリポジトリをImportします。
3. Frameworkは **Next.js**、Root Directoryはリポジトリのルート、Node.jsは **24.x** にします。
4. Supabaseと登録APIの環境変数5項目をProductionに登録します。MCPは最初 `MCP_ENABLED=false` で公開し、本番URLが分かったら上表のMCP設定を追加して有効にします。プレビューでも使う場合はPreviewにも登録します。
5. [`vercel.json`](vercel.json) が `npm ci` と `npm run check:env && npm run build` を実行します。
6. SupabaseのSite URLを本番URL（例: `https://your-app.vercel.app/`）に設定します。メールリンク用にRedirect URLsにも本番のルートURLを追加します。
7. エージェントのAPI接続先を `https://your-app.vercel.app/api/cards/import` に設定します。
8. 本番でパスワードログイン → API登録 → **単語を更新** → 学習 → 再読み込み後の履歴保持を確認します。

`NEXT_PUBLIC_` の値はビルド時に埋め込まれます。環境変数の変更後は再デプロイしてください。

## 検証

```sh
npm test
npm run build
npm run typecheck
npm start
```

ビルドとテストは外部サービスの認証情報なしでも実行できます。GitHub Actionsでもテスト・ビルド・型チェックを実行します。
APIキー不正、別ユーザー・復習フィールドの指定、不正JSON、件数・サイズ制限、DBエラー、環境変数を検証します。
MCPは公式SDKクライアントでツール取得・登録を検証し、OAuthのPKCE、認証コード再利用、トークン更新・失効、別アカウントの拒否もテストします。DBへの統合チェックは `tests/database.sql` をSQL Editorで実行できます。テスト書き込みはロールバックします。

## トラブルシューティング

- ログインできない: 既存アカウントのメールアドレスとパスワードを確認します。パスワードの初期設定・再設定は `npm run setup:password` で行います。
- ログインの試行回数制限: 時間を置いてから試します。パスワード認証にはメール送信数の上限は関係ありません。
- 初期設定が未完了と表示される: SupabaseのAuthentication → Usersで対象アカウントの確認状態を管理者が確認します。
- 登録APIが503: 必須のサーバー環境変数と `AGENT_USER_ID` の形式を確認します。
- 登録APIが401: エージェントとサーバーに同じ `AGENT_API_KEY` が設定されているか確認します。
- 登録APIが500: `AGENT_USER_ID` のユーザーが存在するか、最新SQLを適用済みか、service-roleキーが正しいか確認します。
- 登録成功後も単語が表示されない: `AGENT_USER_ID` とアプリでログインしているユーザーが一致するか確認し、**単語を更新** を押します。

## 現時点の制約

- 単語登録APIは個人用です。サーバーで設定した1ユーザーに保存します。
- 外部エージェントが生成した内容の正確性は、登録前に確認してください。
- 復習アルゴリズムは簡易的なSM-2風の実装です。FSRSではありません。
- 学習対象は最大1000件、単語一覧は先頭200件です。
- 回答時のカード更新と履歴追加は1つのトランザクションではありません。複数端末での同時回答には競合の余地があります。
- オフライン学習には対応していません。
