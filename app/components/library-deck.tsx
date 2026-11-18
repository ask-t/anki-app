"use client";

import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase";
import { StudyDeck, type Card } from "./study-deck";
import type { Rating } from "@/lib/scheduling";

type Folder = { id: string; name: string };
type SetItem = { id: string; folder_id: string; name: string };

export function LibraryDeck({ userId, cards, loading, refreshing, onRefresh, onRate, onNotify, onAssigned, onFlagged }: {
  userId: string; cards: Card[]; loading: boolean; refreshing: boolean;
  onRefresh: () => void; onRate: (id: string, rating: Rating) => Promise<void>;
  onNotify: (text: string, tone?: "info" | "error") => void;
  onAssigned: (id: string, setId: string | null) => void;
  onFlagged: (id: string, flagged: boolean) => void;
}) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [sets, setSets] = useState<SetItem[]>([]);
  const [folderId, setFolderId] = useState("");
  const [filter, setFilter] = useState("all");
  const [folderName, setFolderName] = useState("");
  const [setName, setSetName] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [studying, setStudying] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [ratingFilter, setRatingFilter] = useState("all");
  useEffect(() => {
    let active = true;
    const db = browserSupabase();
    void Promise.all([
      db.from("folders").select("id,name").order("created_at"),
      db.from("study_sets").select("id,folder_id,name").order("created_at"),
    ]).then(([foldersResult, setsResult]) => {
      if (!active) return;
      if (foldersResult.error || setsResult.error) { onNotify("フォルダーとセットを読み込めませんでした。", "error"); return; }
      setFolders(foldersResult.data ?? []); setSets(setsResult.data ?? []);
    });
    return () => { active = false; };
  }, [userId, onNotify]);

  async function create(kind: "folder" | "set") {
    const name = (kind === "folder" ? folderName : setName).trim();
    if (!name || (kind === "set" && !folderId) || busy) return;
    setBusy(true);
    try {
      const db = browserSupabase();
      if (kind === "folder") {
        const { data, error } = await db.from("folders").insert({ user_id: userId, name }).select("id,name").single();
        if (error) throw error;
        setFolders((old) => [...old, data]); setFolderId(data.id); setFolderName("");
      } else {
        const { data, error } = await db.from("study_sets").insert({ user_id: userId, name, folder_id: folderId }).select("id,folder_id,name").single();
        if (error) throw error;
        setSets((old) => [...old, data]); setFilter(data.id); setSetName(""); setCreating(false);
      }
      onNotify(kind === "folder" ? "フォルダーを作成しました" : "セットを作成しました");
    } catch { onNotify("作成できませんでした。接続を確認してください。", "error"); }
    finally { setBusy(false); }
  }
  const namedSets = sets.map((set) => ({ ...set, folderName: folders.find((folder) => folder.id === set.folder_id)?.name ?? "フォルダー" }));
  const visibleCards = cards.filter((card) => (filter === "all" || (filter === "unassigned" ? !card.set_id : card.set_id === filter)) && (!flaggedOnly || card.is_flagged) && (ratingFilter === "all" || (ratingFilter === "unrated" ? !card.last_rating : card.last_rating === ratingFilter)));
  async function assign(cardId: string, setId: string | null) {
    const { data, error } = await browserSupabase().from("cards").update({ set_id: setId }).eq("id", cardId).eq("user_id", userId).select("id").single();
    if (error || !data) throw error ?? new Error("Card not found");
    onAssigned(cardId, setId);
    onNotify("セットを変更しました");
  }
  async function flag(cardId: string, flagged: boolean) {
    const { data, error } = await browserSupabase().from("cards").update({ is_flagged: flagged }).eq("id", cardId).eq("user_id", userId).select("id").single();
    if (error || !data) throw error ?? new Error("Card not found");
    onFlagged(cardId, flagged);
  }
  return <>
    {!studying && <section className="glass panel library" aria-labelledby="library-title">
      <div className="library-head">
        <h2 id="library-title">フォルダーとセット</h2>
        <button type="button" className="btn glassy small library-add" aria-label={creating ? "作成フォームを閉じる" : "フォルダー・セットを追加"}
          aria-expanded={creating} aria-controls="library-create" onClick={() => setCreating((current) => !current)}>{creating ? "×" : "+"}</button>
      </div>
      {creating && <div className="library-forms" id="library-create">
        <form onSubmit={(event) => { event.preventDefault(); void create("folder"); }}>
          <label htmlFor="folder-name">新しいフォルダー</label>
          <input className="input" id="folder-name" maxLength={100} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="例：英検" required />
          <button className="btn glassy" disabled={busy}>フォルダーを作成</button>
        </form>
        <form onSubmit={(event) => { event.preventDefault(); void create("set"); }}>
          <label htmlFor="set-folder">セットのフォルダー</label>
          <select className="input" id="set-folder" value={folderId} onChange={(event) => setFolderId(event.target.value)} required>
            <option value="">フォルダーを選択</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
          <label htmlFor="set-name">新しいセット</label>
          <input className="input" id="set-name" maxLength={100} value={setName} onChange={(event) => setSetName(event.target.value)} placeholder="例：基本単語" required />
          <button className="btn glassy" disabled={busy || !folderId}>セットを作成</button>
        </form>
      </div>}
      <label htmlFor="set-filter">表示・学習するセット</label>
      <select className="input" id="set-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">すべての単語</option><option value="unassigned">未分類</option>
        {folders.map((folder) => <optgroup key={folder.id} label={folder.name}>{sets.filter((set) => set.folder_id === folder.id).map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</optgroup>)}
      </select>
      <label htmlFor="rating-filter">前回の評価</label>
      <select className="input" id="rating-filter" value={ratingFilter} onChange={(event) => setRatingFilter(event.target.value)}>
        <option value="all">すべての評価</option><option value="Again">もう一度</option><option value="Hard">難しい</option><option value="Good">覚えた</option><option value="Easy">簡単</option><option value="unrated">未評価</option>
      </select>
      <label className="flag-filter"><input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} /> フラグ付きのみ</label>
    </section>}
    <StudyDeck key={`${filter}-${flaggedOnly}-${ratingFilter}`} cards={visibleCards} loading={loading} refreshing={refreshing} onRefresh={onRefresh} onRate={onRate} onNotify={onNotify} sets={namedSets} onAssign={assign} onSessionChange={setStudying} onFlag={flag} />
  </>;
}
