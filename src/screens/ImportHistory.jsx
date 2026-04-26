import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { navigate } from "../lib/navigate.js";

const BORDER = "#e2e8f0";
const PURPLE = "#a855f7";

export default function ImportHistory() {
  const uid = useAuthUid();
  const [items,     setItems]     = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState("");
  const [debSearch, setDebSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ user_id: uid, limit: "200" });
    if (debSearch) qs.set("search", debSearch);
    fetch(`/api/internal/list-import-history?${qs}`, {
      headers: { "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
    })
      .then(async res => {
        if (!res.ok) {
          setError(res.status === 401 ? "認証エラー：VITE_MM_INTERNAL_SECRET を確認してください。" : `取得に失敗しました（HTTP ${res.status}）`);
          return;
        }
        const data = await res.json();
        setItems(data.items ?? []); setTotal(data.total ?? 0);
      })
      .catch(() => setError("ネットワークエラーが発生しました。"))
      .finally(() => setLoading(false));
  }, [uid, debSearch]);

  const totalNodes = items.reduce((sum, i) => sum + (i.node_count ?? 0), 0);

  const s = {
    wrap:        { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header:      { padding: "12px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 14, height: 53, boxSizing: "border-box" },
    backBtn:     { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 700 },
    importBtn:   { background: PURPLE, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" },
    body:        { padding: "24px 32px", maxWidth: 760, margin: "0 auto" },
    stats:       { display: "flex", gap: 24, marginBottom: 20, padding: "14px 20px", background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10 },
    statItem:    { display: "flex", flexDirection: "column", gap: 2 },
    statLabel:   { fontSize: 11, color: T.muted },
    statValue:   { fontSize: 20, fontWeight: 800, color: T.fg },
    searchInput: { width: "100%", boxSizing: "border-box", background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 14px", fontSize: 14, color: T.fg, fontFamily: "inherit", outline: "none", marginBottom: 16 },
    errorBox:    { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#dc2626", marginBottom: 20 },
    empty:       { textAlign: "center", color: T.muted, fontSize: 14, padding: 40, lineHeight: 1.8 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate("/")}>← 一覧</button>
        <div style={s.headerTitle}>インポート履歴</div>
        <button style={s.importBtn} onClick={() => navigate("/import")}>+ 新規インポート</button>
      </div>

      <div style={s.body}>
        {error && <div style={s.errorBox}>{error}</div>}

        {!loading && !error && (
          <div style={s.stats}>
            <div style={s.statItem}><span style={s.statLabel}>移行済みマップ</span><span style={s.statValue}>{total.toLocaleString()}</span></div>
            <div style={s.statItem}><span style={s.statLabel}>取り込みノード合計</span><span style={s.statValue}>{totalNodes.toLocaleString()}</span></div>
          </div>
        )}

        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="マップ名・メモで検索..." />

        {loading ? (
          <div style={s.empty}>読み込み中...</div>
        ) : items.length === 0 ? (
          <div style={s.empty}>{debSearch ? "検索結果がありません。" : "まだインポート履歴がありません。"}</div>
        ) : items.map(item => {
          const isDeleted = !item.map_id;
          return (
            <div
              key={item.id}
              onClick={() => !isDeleted && navigate(`/m/${item.map_id}`)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "12px 16px", background: T.surface,
                border: `1px solid ${BORDER}`, borderRadius: 9, marginBottom: 8,
                // 削除済みはクリック不可・グレーアウト
                cursor: isDeleted ? "default" : "pointer",
                opacity: isDeleted ? 0.5 : 1,
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { if (!isDeleted) e.currentTarget.style.background = "#f1f5f9"; }}
              onMouseLeave={e => e.currentTarget.style.background = T.surface}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: isDeleted ? 400 : 600,
                  color: isDeleted ? T.muted : T.fg,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {item.map_title || "Untitled"}
                  {isDeleted && <span style={{ fontSize: 11, marginLeft: 6, fontStyle: "italic" }}>（削除済み・開けません）</span>}
                </div>
                {item.source_note && (
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📝 {item.source_note}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, color: PURPLE, fontWeight: 700, flexShrink: 0 }}>{item.node_count}ノード</div>
              <div style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>
                {new Date(item.imported_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
