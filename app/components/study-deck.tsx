"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Rating } from "@/lib/scheduling";
import { prioritizeCards } from "@/lib/study-order";

export type Card = {
  id: string;
  set_id: string | null;
  is_flagged: boolean;
  last_rating: Rating | null;
  word: string;
  japanese_meaning: string;
  explanation: string;
  example: string;
  part_of_speech: string | null;
  due_at: string;
  repetitions: number;
  interval_days: number;
  ease_factor: number;
};

const SESSION_SIZE = 10;
type SwipeRating = "Again" | "Good";

type Session = {
  queue: Card[];
  remaining: Card[];
  total: number;
  done: number;
  step: number;
  tally: Record<SwipeRating, number>;
};

function makeBatch(ordered: Card[]): Session {
  const queue = ordered.slice(0, SESSION_SIZE);
  return { queue, remaining: ordered.slice(SESSION_SIZE), total: queue.length, done: 0, step: 0, tally: { Again: 0, Good: 0 } };
}

function formatUntil(ms: number) {
  const minutes = ms / 60_000;
  if (minutes < 1) return "まもなく";
  if (minutes < 60) return `${Math.ceil(minutes)}分後`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}時間後`;
  return `${Math.round(hours / 24)}日後`;
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function readPreference(key: string) {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}

function writePreference(key: string, value: boolean) {
  try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* storage unavailable */ }
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function SpeakerIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>;
}

export function StudyDeck({ cards, loading, refreshing, onRefresh, onRate, onNotify, sets, onAssign, onSessionChange, onFlag }: {
  sets: { id: string; name: string; folderName: string }[];
  onAssign: (cardId: string, setId: string | null) => Promise<void>;
  onSessionChange: (active: boolean) => void;
  onFlag: (cardId: string, flagged: boolean) => Promise<void>;
  cards: Card[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRate: (cardId: string, rating: Rating) => Promise<void>;
  onNotify: (text: string, tone?: "info" | "error") => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [pending, setPending] = useState(0);
  const [canSpeak, setCanSpeak] = useState(false);
  const [query, setQuery] = useState("");
  const [flagPending, setFlagPending] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; horizontal: boolean; vertical: boolean } | null>(null);
  const skipClick = useRef(false);
  const rateLock = useRef(false);
  const [dragX, setDragX] = useState(0);
  const startButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setReverse(readPreference("tango:reverse"));
    setShuffle(readPreference("tango:shuffle"));
    setCanSpeak("speechSynthesis" in window);
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const due = useMemo(() => cards.filter((card) => new Date(card.due_at).getTime() <= now), [cards, now]);
  const learning = cards.filter((card) => card.repetitions > 0).length;
  const nextDue = useMemo(() => {
    const upcoming = cards.map((card) => new Date(card.due_at).getTime()).filter((time) => time > now);
    return upcoming.length ? Math.min(...upcoming) : null;
  }, [cards, now]);

  const current = session?.queue[0] ?? null;
  const finished = session !== null && session.queue.length === 0;

  const focusStage = () => requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }));

  function start(practiceAll: boolean) {
    const pool = practiceAll ? cards : due;
    if (pool.length === 0) return;
    const queue = shuffle ? shuffled(pool) : prioritizeCards(pool);
    onSessionChange(true);
    setSession(makeBatch(queue));
    setRevealed(false);
    setNow(Date.now());
    window.scrollTo({ top: 0 });
    focusStage();
  }

  function continueBatch() {
    if (!session || pending > 0 || session.remaining.length === 0) return;
    setSession(makeBatch(session.remaining));
    setRevealed(false);
    setDragX(0);
    window.scrollTo({ top: 0 });
    focusStage();
  }

  function exit() {
    if (pending > 0) return;
    setSession(null);
    onSessionChange(false);
    setRevealed(false);
    setNow(Date.now());
    requestAnimationFrame(() => startButton.current?.focus());
  }

  const rate = useCallback((rating: Rating) => {
    if (!current || !revealed || rateLock.current || (rating !== "Again" && rating !== "Good")) return;
    rateLock.current = true;
    const card = current;
    setSession((state) => {
      if (!state) return state;
      const rest = state.queue.slice(1);
      return {
        ...state,
        queue: rest,
        done: state.done + 1,
        step: state.step + 1,
        tally: { ...state.tally, [rating]: state.tally[rating] + 1 },
      };
    });
    setRevealed(false);
    setDragX(0);
    focusStage();
    setPending((count) => count + 1);
    onRate(card.id, rating)
      .catch((error: unknown) => {
        onNotify(`「${card.word}」の評価を保存できませんでした。もう一度出題します。${error instanceof Error ? `（${error.message}）` : ""}`, "error");
        setSession((state) => state && {
          ...state,
          queue: [...state.queue.filter((item) => item.id !== card.id), card],
          done: Math.max(0, state.done - 1),
          tally: { ...state.tally, [rating]: state.tally[rating] - 1 },
        });
      })
      .finally(() => setPending((count) => count - 1));
  }, [current, revealed, onRate, onNotify]);

  useEffect(() => { rateLock.current = false; }, [session?.step]);

  useEffect(() => {
    if (!session || finished) return;
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, a, button")) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!revealed) setRevealed(true);
      } else if (revealed && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        rate(event.key === "ArrowLeft" ? "Again" : "Good");
      } else if (event.key === "Escape") {
        event.preventDefault();
        exit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return cards;
    return cards.filter((card) => card.word.toLowerCase().includes(term) || card.japanese_meaning.toLowerCase().includes(term));
  }, [cards, query]);

  // ---------- Study session ----------
  if (session && current) {
    const front = reverse ? current.japanese_meaning : current.word;
    const frontLang = reverse ? "ja" : "en";
    const back = reverse ? current.word : current.japanese_meaning;
    const backLang = reverse ? "en" : "ja";
    const progress = session.total ? Math.round((session.done / session.total) * 100) : 0;
    return (
      <section className="study" aria-label="学習中" ref={stage} tabIndex={-1}>
        <div className="study-top">
          <button className="btn quiet small icon-only" onClick={exit} disabled={pending > 0} aria-label="学習を終了">✕</button>
          <div className="progress" role="progressbar" aria-label="進捗" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={session.done}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-count">{session.done}<span className="muted"> / {session.total}</span></span>
        </div>

        <div className="flip-scene">
          <div className="swipe-card" style={{ transform: `translateX(${dragX}px) rotate(${dragX / 24}deg)` }}>
          <button key={`${current.id}-${session.step}`} type="button" className={`flip-card${revealed ? " is-flipped" : ""}`}
            aria-label={revealed ? "答えを表示中。左右にスワイプして評価" : "カードをタップして答えを見る"} aria-pressed={revealed}
            onPointerDown={(event) => {
              if (!revealed || (event.pointerType === "mouse" && event.button !== 0)) return;
              gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, vertical: false };
              skipClick.current = false;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const g = gesture.current;
              if (!g || g.id !== event.pointerId) return;
              const dx = event.clientX - g.x, dy = event.clientY - g.y;
              if (!g.horizontal && !g.vertical && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
                g.horizontal = Math.abs(dx) > Math.abs(dy); g.vertical = !g.horizontal;
              }
              if (g.horizontal) { skipClick.current = true; setDragX(dx); }
            }}
            onPointerUp={(event) => {
              const g = gesture.current;
              if (!g || g.id !== event.pointerId) return;
              gesture.current = null;
              const dx = event.clientX - g.x;
              setDragX(0);
              if (g.horizontal) setTimeout(() => { skipClick.current = false; }, 0);
              if (g.horizontal && Math.abs(dx) >= Math.min(80, event.currentTarget.clientWidth * .22)) rate(dx < 0 ? "Again" : "Good");
            }}
            onPointerCancel={() => { gesture.current = null; setDragX(0); skipClick.current = false; }}
            onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setRevealed((value) => !value); focusStage(); }}>
            <span className="face face-front glass-card" aria-hidden={revealed}>
              <span className="face-label">{reverse ? "日本語" : "English"}</span>
              <span className="face-word" lang={frontLang}>{front}</span>
              <span className="face-hint muted">タップで答えを表示</span>
            </span>
            <span className="face face-back glass-card" aria-hidden={!revealed}>
              <span className="face-label">{reverse ? "English" : "日本語"}</span>
              <span className="face-question muted" lang={frontLang}>{front}</span>
              <span className="face-word answer" lang={backLang}>{back}</span>
              {current.part_of_speech && <span className="chip">{current.part_of_speech}</span>}
              {current.explanation && <span className="face-detail">{current.explanation}</span>}
              {current.example && <span className="face-example" lang="en">{current.example}</span>}
            </span>
          </button>
          {revealed && Math.abs(dragX) > 16 && <span className={`swipe-indicator ${dragX < 0 ? "left" : "right"}`} aria-hidden="true">{dragX < 0 ? "もう一度" : "大丈夫"}</span>}
          </div>
          {canSpeak && (!reverse || revealed) && <button type="button" className="speak-btn" aria-label={`${current.word}を発音`}
            onClick={() => speak(current.word)}><SpeakerIcon /></button>}
        </div>

        <div className="swipe-hints" aria-label="カードの操作方法">
          <span>← もう一度</span><span>大丈夫 →</span>
        </div>
        <p className="swipe-instruction muted">{revealed ? "カードを左右にスライド" : "カードをタップして答えを見る"}</p>
        {revealed && <div className="swipe-alternatives" aria-label="スワイプの代わりに評価">
          <button className="btn quiet small" onClick={() => rate("Again")}>← もう一度</button>
          <button className="btn quiet small" onClick={() => rate("Good")}>大丈夫 →</button>
        </div>}
        <p className="kbd-help muted">Space 答え · ← もう一度 · → 大丈夫 · Esc 終了</p>
      </section>
    );
  }

  // ---------- Session summary ----------
  if (finished) {
    const reviewed = session.done;
    return (
      <section className="glass panel summary" aria-labelledby="summary-heading" ref={stage} tabIndex={-1}>
        <span className="summary-icon" aria-hidden="true">✓</span>
        <h1 id="summary-heading">お疲れさまでした</h1>
        <p className="muted">{reviewed}枚のカードを学習しました。{pending > 0 && "（保存しています…）"}</p>
        <dl className="tally tally-two">
          <div className="tally-item rate-again"><dt>もう一度</dt><dd>{session.tally.Again}</dd></div>
          <div className="tally-item rate-good"><dt>大丈夫</dt><dd>{session.tally.Good}</dd></div>
        </dl>
        <div className="summary-actions">
          {session.remaining.length > 0 && <button className="btn primary" disabled={pending > 0} onClick={continueBatch}>次の{Math.min(SESSION_SIZE, session.remaining.length)}単語へ</button>}
          <button ref={startButton} className={`btn ${session.remaining.length > 0 ? "glassy" : "primary"}`} disabled={pending > 0} onClick={exit}>ホームに戻る</button>
        </div>
      </section>
    );
  }

  // ---------- Home ----------
  return (
    <>
      <section className="glass panel deck" aria-labelledby="deck-heading" aria-busy={loading}>
        <div className="deck-head">
          <div>
            <span className="eyebrow">Anki App × English</span>
            <h1 id="deck-heading">単語帳</h1>
            <p className="muted">苦手な単語を優先して復習します</p>
          </div>
          <button className="btn quiet small icon-only" onClick={onRefresh} disabled={refreshing}
            aria-label="単語を更新" title="単語を更新"><span className={refreshing ? "spin" : undefined} aria-hidden="true">↻</span></button>
        </div>

        <div className="stats" aria-label="学習状況">
          <div className="stat accent"><strong>{loading ? "—" : due.length}</strong><span>復習待ち</span></div>
          <div className="stat"><strong>{loading ? "—" : learning}</strong><span>学習中</span></div>
          <div className="stat"><strong>{loading ? "—" : cards.length}</strong><span>全単語</span></div>
        </div>

        {loading ? (
          <p className="deck-status muted" role="status"><span className="spinner" aria-hidden="true" />単語を読み込んでいます…</p>
        ) : cards.length === 0 ? (
          <p className="deck-status" role="status">該当する単語はありません。絞り込みを変更するか、単語を追加してください。</p>
        ) : due.length === 0 ? (
          <p className="deck-status" role="status">🎉 今日の復習はすべて完了しました。{nextDue && <span className="muted">次の復習は{formatUntil(nextDue - now)}です。</span>}</p>
        ) : null}

        <div className="deck-actions">
          <button ref={startButton} className="btn primary large" disabled={loading || due.length === 0} onClick={() => start(false)}>
            {due.length > 0 ? `復習を始める（${due.length}枚）` : "復習するカードはありません"}
          </button>
          <button className="btn glassy" disabled={loading || cards.length === 0} onClick={() => start(true)}>
            すべてのカードを練習
          </button>
        </div>

        <div className="options">
          <div className="segmented" role="radiogroup" aria-label="出題方向">
            <button role="radio" aria-checked={!reverse} className={!reverse ? "on" : ""}
              onClick={() => { setReverse(false); writePreference("tango:reverse", false); }}>英 → 日</button>
            <button role="radio" aria-checked={reverse} className={reverse ? "on" : ""}
              onClick={() => { setReverse(true); writePreference("tango:reverse", true); }}>日 → 英</button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={shuffle}
              onChange={(event) => { setShuffle(event.target.checked); writePreference("tango:shuffle", event.target.checked); }} />
            <span className="switch-track" aria-hidden="true" />
            シャッフル
          </label>
        </div>
      </section>

      <section className="glass panel" aria-labelledby="vocabulary-heading">
        <div className="list-head">
          <h2 id="vocabulary-heading">単語一覧 <span className="muted count">{cards.length}</span></h2>
          <input className="input search" type="search" placeholder="単語・意味を検索" aria-label="単語を検索"
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {filtered.length === 0 ? (
          <p className="muted empty-list">{cards.length === 0 ? "登録された単語はまだありません。" : "一致する単語がありません。"}</p>
        ) : (
          <ul className="word-list">
            {filtered.slice(0, 200).map((card) => {
              const dueIn = new Date(card.due_at).getTime() - now;
              return (
                <li key={card.id} className="word-row">
                  <button type="button" className={`flag-button${card.is_flagged ? " flagged" : ""}`} aria-label={`${card.word}のフラグ`} aria-pressed={!!card.is_flagged}
                    disabled={flagPending.includes(card.id)} onClick={() => {
                      setFlagPending((old) => [...old, card.id]);
                      void onFlag(card.id, !card.is_flagged).catch(() => onNotify("フラグを保存できませんでした。", "error"))
                        .finally(() => setFlagPending((old) => old.filter((id) => id !== card.id)));
                    }}>{card.is_flagged ? "★" : "☆"}</button>
                  <details className="word">
                    <summary>
                      <span className="word-en" lang="en">{card.word}</span>
                      <span className="word-ja">{card.japanese_meaning}</span>
                      <span className={`pill${dueIn <= 0 ? " due" : ""}`}>{dueIn <= 0 ? "復習待ち" : formatUntil(dueIn)}</span>
                    </summary>
                    <div className="word-body">
                      {card.part_of_speech && <span className="chip">{card.part_of_speech}</span>}
                      <label>セット
                        <select className="input" aria-label="セット" value={card.set_id ?? ""} onChange={(event) => { void onAssign(card.id, event.target.value || null).catch(() => onNotify("セットを変更できませんでした。", "error")); }}>
                          <option value="">未分類</option>
                          {sets.map((set) => <option key={set.id} value={set.id}>{set.folderName} / {set.name}</option>)}
                        </select>
                      </label>
                      {card.explanation && <p>{card.explanation}</p>}
                      {card.example && <p className="face-example" lang="en">{card.example}</p>}
                      {canSpeak && <button type="button" className="btn quiet small" onClick={() => speak(card.word)}>
                        <SpeakerIcon /> 発音を聞く
                      </button>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > 200 && <p className="muted">先頭200件を表示しています。検索で絞り込めます。</p>}
      </section>
    </>
  );
}
