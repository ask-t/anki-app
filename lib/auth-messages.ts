type AuthFailure = { code?: string; status?: number };

export function passwordLoginMessage(error: AuthFailure): string {
  if (error.code === "invalid_credentials") return "メールアドレスまたはパスワードを確認してください。";
  if (error.code === "email_not_confirmed") return "アカウントの初期設定が完了していません。管理者による設定を確認してください。";
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "ログインの試行回数が上限に達しました。時間を置いてから試してください。";
  }
  if (error.code === "user_banned") return "このアカウントは現在ログインできません。";
  return "ログインできませんでした。入力内容とネットワーク接続を確認してください。";
}
