"use client";

import { useRef, useState } from "react";
import { browserSupabase } from "@/lib/supabase";
import { passwordLoginMessage } from "@/lib/auth-messages";

export default function PasswordLogin({ idPrefix = "login", connection = false }: { idPrefix?: string; connection?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await browserSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMessage(passwordLoginMessage(error));
    } catch { setMessage("接続できませんでした。ネットワーク接続を確認してください。"); }
    finally { setPassword(""); setBusy(false); inFlight.current = false; }
  }

  async function sendLink() {
    if (inFlight.current) return;
    const address = email.trim();
    if (!address || !(document.getElementById(`${idPrefix}-email`) as HTMLInputElement | null)?.checkValidity()) {
      setMessage("有効なメールアドレスを入力してください。"); return;
    }
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const { error } = await browserSupabase().auth.signInWithOtp({ email: address, options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: !connection } });
      if (error) setMessage(error.status === 429 ? "メール送信の上限に達しました。時間を置いてから試してください。" : "メールを送信できませんでした。メールアドレスと送信設定を確認してください。");
      else setMessage(connection ? "ログインリンクを送信しました。リンクを開いた後、ChatGPTの接続画面からやり直してください。" : "ログインリンクを送信しました。メールのリンクを開いてください。");
    } catch { setMessage("接続できませんでした。ネットワーク接続を確認してください。"); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <form onSubmit={login} aria-busy={busy}>
    <label htmlFor={`${idPrefix}-email`}>メールアドレス</label>
    <input id={`${idPrefix}-email`} name="username" className="input" type="email" inputMode="email"
      autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy}
      value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
    <label htmlFor={`${idPrefix}-password`}>パスワード</label>
    <input id={`${idPrefix}-password`} name="password" className="input" type="password"
      autoComplete="current-password" required disabled={busy} value={password}
      onChange={(event) => setPassword(event.target.value)} />
    <button className="btn" disabled={busy}>{busy ? "ログイン中…" : "ログイン"}</button>
    <button type="button" className="btn light" disabled={busy} onClick={sendLink}>メールでログインリンクを送信</button>
    {message && <p role="alert">{message}</p>}
  </form>;
}
