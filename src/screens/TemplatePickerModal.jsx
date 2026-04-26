import { useState, useEffect } from "react";

const BORDER = "#e2e8f0";
const PURPLE = "#a855f7";
const FOLDER_COLOR = "#f59e0b";

function authH() {
  return { "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` };
}

// フラット配列からツリーを組み立てる
function buildTree(folders) {
  const byParent = {};
  for (const f of folders) {
    const key = f.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(f);
  }
  function build(pid) { return (byParent[pid] ?? []).map(f => ({ ...f, children: build(f.id) })); }
  return build("__root__");
}

/**
 * テンプレート選択モーダル（テンプレ挿入・新規マップ作成に共用）
 */
export function TemplatePickerModal({ userId, mode, onClose, onSelect }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [deb,     setDeb]     = useState("");
  const [hoverId, setHoverId] = useState(null);

  useEffect(() => { const t = setTimeout(() => setDeb(search), 250); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    if (!userId) return;
    const qs = new URLSearchParams({ user_id: userId, limit: "100" });
    if (deb) qs.set("search", deb);
    fetch(`/api/internal/list-templates?${qs}`, { headers: authH() })
      .then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [userId, deb]);

  const s = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
    modal: { background: "#fff", borderRadius: 14, padding: "20px 24px", width: 500, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    title: { fontSize: 16, fontWeight: 700, color: "#374151", marginBottom: 14 },
    search: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#374151", fontFamily: "inherit", outline: "none", marginBottom: 12, width: "100%", boxSizing: "border-box" },
    list: { flex: 1, overflowY: "auto" },
    card: (h) => ({ padding: "12px 14px", borderRadius: 9, marginBottom: 8, cursor: "pointer", background: h ? "#f5f3ff" : "#f9fafb", border: `1px solid ${h ? PURPLE : BORDER}` }),
    name: { fontSize: 14, fontWeight: 600, color: "#374151" },
    meta: { fontSize: 11, color: "#94a3b8", marginTop: 3 },
    cancelBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#6b7280", cursor: "pointer", marginTop: 14, alignSelf: "flex-end" },
    empty: { textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 24 },
  };

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.title}>{mode === "insert" ? "テンプレートを挿入" : "テンプレートから新規マップ"}</div>
        <input style={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="テンプレート名で検索..." autoFocus />
        <div style={s.list}>
          {loading ? <div style={s.empty}>読み込み中...</div> :
           items.length === 0 ? <div style={s.empty}>{deb ? "検索結果がありません。" : "テンプレートがありません。"}</div> :
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
 * マップ選択モーダル（マップリンク用）
 * フォルダ階層を辿れる設計（Phase 4-C 対応）
 */
export function MapPickerModal({ maps, currentLink, onClose, onSelect }) {
  const [search,          setSearch]          = useState("");
  const [hoverId,         setHoverId]         = useState(null);
  const [folders,         setFolders]         = useState([]);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs,     setBreadcrumbs]     = useState([]);

  // フォルダ一覧を取得（maps[0].user_id から取得）
  const userId = maps[0]?.user_id ?? null;
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/internal/list-folders?user_id=${userId}`, { headers: authH() })
      .then(r => r.json()).then(d => setFolders(d.items ?? [])).catch(() => {});
  }, [userId]);

  // パンくず更新
  useEffect(() => {
    if (!currentFolderId) { setBreadcrumbs([]); return; }
    const folderMap = Object.fromEntries(folders.map(f => [f.id, f]));
    const crumbs = [];
    let cur = folderMap[currentFolderId];
    while (cur) { crumbs.unshift(cur); cur = cur.parent_id ? folderMap[cur.parent_id] : null; }
    setBreadcrumbs(crumbs);
  }, [currentFolderId, folders]);

  // 現在のフォルダ内のマップ
  const currentMaps = maps.filter(m =>
    (currentFolderId === null ? !m.folder_id : m.folder_id === currentFolderId) &&
    (!search.trim() || (m.title || "").toLowerCase().includes(search.toLowerCase()))
  );

  // 現在のフォルダ直下のサブフォルダ
  const subFolders = buildTree(folders).filter(f =>
    currentFolderId === null ? !f.parent_id : f.parent_id === currentFolderId
  );

  const s = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
    modal: { background: "#fff", borderRadius: 14, padding: "20px 24px", width: 500, maxWidth: "92vw", maxHeight: "78vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    title: { fontSize: 16, fontWeight: 700, color: "#374151", marginBottom: 10 },
    breadcrumb: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#94a3b8", marginBottom: 10, flexWrap: "wrap" },
    bcLink: { cursor: "pointer", color: "#3b82f6" },
    search: { border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px", fontSize: 14, color: "#374151", fontFamily: "inherit", outline: "none", marginBottom: 10, width: "100%", boxSizing: "border-box" },
    list: { flex: 1, overflowY: "auto" },
    folderRow: (h) => ({ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, marginBottom: 6, cursor: "pointer", background: h ? "#fef3c7" : "#f9fafb", border: `1px solid ${h ? FOLDER_COLOR : BORDER}`, fontSize: 13, fontWeight: 600 }),
    mapRow: (h, active) => ({ padding: "10px 14px", borderRadius: 9, marginBottom: 6, cursor: "pointer", background: active ? "#f0fdf4" : (h ? "#f5f3ff" : "#f9fafb"), border: `1px solid ${active ? "#86efac" : (h ? PURPLE : BORDER)}` }),
    mapTitle: { fontSize: 14, fontWeight: 600, color: "#374151" },
    mapDate: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
    bottomRow: { display: "flex", gap: 8, marginTop: 14, justifyContent: "space-between", alignItems: "center" },
    unlinkBtn: { background: "none", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 14px", fontSize: 13, color: "#ef4444", cursor: "pointer" },
    cancelBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px", fontSize: 13, color: "#6b7280", cursor: "pointer" },
  };

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.title}>リンク先マップを選択</div>

        {/* パンくずナビ */}
        <div style={s.breadcrumb}>
          <span style={s.bcLink} onClick={() => setCurrentFolderId(null)}>🏠 すべて</span>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id}>
              <span> / </span>
              {i < breadcrumbs.length - 1
                ? <span style={s.bcLink} onClick={() => setCurrentFolderId(crumb.id)}>📁 {crumb.name}</span>
                : <span style={{ color: "#374151", fontWeight: 600 }}>📁 {crumb.name}</span>
              }
            </span>
          ))}
        </div>

        <input style={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="マップ名で検索..." autoFocus={!search} />

        <div style={s.list}>
          {/* サブフォルダ */}
          {!search && subFolders.map(f => (
            <div key={f.id} style={s.folderRow(hoverId === `f-${f.id}`)}
              onMouseEnter={() => setHoverId(`f-${f.id}`)} onMouseLeave={() => setHoverId(null)}
              onClick={() => setCurrentFolderId(f.id)}>
              <span>📁</span>
              <span style={{ flex: 1 }}>{f.name}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>▶</span>
            </div>
          ))}

          {/* マップ */}
          {currentMaps.length === 0 && subFolders.length === 0 && (
            <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 24 }}>
              {search ? "検索結果がありません。" : "このフォルダにマップがありません。"}
            </div>
          )}
          {currentMaps.map(m => (
            <div key={m.id} style={s.mapRow(hoverId === m.id, m.id === currentLink)}
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
