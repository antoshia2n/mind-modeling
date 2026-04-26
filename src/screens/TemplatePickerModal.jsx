import { useState, useEffect } from "react";

const BORDER = "#e2e8f0";
const PURPLE = "#a855f7";

/**
 * テンプレート選択モーダル（テンプレ挿入・新規マップ作成に共用）
 * props:
 *   userId
 *   mode: "insert" | "new_map"
 *   onClose
 *   onSelect(templateId) - 選択確定
 */
export function TemplatePickerModal({ userId, mode, onClose, onSelect }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [debSearch, setDeb]   = useState("");

  useEffect(() => { const t = setTimeout(() => setDeb(search), 250); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    if (!userId) return;
    const qs = new URLSearchParams({ user_id: userId, limit: "100" });
    if (debSearch) qs.set("search", debSearch);
    fetch(`/api/internal/list-templates?${qs}`, {
      headers: { "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
    })
      .then(r => r.json())
      .then(d => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [userId, debSearch]);

  const title = mode === "insert" ? "テンプレートを挿入" : "テンプレートから新規マップ";

  const s = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
    modal: { background: "#fff", borderRadius: 14, padding: "20px 24px", width: 500, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    modalTitle: { fontSize: 16, fontWeight: 700, color: "#374151", marginBottom: 14 },
    searchInput: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#374151", fontFamily: "inherit", outline: "none", marginBottom: 12, width: "100%", boxSizing: "border-box" },
    list: { flex: 1, overflowY: "auto" },
    card: (h) => ({ padding: "12px 14px", borderRadius: 9, marginBottom: 8, cursor: "pointer", background: h ? "#f5f3ff" : "#f9fafb", border: `1px solid ${h ? PURPLE : BORDER}` }),
    name: { fontSize: 14, fontWeight: 600, color: "#374151" },
    meta: { fontSize: 11, color: "#94a3b8", marginTop: 3 },
    cancelBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#6b7280", cursor: "pointer", marginTop: 14, alignSelf: "flex-end" },
    empty: { textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 24 },
  };

  const [hoverId, setHoverId] = useState(null);

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.modalTitle}>{title}</div>
        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="テンプレート名で検索..." autoFocus />
        <div style={s.list}>
          {loading ? <div style={s.empty}>読み込み中...</div> :
           items.length === 0 ? <div style={s.empty}>{debSearch ? "検索結果がありません。" : "テンプレートがありません。"}</div> :
           items.map(t => (
            <div key={t.id} style={s.card(hoverId === t.id)}
              onMouseEnter={() => setHoverId(t.id)} onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelect(t.id)}>
              <div style={s.name}>{t.name}</div>
              <div style={s.meta}>{t.node_count}ノード ・ 使用 {t.use_count}回{t.description ? ` ・ ${t.description}` : ""}</div>
            </div>
          ))}
        </div>
        <button style={s.cancelBtn} onClick={onClose}>キャンセル</button>
      </div>
    </div>
  );
}

/**
 * マップ選択モーダル（マップリンク設定に使用）
 * props:
 *   maps        - 選択候補のマップ一覧（現在マップは除外済み）
 *   currentLink - 現在設定されているlinked_map_id（あれば）
 *   onClose
 *   onSelect(mapId | null) - null = リンク解除
 */
export function MapPickerModal({ maps, currentLink, onClose, onSelect }) {
  const [search,  setSearch]  = useState("");
  const [hoverId, setHoverId] = useState(null);

  const filtered = maps.filter(m => !search.trim() || (m.title || "").toLowerCase().includes(search.toLowerCase()));

  const s = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
    modal: { background: "#fff", borderRadius: 14, padding: "20px 24px", width: 480, maxWidth: "92vw", maxHeight: "75vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    modalTitle: { fontSize: 16, fontWeight: 700, color: "#374151", marginBottom: 14 },
    searchInput: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#374151", fontFamily: "inherit", outline: "none", marginBottom: 12, width: "100%", boxSizing: "border-box" },
    list: { flex: 1, overflowY: "auto" },
    card: (h, active) => ({ padding: "10px 14px", borderRadius: 9, marginBottom: 8, cursor: "pointer", background: active ? "#f0fdf4" : (h ? "#f5f3ff" : "#f9fafb"), border: `1px solid ${active ? "#86efac" : (h ? PURPLE : BORDER)}` }),
    mapTitle: { fontSize: 14, fontWeight: 600, color: "#374151" },
    mapDate:  { fontSize: 11, color: "#94a3b8", marginTop: 2 },
    bottomRow: { display: "flex", gap: 8, marginTop: 14, justifyContent: "space-between" },
    unlinkBtn: { background: "none", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 14px", fontSize: 13, color: "#ef4444", cursor: "pointer" },
    cancelBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#6b7280", cursor: "pointer" },
  };

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.modalTitle}>リンク先マップを選択</div>
        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="マップ名で検索..." autoFocus />
        <div style={s.list}>
          {filtered.length === 0 ? <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 24 }}>マップがありません。</div> :
           filtered.map(m => (
            <div key={m.id} style={s.card(hoverId === m.id, m.id === currentLink)}
              onMouseEnter={() => setHoverId(m.id)} onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelect(m.id)}>
              <div style={s.mapTitle}>{m.title || "Untitled"}{m.id === currentLink ? " ✓" : ""}</div>
              <div style={s.mapDate}>{new Date(m.updated_at).toLocaleDateString("ja-JP")}</div>
            </div>
          ))}
        </div>
        <div style={s.bottomRow}>
          {currentLink && <button style={s.unlinkBtn} onClick={() => onSelect(null)}>リンク解除</button>}
          <button style={s.cancelBtn} onClick={onClose}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
