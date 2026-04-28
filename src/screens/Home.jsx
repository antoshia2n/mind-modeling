import { useState, useEffect, useCallback } from "react";
import { useAuthUid, T } from "shia2n-core";
import { deleteMap } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";

const ACCENT  = "#3b82f6";
const PURPLE  = "#a855f7";
const BORDER  = "#e2e8f0";
const DANGER  = "#ef4444";
const MUTED   = "#94a3b8";

const LAST_FOLDER_KEY    = "mm_home_last_folder_id";
const FOLDER_COLLAPSE_KEY = "mm_home_folder_collapse";

function authH() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` };
}
function buildTree(folders) {
  const byParent = {};
  for (const f of folders) { const k = f.parent_id ?? "__root__"; if (!byParent[k]) byParent[k] = []; byParent[k].push(f); }
  function build(pid) { return (byParent[pid] ?? []).map(f => ({ ...f, children: build(f.id) })); }
  return build("__root__");
}
function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "たった今";
  if (m < 60)  return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}日前`;
  return new Date(iso).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

// ─── FolderNode（親コンポーネントの外側で定義）────────────

function FolderNode({ folder, depth, selectedFolderId, collapsed, setCollapsed, editingFolderId, editingName, setEditingName, dragOver, onSelect, onDragOver, onDragLeave, onDrop, onRename, onCommitRename, onDelete }) {
  const isSelected  = selectedFolderId === folder.id;
  const isCollapsed = collapsed[folder.id];
  const isDragOver  = dragOver === folder.id;
  const hasChildren = folder.children?.length > 0;

  function toggleCollapse(e) {
    e.stopPropagation();
    setCollapsed(prev => {
      const next = { ...prev, [folder.id]: !prev[folder.id] };
      try { localStorage.setItem(FOLDER_COLLAPSE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const indent = depth * 14;
  const rowStyle = {
    display: "flex", alignItems: "center", gap: 5,
    paddingLeft: 16 + indent, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
    cursor: "pointer", fontSize: 13,
    background: isDragOver ? "#f0f9ff" : (isSelected ? "#f5f3ff" : "transparent"),
    borderLeft: isSelected ? `3px solid ${PURPLE}` : "3px solid transparent",
    color: isSelected ? PURPLE : T.fg,
    fontWeight: isSelected ? 600 : 400,
    borderBottom: isDragOver ? `1px dashed ${ACCENT}` : "1px solid transparent",
  };

  return (
    <div>
      {editingFolderId === folder.id ? (
        <div style={{ paddingLeft: 16 + indent, paddingRight: 12, paddingTop: 4, paddingBottom: 4 }}>
          <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
            onBlur={() => onCommitRename(folder.id)}
            onKeyDown={e => { if (e.key === "Enter") onCommitRename(folder.id); if (e.key === "Escape") onCommitRename(null); }}
            style={{ width: "100%", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "3px 8px", outline: "none", fontFamily: "inherit" }} />
        </div>
      ) : (
        <div style={rowStyle} onClick={() => onSelect(folder.id)} onDoubleClick={() => onRename(folder.id)}
          onDragOver={e => onDragOver(e, folder.id)} onDragLeave={onDragLeave} onDrop={e => onDrop(e, folder.id)}>
          {/* 折りたたみトグル */}
          <span onClick={toggleCollapse} style={{ width: 14, fontSize: 9, color: MUTED, userSelect: "none", flexShrink: 0, textAlign: "center" }}>
            {hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
          </span>
          {/* フォルダ名 */}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
          {/* マップ数 */}
          {folder.maps?.length > 0 && (
            <span style={{ fontSize: 11, color: MUTED, flexShrink: 0, background: "#f1f5f9", borderRadius: 10, padding: "0 6px", minWidth: 18, textAlign: "center" }}>{folder.maps.length}</span>
          )}
          {/* 削除 */}
          <span onClick={e => { e.stopPropagation(); onDelete(folder.id, folder.name); }}
            style={{ fontSize: 11, color: MUTED, cursor: "pointer", opacity: 0.5, flexShrink: 0, paddingLeft: 4 }}>×</span>
        </div>
      )}
      {hasChildren && !isCollapsed && folder.children.map(child => (
        <FolderNode key={child.id} folder={child} depth={depth + 1}
          selectedFolderId={selectedFolderId} collapsed={collapsed} setCollapsed={setCollapsed}
          editingFolderId={editingFolderId} editingName={editingName} setEditingName={setEditingName}
          dragOver={dragOver} onSelect={onSelect} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onRename={onRename} onCommitRename={onCommitRename} onDelete={onDelete} />
      ))}
    </div>
  );
}

// ─── Home ────────────────────────────────────────────────────

export default function Home() {
  const uid = useAuthUid();

  const [tree, setTree] = useState({ root_maps: [], folders: [] });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort]     = useState("updated");
  const [dragOver, setDragOver] = useState(null);
  const [toast, setToast]   = useState(null);
  const [editingFolderId, setEditingFolderId] = useState(null);
  const [editingName, setEditingName]         = useState("");
  const [actionMenuMapId, setActionMenuMapId] = useState(null);

  const [selectedFolderId, setSelectedFolderId] = useState(() => {
    try { return localStorage.getItem(LAST_FOLDER_KEY) ?? null; } catch { return null; }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FOLDER_COLLAPSE_KEY) ?? "{}"); } catch { return {}; }
  });

  function selectFolder(id) {
    setSelectedFolderId(id);
    try { if (id) localStorage.setItem(LAST_FOLDER_KEY, id); else localStorage.removeItem(LAST_FOLDER_KEY); } catch {}
  }
  function showToast(msg, type = "success") { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); }

  const loadTree = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/internal/get-folder-tree?user_id=${uid}`, { headers: authH() });
      if (!res.ok) { showToast("フォルダ取得に失敗しました", "error"); setLoading(false); return; }
      setTree(await res.json());
    } catch { showToast("ネットワークエラー", "error"); }
    setLoading(false);
  }, [uid]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    if (selectedFolderId && tree.folders.length > 0) {
      if (!tree.folders.find(f => f.id === selectedFolderId)) selectFolder(null);
    }
  }, [tree.folders, selectedFolderId]);

  const currentMaps = (selectedFolderId === null
    ? tree.root_maps
    : (tree.folders.find(f => f.id === selectedFolderId)?.maps ?? [])
  ).filter(m => !search.trim() || (m.title || "").toLowerCase().includes(search.toLowerCase()))
   .sort((a, b) => sort === "title" ? (a.title || "").localeCompare(b.title || "", "ja") : new Date(b.updated_at) - new Date(a.updated_at));

  const folderTree = buildTree(tree.folders);

  // パンくず
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  useEffect(() => {
    if (!selectedFolderId) { setBreadcrumbs([]); return; }
    const fm = Object.fromEntries(tree.folders.map(f => [f.id, f]));
    const crumbs = [];
    let cur = fm[selectedFolderId];
    while (cur) { crumbs.unshift(cur); cur = cur.parent_id ? fm[cur.parent_id] : null; }
    setBreadcrumbs(crumbs);
  }, [selectedFolderId, tree.folders]);

  async function handleCreateMap() {
    if (creating) return;
    setCreating(true);
    try {
      const { createMap } = await import("../lib/supabase.js");
      const nm = await createMap(uid);
      if (nm) {
        if (selectedFolderId) await fetch("/api/internal/move-map-to-folder", { method: "POST", headers: authH(), body: JSON.stringify({ map_id: nm.id, user_id: uid, folder_id: selectedFolderId }) });
        navigate(`/m/${nm.id}`);
      }
    } catch { showToast("マップ作成に失敗しました", "error"); }
    setCreating(false);
  }

  async function handleDeleteMap(e, mapId) {
    e.stopPropagation();
    if (!window.confirm("このマップを削除しますか？")) return;
    await deleteMap(mapId); await loadTree();
  }

  async function handleCreateFolder() {
    const name = window.prompt("フォルダ名："); if (!name?.trim()) return;
    const res = await fetch("/api/internal/create-folder", { method: "POST", headers: authH(), body: JSON.stringify({ user_id: uid, name: name.trim(), parent_id: selectedFolderId }) });
    if (!res.ok) { showToast("フォルダ作成に失敗しました", "error"); return; }
    await loadTree(); showToast(`「${name.trim()}」を作成しました`);
  }

  async function handleDeleteFolder(folderId, folderName) {
    if (!window.confirm(`「${folderName}」を削除しますか？\n中のマップはルートに移動します。`)) return;
    await fetch("/api/internal/delete-folder", { method: "POST", headers: authH(), body: JSON.stringify({ folder_id: folderId, user_id: uid, mode: "move_to_root" }) });
    if (selectedFolderId === folderId) selectFolder(null);
    await loadTree(); showToast(`「${folderName}」を削除しました`);
  }

  function handleRenameFolder(id) {
    const f = tree.folders.find(f => f.id === id); if (!f) return;
    setEditingFolderId(id); setEditingName(f.name);
  }

  async function handleCommitRenameFolder(id) {
    if (!id || !editingName.trim()) { setEditingFolderId(null); return; }
    await fetch("/api/internal/update-folder", { method: "POST", headers: authH(), body: JSON.stringify({ folder_id: id, user_id: uid, name: editingName.trim() }) });
    setEditingFolderId(null); await loadTree();
  }

  async function handleMoveMapToFolder(mapId, targetFolderId) {
    await fetch("/api/internal/move-map-to-folder", { method: "POST", headers: authH(), body: JSON.stringify({ map_id: mapId, user_id: uid, folder_id: targetFolderId }) });
    setActionMenuMapId(null); await loadTree();
  }

  function handleDragStart(e, mapId) { e.dataTransfer.setData("mapId", mapId); }
  function handleDragOver(e, id)  { e.preventDefault(); setDragOver(id); }
  function handleDragLeave()      { setDragOver(null); }
  async function handleDrop(e, folderId) {
    e.preventDefault(); setDragOver(null);
    const mapId = e.dataTransfer.getData("mapId");
    if (mapId) await handleMoveMapToFolder(mapId, folderId);
  }

  const folderNodeProps = {
    selectedFolderId, collapsed, setCollapsed,
    editingFolderId, editingName, setEditingName, dragOver,
    onSelect: selectFolder,
    onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop,
    onRename: handleRenameFolder, onCommitRename: handleCommitRenameFolder, onDelete: handleDeleteFolder,
  };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", display: "flex", flexDirection: "column" }}
      onClick={() => setActionMenuMapId(null)}>

      {/* ヘッダー */}
      <div style={{ padding: "12px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, flex: 1, color: T.fg }}>Mind-Modeling</div>
        <button style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: PURPLE, cursor: "pointer" }} onClick={() => navigate("/minutes")}>議事録</button>
        <button style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: PURPLE, cursor: "pointer" }} onClick={() => navigate("/import")}>移行</button>
        <button style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: MUTED, cursor: "pointer" }} onClick={() => navigate("/templates")}>テンプレート</button>
        <button style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1 }} onClick={handleCreateMap} disabled={creating}>
          {creating ? "作成中..." : "+ 新規マップ"}
        </button>
      </div>

      <div style={{ display: "flex", flex: 1 }}>
        {/* サイドバー */}
        <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ padding: "10px 16px 4px", fontSize: 10, fontWeight: 700, color: MUTED, letterSpacing: 1 }}>フォルダ</div>

          {/* すべてのマップ */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px 6px 16px", cursor: "pointer", fontSize: 13, background: dragOver === "__root__" ? "#f0f9ff" : (selectedFolderId === null ? "#f5f3ff" : "transparent"), borderLeft: selectedFolderId === null ? `3px solid ${PURPLE}` : "3px solid transparent", color: selectedFolderId === null ? PURPLE : T.fg, fontWeight: selectedFolderId === null ? 600 : 400 }}
            onClick={() => selectFolder(null)} onDragOver={e => handleDragOver(e, "__root__")} onDragLeave={handleDragLeave} onDrop={e => handleDrop(e, null)}>
            <span style={{ width: 14, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>すべてのマップ</span>
            {tree.root_maps.length > 0 && <span style={{ fontSize: 11, color: MUTED, background: "#f1f5f9", borderRadius: 10, padding: "0 6px" }}>{tree.root_maps.length}</span>}
          </div>

          {/* フォルダツリー */}
          {!loading && folderTree.map(folder => <FolderNode key={folder.id} folder={folder} depth={0} {...folderNodeProps} />)}

          {/* フォルダ追加 */}
          <button style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 16px", cursor: "pointer", fontSize: 12, color: MUTED, background: "none", border: "none", width: "100%", textAlign: "left", marginTop: 4 }} onClick={handleCreateFolder}>
            <span style={{ width: 14 }} />+ フォルダを追加
          </button>
        </div>

        {/* メインエリア */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* ツールバー */}
          <div style={{ padding: "12px 20px 8px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* パンくず */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: MUTED, flex: 1, overflow: "hidden" }}>
              <span style={{ cursor: "pointer", color: selectedFolderId ? ACCENT : T.fg, fontWeight: !selectedFolderId ? 600 : 400 }} onClick={() => selectFolder(null)}>すべて</span>
              {breadcrumbs.map((c, i) => (
                <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: MUTED }}>›</span>
                  <span style={{ cursor: i < breadcrumbs.length - 1 ? "pointer" : "default", color: i < breadcrumbs.length - 1 ? ACCENT : T.fg, fontWeight: i === breadcrumbs.length - 1 ? 600 : 400, whiteSpace: "nowrap" }}
                    onClick={() => i < breadcrumbs.length - 1 && selectFolder(c.id)}>{c.name}</span>
                </span>
              ))}
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="検索..." style={{ background: "#f8fafc", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "5px 10px", fontSize: 12, color: T.fg, fontFamily: "inherit", outline: "none", width: 160 }} />
            <button style={{ background: sort === "updated" ? "#f1f5f9" : "none", border: `1px solid ${sort === "updated" ? "#94a3b8" : BORDER}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, color: sort === "updated" ? "#374151" : MUTED, cursor: "pointer" }} onClick={() => setSort("updated")}>更新順</button>
            <button style={{ background: sort === "title" ? "#f1f5f9" : "none", border: `1px solid ${sort === "title" ? "#94a3b8" : BORDER}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, color: sort === "title" ? "#374151" : MUTED, cursor: "pointer" }} onClick={() => setSort("title")}>名前順</button>
            <button style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 10px", fontSize: 11, color: PURPLE, cursor: "pointer" }} onClick={handleCreateFolder}>+ フォルダ</button>
          </div>

          {/* マップ一覧 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}>
            {loading ? (
              <div style={{ textAlign: "center", color: MUTED, padding: "40px 0", fontSize: 14 }}>読み込み中...</div>
            ) : currentMaps.length === 0 ? (
              <div style={{ textAlign: "center", color: MUTED, padding: "40px 0", fontSize: 14, lineHeight: 2 }}>
                {search ? `「${search}」に一致するマップがありません` : "マップがありません"}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, color: MUTED, fontSize: 11 }}>マップ名</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600, color: MUTED, fontSize: 11, width: 60 }}>ノード</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 600, color: MUTED, fontSize: 11, width: 80 }}>更新</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {currentMaps.map(map => (
                    <MapRow key={map.id} map={map} folders={tree.folders}
                      actionMenuMapId={actionMenuMapId} setActionMenuMapId={setActionMenuMapId}
                      onOpen={() => navigate(`/m/${map.id}`)}
                      onDelete={handleDeleteMap}
                      onMove={handleMoveMapToFolder}
                      onDragStart={handleDragStart} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "rgba(220,38,38,0.92)" : "rgba(22,163,74,0.92)", color: "#fff", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600, zIndex: 9999, pointerEvents: "none" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── MapRow（表形式の1行）────────────────────────────────────

function MapRow({ map, folders, actionMenuMapId, setActionMenuMapId, onOpen, onDelete, onMove, onDragStart }) {
  const [hovered, setHovered] = useState(false);
  const isMenuOpen = actionMenuMapId === map.id;

  return (
    <tr style={{ borderBottom: `1px solid ${BORDER}`, background: hovered ? "#fafafa" : "transparent", cursor: "pointer", transition: "background 0.1s" }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={onOpen} draggable onDragStart={e => onDragStart(e, map.id)}>
      {/* マップ名 */}
      <td style={{ padding: "9px 8px" }}>
        <div style={{ fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>
          {map.title || "Untitled"}
        </div>
      </td>
      {/* ノード数 */}
      <td style={{ padding: "9px 8px", textAlign: "right", color: MUTED, fontSize: 12 }}>
        {map.node_count != null ? map.node_count : "—"}
      </td>
      {/* 更新時刻 */}
      <td style={{ padding: "9px 8px", textAlign: "right", color: MUTED, fontSize: 12, whiteSpace: "nowrap" }}>
        {relativeTime(map.updated_at)}
      </td>
      {/* アクションメニュー */}
      <td style={{ padding: "9px 4px", position: "relative" }} onClick={e => e.stopPropagation()}>
        <button style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 14, padding: "0 6px", opacity: hovered || isMenuOpen ? 1 : 0, transition: "opacity 0.1s" }}
          onClick={e => { e.stopPropagation(); setActionMenuMapId(isMenuOpen ? null : map.id); }}>···</button>
        {isMenuOpen && (
          <div style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 100, minWidth: 160, overflow: "hidden" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "6px 14px 4px", fontSize: 10, color: MUTED, fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>フォルダへ移動</div>
            <button style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, color: !map.folder_id ? "#a855f7" : "#374151", display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${BORDER}` }} onClick={() => onMove(map.id, null)}>
              ルート{!map.folder_id ? " ✓" : ""}
            </button>
            {folders.map(f => (
              <button key={f.id} style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, color: map.folder_id === f.id ? "#a855f7" : "#374151", display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${BORDER}` }} onClick={() => onMove(map.id, f.id)}>
                {f.name}{map.folder_id === f.id ? " ✓" : ""}
              </button>
            ))}
            <button style={{ padding: "8px 14px", cursor: "pointer", fontSize: 12, color: DANGER, display: "block", width: "100%", textAlign: "left", background: "none", border: "none" }} onClick={e => onDelete(e, map.id)}>
              削除
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
