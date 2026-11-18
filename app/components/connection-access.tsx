"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase";
import PasswordLogin from "./password-login";

export default function ConnectionAccess({ signedRequest, clientId, initialError }: {
  signedRequest?: string; clientId?: string; initialError?: string;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      const client = browserSupabase();
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, current) => {
        setSession(current); setLoading(false);
      });
      return () => subscription.unsubscribe();
    } catch { setMessage("ログイン設定を確認してください"); setLoading(false); }
  }, []);

  async function perform(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "処理に失敗しました"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function decide(approve: boolean) {
    const { data: { session: current }, error } = await browserSupabase().auth.getSession();
    if (error || !current) throw new Error("ログインし直してください");
    const response = await fetch("/api/mcp/consent", {
      method: signedRequest ? "POST" : "DELETE",
      headers: { Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json" },
      ...(signedRequest ? { body: JSON.stringify({ request: signedRequest, approve }) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error_description || "接続の設定に失敗しました");
    if (signedRequest) window.location.assign(result.redirect_to);
    else setMessage("ChatGPTへの接続許可を取り消しました。次に使うときは再接続が必要です。");
  }
  return <main className="shell">
    <section className="panel login-panel">
      <span className="tag">Anki App × ChatGPT</span>
      <h1>{signedRequest ? "単語登録の接続を許可" : "AIとの接続を管理"}</h1>
      {initialError ? <p role="alert">{initialError}</p> : <>
        {signedRequest && <>
          <p>接続先: ChatGPT <span className="muted">({clientId})</span></p>
          <p>許可すると、ChatGPTがあなたの単語帳に単語を追加・更新し、フォルダーとセットを作成して単語を移動できます。同じ外部IDの語彙情報は上書きされます。</p>
          <p className="muted">復習日・学習履歴の変更、単語の削除、データベース全体へのアクセス権限は含みません。</p>
        </>}
        {loading ? <p role="status">ログイン状態を確認しています…</p> : session ? <>
          <p>ログイン中: {session.user.email}</p>
          <div className="connection-actions">
            <button className="btn" disabled={busy} onClick={() => perform(() => decide(true))}>{signedRequest ? "単語の追加・更新を許可" : "接続許可をすべて取り消す"}</button>
            {signedRequest && <button className="btn ghost" disabled={busy} onClick={() => perform(() => decide(false))}>許可しない</button>}
            <button className="btn light" disabled={busy} onClick={() => perform(async () => {
              const { error } = await browserSupabase().auth.signOut();
              if (error) throw new Error("ログアウトに失敗しました");
            })}>別のアカウントでログイン</button>
          </div>
        </> : <div>
          <p>単語帳と同じアカウントでログインしてください。</p>
          <PasswordLogin idPrefix="connection-login" connection />
        </div>}
      </>}
      {message && <p role="status">{message}</p>}
      <p><a href="/">単語帳へ戻る</a></p>
    </section>
  </main>;
}
