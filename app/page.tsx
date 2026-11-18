"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import type { Card } from "./components/study-deck";
import { LibraryDeck } from "./components/library-deck";
import type { Rating } from "@/lib/scheduling";
import PasswordLogin from "./components/password-login";

const publicConfig = getSupabasePublicConfig();
const configured = Boolean(publicConfig.url && publicConfig.key);
const cardFields = "id,set_id,is_flagged,last_rating,word,japanese_meaning,explanation,example,part_of_speech,due_at,repetitions,interval_days,ease_factor";

type Toast = { text: string; tone: "info" | "error" };

export default function Home() {
  const supabase = useMemo(() => configured ? browserSupabase() : null, []);
  const [user, setUser] = useState<User | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [authLoading, setAuthLoading] = useState(configured);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const actionInFlight = useRef(false);
  const pendingSaves = useRef(new Map<string, Promise<void>>());

  const notify = useCallback((text: string, tone: Toast["tone"] = "info") => setToast({ text, tone }), []);

  useEffect(() => {
    if (!toast || toast.tone === "error") return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (event === "SIGNED_OUT") {
        setCards([]);
        setToast(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    const { data, error } = await supabase.from("cards").select(cardFields).order("due_at").limit(1000);
    if (error) throw error;
    setCards(data ?? []);
  }, [supabase, user]);

  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    setCardsLoading(true);
    void supabase.from("cards").select(cardFields).order("due_at").limit(1000).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setToast({ text: error.message, tone: "error" });
      else setCards(data ?? []);
      setCardsLoading(false);
    });
    return () => { cancelled = true; };
  }, [supabase, user]);

  async function authHeader() {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) throw new Error("ログインしてください");
    return { Authorization: "Bearer " + session.access_token };
  }

  async function runAction(action: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setToast(null);
    try {
      await action();
    } catch (error) {
      notify(error instanceof Error ? error.message : "通信に失敗しました。もう一度お試しください。", "error");
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function reloadCards() {
    await runAction(async () => {
      await refresh();
      notify("単語を更新しました");
    });
  }

  // Reviews are saved in the background so the next card appears immediately.
  // Saves for the same card are chained so the server sees them in order.
  async function saveReview(cardId: string, rating: Rating): Promise<void> {
    const previous = pendingSaves.current.get(cardId);
    const task = (async () => {
      if (previous) await previous.catch(() => undefined);
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { ...(await authHeader()), "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, rating }),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("回答を保存できませんでした。もう一度お試しください。");
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "回答を保存できませんでした");
      setCards((current) => current.map((card) => card.id === cardId ? {
        ...card,
        last_rating: rating,
        due_at: body.due_at,
        repetitions: body.repetitions ?? (rating === "Again" ? 0 : card.repetitions + 1),
        interval_days: body.interval_days ?? card.interval_days,
        ease_factor: body.ease_factor ?? card.ease_factor,
      } : card));
    })();
    pendingSaves.current.set(cardId, task);
    try {
      await task;
    } finally {
      if (pendingSaves.current.get(cardId) === task) pendingSaves.current.delete(cardId);
    }
  }

  return (
    <>
      <header className="app-bar">
        <a className="brand" href="/" aria-label="Anki App ホーム">
          <span className="brand-mark" aria-hidden="true" />
          <span>Anki App</span>
        </a>
        {user && <nav className="app-nav" aria-label="アカウント">
          <a className="btn quiet small" href="/connections">AI接続</a>
          <button className="btn quiet small" disabled={busy} onClick={() => runAction(async () => {
            const { error } = await supabase!.auth.signOut();
            if (error) throw error;
          })}>ログアウト</button>
        </nav>}
      </header>
      <main className="shell">
        {!configured ? (
          <section className="glass panel">
            <h2>環境変数の設定が必要です</h2>
            <p>READMEの手順に従ってSupabaseを接続してください。</p>
          </section>
        ) : authLoading ? (
          <p className="glass panel loading-panel" role="status"><span className="spinner" aria-hidden="true" />ログイン状態を確認しています…</p>
        ) : !user ? (
          <section className="glass panel login-panel">
            <span className="brand-mark large" aria-hidden="true" />
            <h1>おかえりなさい</h1>
            <p className="muted">ログインして、今日の単語を復習しましょう。</p>
            <PasswordLogin />
          </section>
        ) : (
          <LibraryDeck key={user.id} userId={user.id} cards={cards} loading={cardsLoading} refreshing={busy}
            onRefresh={reloadCards} onRate={saveReview} onNotify={notify}
            onAssigned={(id, setId) => setCards((current) => current.map((card) => card.id === id ? { ...card, set_id: setId } : card))}
            onFlagged={(id, flagged) => setCards((current) => current.map((card) => card.id === id ? { ...card, is_flagged: flagged } : card))} />
        )}
      </main>
      {toast && <div className={`toast glass ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
        <span>{toast.text}</span>
        <button className="toast-close" aria-label="閉じる" onClick={() => setToast(null)}>×</button>
      </div>}
    </>
  );
}
