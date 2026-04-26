import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthUid, T } from "shia2n-core";
import { createMap, deleteMap } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";

const ACCENT  = "#3b82f6";
const PURPLE  = "#a855f7";
const BORDER  = "#e2e8f0";
const DANGER  = "#ef4444";
const FOLDER_COLOR = "#f59e0b";

function authH() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` };
}

// フラット配列からフォルダツリーを組み立てる
function buildTree(folders) {
  const byParent = {};
  for (const f of folders) {
    const key = f.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(f);
  }
  function build(parentId) {
    return (byParent[parentId] ?? []).map(f => ({ ...f, children: build(f.id) }));
  }
  return build("__root__");
}

export default function Home() {
  const uid = useAuthUid();
  const [tree,       setTree]       = useState({ root_maps: [], folders: [] });
  const [loading,    setLoading]    = useState(true);
  const [creating,   setCreating]   = useState(false);
  const [search,     setSearch]     = useState("");
  const [sort,       setSort]       = useState("updated");
  const [collapsed,  setCollapsed]  = useState({});   // フォルダの折りたたみ状態
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = ルート
  const [breadcrumbs, setBreadcrumbs] = useState([]);  // パンくずリスト
  const [editingFolderId, setEditingFolderId] = useState(null); // インライン編集中フォルダID
  const [editingName, setEditingName] = useState("");
  const [actionMenuMapId, setActionMenuMapId] = useState(null); // マップのアクションメニュー
  const [dragOver, setDragOver]     = useState(null);   // D&D ハイライト中フォルダID

  const isMobile = window.innerWidth < 640;

  const loadTree = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/internal/get-folder-tree?user_id=${uid}`, { headers: authH() });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setTree(data);
    } catch { }
    setLoading(false);
  }, [uid]);

  useEffect(() => { loadTree(); }, [loadTree]);

  // パンくずリストを計算
  useEffect(() => {
    if (!selectedFolderId) { setBreadcrumbs([]); return; }
    const folderMap = Object.fromEntries(tree.folders.map(f => [f.id, f]));
    const crumbs = [];
    let cur = folderMap[selectedFolderId];
    while (cur) { crumbs.unshift(cur); cur = cur.parent_id ? folderMap[cur.parent_id] : null; }
    setBreadcrumbs(crumbs);
  }, [selectedFolderId, tree.folders]);

  // 現在のフォルダのマップ・サブフォルダを取得
  const currentMaps = (selectedFolderId === null
    ? tree.root_maps
    : (tree.folders.find(f => f.id === selectedFolderId)?.maps ?? [])
  ).filter(m => !search.trim() || (m.title || "").toLowerCase().includes(search.toLowerCase()))
   .sort((a, b) => sort === "title"
     ? (a.title || "").localeCompare(b.title || "", "ja")
     : new Date(b.updated_at) - new Date(a.updated_at)
   );

  const currentSubFolders = buildTree(tree.folders).filter(f =>
    selectedFolderId === null ? f.parent_id === null || f.parent_id === undefined
    : f.parent_id === selectedFolderId
  );

  async function handleCreateMap() {
    if (creating) return;
    setCreating(true);
    const { data: map } = await window.__supaCreate?.(uid, selectedFolderId) ?? {};
    // supabase.js の createMap を直接呼ぶ
    const { createMap: cm } = await import("../lib/supabase.js");
    const newMap = await cm(uid);
    if (newMap) {
      // フォルダに紐付け
      if (selectedFolderId) {
        await fetch("/api/internal/move-map-to-folder", {
          method: "POST", headers: authH(),
          body: JSON.stringify({ map_id: newMap.id, user_id: uid, folder_id: selectedFolderId }),
        });
      }
      navigate(`/m/${newMap.id}`);
    }
    setCreating(false);
  }

  async function handleDeleteMap(e, mapId) {
    e.stopPropagation();
    if (!window.confirm("このマップを削除しますか？\n（ノードも全て削除されます）")) return;
    await deleteMap(mapId);
    await loadTree();
  }

  async function handleCreateFolder() {
    const name = window.prompt("フォルダ名を入力してください：");
    if (!name?.trim()) return;
    await fetch("/api/internal/create-folder", {
      method: "POST", headers: authH(),
      body: JSON.stringify({ user_id: uid, name: name.trim(), parent_id: selectedFolderId }),
    });
    await loadTree();
  }

  async function handleDeleteFolder(folderId, folderName) {
    const choice = window.confirm(
      `「${folderName}」を削除しますか？\n\n中のマップ・サブフォルダは「${breadcrumbs.length > 1 ? "親フォルダ" : "ルート"}」に移動します。`
    );
    if (!choice) return;
    const mode = breadcrumbs.length > 1 ? "move_to_parent" : "move_to_root";
    await fetch("/api/internal/delete-folder", {
      method: "POST", headers: authH(),
      body: JSON.stringify({ folder_id: folderId, user_id: uid, mode }),
    });
    if (selectedFolderId === folderId) setSelectedFolderId(null);
    await loadTree();
  }

  async function handleRenameFolder(folderId) {
    const folder = tree.folders.find(f => f.id === folderId);
    if (!folder) return;
    setEditingFolderId(folderId);
    setEditingName(folder.name);
  }

  async function commitRenameFolder(folderId) {
    if (!editingName.trim()) { setEditingFolderId(null); return; }
    await fetch("/api/internal/update-folder", {
      method: "POST", headers: authH(),
      body: JSON.stringify({ folder_id: folderId, user_id: uid, name: editingName.trim() }),
    });
    setEditingFolderId(null);
    await loadTree();
  }

  async function handleMoveMapToFolder(mapId, targetFolderId) {
    await fetch("/api/internal/move-map-to-folder", {
      method: "POST", headers: authH(),
      body: JSON.stringify({ map_id: mapId, user_id: uid, folder_id: targetFolderId }),
    });
    setActionMenuMapId(null);
    await loadTree();
  }

  // D&D ハンドラ
  function handleDragStart(e, mapId) { e.dataTransfer.setData("mapId", mapId); }
  function handleDragOver(e, folderId) { e.preventDefault(); setDragOver(folderId); }
  function handleDragLeave() { setDragOver(null); }
  async function handleDrop(e, folderId) {
    e.preventDefault(); setDragOver(null);
    const mapId = e.dataTransfer.getData("mapId");
    if (mapId) await handleMoveMapToFolder(mapId, folderId);
  }

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header: { padding: "14px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 },
    appTitle: { fontSize: 17, fontWeight: 700, flex: 1 },
    importBtn: { background: "none", border: `1px solid ${PURPLE}`, borderRadius: 7, padding: "7px 12px", fontSize: 12, fontWeight: 600, color: PURPLE, cursor: "pointer", whiteSpace: "nowrap" },
    createBtn: { background: ACCENT, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1 },
    layout: isMobile
      ? { display: "flex", flexDirection: "column" }
      : { display: "flex", minHeight: "calc(100vh - 57px)" },
    sidebar: {
      width: isMobile ? "100%" : 220, flexShrink: 0,
      borderRight: isMobile ? "none" : `1px solid ${BORDER}`,
      borderBottom: isMobile ? `1px solid ${BORDER}` : "none",
      padding: "12px 0", overflowY: "auto",
    },
    sidebarTitle: { fontSize: 11, fontWeight: 700, color: T.muted, padding: "4px 16px 8px", letterSpacing: 1, textTransform: "uppercase" },
    folderBtn: (selected, isDragOver) => ({
      display: "flex", alignItems: "center", gap: 6,
      padding: "7px 16px", cursor: "pointer", fontSize: 13,
      background: isDragOver ? "#fef3c7" : (selected ? "#f5f3ff" : "none"),
      border: isDragOver ? `1px dashed ${FOLDER_COLOR}` : "1px solid transparent",
      borderLeft: selected ? `3px solid ${PURPLE}` : "3px solid transparent",
      color: selected ? PURPLE : T.fg,
      fontWeight: selected ? 700 : 400, width: "100%", textAlign: "left",
    }),
    addFolderBtn: { display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, color: T.muted, background: "none", border: "none", width: "100%", textAlign: "left" },
    main: { flex: 1, padding: "16px 20px", overflow: "auto" },
    breadcrumb: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: T.muted, marginBottom: 12, flexWrap: "wrap" },
    breadcrumbLink: { cursor: "pointer", color: ACCENT, fontWeight: 500 },
    toolbar: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
    searchInput: { flex: 1, background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 7, padding: "7px 11px", fontSize: 13, color: T.fg, fontFamily: "inherit", outline: "none" },
    sortBtn: (active) => ({ background: active ? "#f1f5f9" : "none", border: `1px solid ${active ? "#94a3b8" : BORDER}`, borderRadius: 6, padding: "6px 11px", fontSize: 11, color: active ? "#374151" : T.muted, cursor: "pointer" }),
    newFolderBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 11px", fontSize: 11, color: FOLDER_COLOR, cursor: "pointer", whiteSpace: "nowrap" },
    count: { fontSize: 12, color: T.muted, marginBottom: 10 },
    subfolderGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    subfolderCard: (isDragOver) => ({
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px", borderRadius: 8, cursor: "pointer",
      background: isDragOver ? "#fef3c7" : T.surface,
      border: `1px dashed ${isDragOver ? FOLDER_COLOR : BORDER}`,
      fontSize: 13, fontWeight: 600, minWidth: 120,
    }),
    mapCard: (hovered) => ({ background: hovered ? "#f8fafc" : T.surface, border: `1px solid ${hovered ? "#94a3b8" : BORDER}`, borderRadius: 9, padding: "12px 16px", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "background 0.1s" }),
    mapTitle: { fontSize: 14, fontWeight: 600 },
    mapDate:  { fontSize: 11, color: T.muted, marginTop: 3 },
    actionMenu: { position: "absolute", right: 0, top: "100%", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 100, minWidth: 160, overflow: "hidden" },
    actionMenuItem: (danger) => ({ padding: "9px 16px", cursor: "pointer", fontSize: 13, color: danger ? DANGER : T.fg, borderBottom: `1px solid ${BORDER}`, display: "block", width: "100%", textAlign: "left", background: "none", border: "none" }),
    empty: { textAlign: "center", color: T.muted, fontSize: 14, padding: "40px 20px", lineHeight: 1.9 },
  };

  // フォルダツリーノードの再帰レンダリング
  function FolderNode({ folder, depth = 0 }) {
    const isSelected  = selectedFolderId === folder.id;
    const isCollapsed = collapsed[folder.id];
    const isDragOver  = dragOver === folder.id;
    const hasChildren = folder.children?.length > 0;

    return (
      <div>
        <div style={{ paddingLeft: depth * 12 }}>
          {editingFolderId === folder.id ? (
            <div style={{ display: "flex", alignItems: "center", padding: "4px 16px", gap: 6 }}>
              <input
                autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                onBlur={() => commitRenameFolder(folder.id)}
                onKeyDown={e => { if (e.key === "Enter") commitRenameFolder(folder.id); if (e.key === "Escape") setEditingFolderId(null); }}
                style={{ flex: 1, fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "4px 8px", outline: "none" }}
              />
            </div>
          ) : (
            <button
              style={s.folderBtn(isSelected, isDragOver)}
              onClick={() => setSelectedFolderId(folder.id)}
              onDoubleClick={() => handleRenameFolder(folder.id)}
              onDragOver={e => handleDragOver(e, folder.id)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, folder.id)}
            >
              {hasChildren && (
                <span
                  onClick={e => { e.stopPropagation(); setCollapsed(prev => ({ ...prev, [folder.id]: !prev[folder.id] })); }}
                  style={{ fontSize: 9, color: T.muted, width: 12, flexShrink: 0 }}
                >{isCollapsed ? "▶" : "▼"}</span>
              )}
              {!hasChildren && <span style={{ width: 12, flexShrink: 0 }} />}
              <span style={{ fontSize: 14 }}>📁</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
              <span style={{ fontSize: 11, color: T.muted, flexShrink: 0 }}>{(folder.maps?.length ?? 0) > 0 ? folder.maps.length : ""}</span>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }}
                style={{ background: "none", border: "none", color: T.muted, fontSize: 12, cursor: "pointer", padding: "0 2px", flexShrink: 0, opacity: 0.5 }}
                title="フォルダを削除"
              >✕</button>
            </button>
          )}
        </div>
        {hasChildren && !isCollapsed && folder.children.map(child => (
          <FolderNode key={child.id} folder={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const folderTree = buildTree(tree.folders);
  const [hoveredMapId, setHoveredMapId] = useState(null);

  return (
    <div style={s.wrap} onClick={() => setActionMenuMapId(null)}>
      {/* ヘッダー */}
      <div style={s.header}>
        <div style={s.appTitle}>Mind-Modeling</div>
        <button style={s.importBtn} onClick={() => navigate("/import")}>Whimsical から移行</button>
        <button style={s.importBtn} onClick={() => navigate("/templates")} title="テンプレート一覧">テンプレート</button>
        <button style={s.createBtn} onClick={handleCreateMap} disabled={creating}>
          {creating ? "作成中..." : "+ 新規マップ"}
        </button>
      </div>

      <div style={s.layout}>
        {/* サイドバー（フォルダツリー） */}
        <div style={s.sidebar}>
          <div style={s.sidebarTitle}>フォルダ</div>

          {/* ルート */}
          <button
            style={s.folderBtn(selectedFolderId === null, dragOver === "__root__")}
            onClick={() => setSelectedFolderId(null)}
            onDragOver={e => handleDragOver(e, "__root__")}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, null)}
          >
            <span style={{ width: 12, flexShrink: 0 }} />
            <span style={{ fontSize: 14 }}>🏠</span>
            <span style={{ flex: 1 }}>すべてのマップ</span>
            <span style={{ fontSize: 11, color: T.muted }}>{tree.root_maps.length > 0 ? tree.root_maps.length : ""}</span>
          </button>

          {/* フォルダツリー */}
          {loading ? null : folderTree.map(folder => <FolderNode key={folder.id} folder={folder} />)}

          {/* フォルダ追加 */}
          <button style={s.addFolderBtn} onClick={handleCreateFolder}>
            + フォルダを追加
          </button>
        </div>

        {/* メインエリア */}
        <div style={s.main}>
          {/* パンくずナビ（スマホ時・フォルダ選択時に表示） */}
          {breadcrumbs.length > 0 && (
            <div style={s.breadcrumb}>
              <span style={s.breadcrumbLink} onClick={() => setSelectedFolderId(null)}>ホーム</span>
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.id}>
                  <span style={{ color: T.muted }}> / </span>
                  {i < breadcrumbs.length - 1
                    ? <span style={s.breadcrumbLink} onClick={() => setSelectedFolderId(crumb.id)}>{crumb.name}</span>
                    : <span style={{ color: T.fg, fontWeight: 600 }}>{crumb.name}</span>
                  }
                </span>
              ))}
            </div>
          )}

          {/* ツールバー */}
          <div style={s.toolbar}>
            <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="マップ名で検索..." />
            <button style={s.sortBtn(sort === "updated")} onClick={() => setSort("updated")}>更新日順</button>
            <button style={s.sortBtn(sort === "title")}   onClick={() => setSort("title")}>名前順</button>
            <button style={s.newFolderBtn} onClick={handleCreateFolder}>📁 フォルダ追加</button>
          </div>

          {/* サブフォルダ（現在のフォルダ直下） */}
          {!search && currentSubFolders.length > 0 && (
            <div style={s.subfolderGrid}>
              {currentSubFolders.map(f => (
                <div key={f.id}
                  style={s.subfolderCard(dragOver === f.id)}
                  onClick={() => setSelectedFolderId(f.id)}
                  onDragOver={e => handleDragOver(e, f.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, f.id)}
                >
                  <span>📁</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: T.muted }}>{f.maps?.length ?? 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* マップ一覧 */}
          {loading ? (
            <div style={s.empty}>読み込み中...</div>
          ) : currentMaps.length === 0 ? (
            <div style={s.empty}>
              {search
                ? `「${search}」に一致するマップがありません。`
                : selectedFolderId
                  ? "このフォルダにマップがありません。\n「+ 新規マップ」で作成してください。"
                  : "マップがありません。\n「+ 新規マップ」で作成するか、「Whimsical から移行」で取り込んでください。"}
            </div>
          ) : (
            <>
              <div style={s.count}>{currentMaps.length}件</div>
              {currentMaps.map(map => (
                <div key={map.id}
                  style={{ ...s.mapCard(hoveredMapId === map.id), position: "relative" }}
                  onClick={() => navigate(`/m/${map.id}`)}
                  onMouseEnter={() => setHoveredMapId(map.id)}
                  onMouseLeave={() => setHoveredMapId(null)}
                  draggable
                  onDragStart={e => handleDragStart(e, map.id)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={s.mapTitle}>{map.title || "Untitled"}</div>
                    <div style={s.mapDate}>{new Date(map.updated_at).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {/* アクションメニュー */}
                    <div style={{ position: "relative" }}>
                      <button
                        onClick={e => { e.stopPropagation(); setActionMenuMapId(actionMenuMapId === map.id ? null : map.id); }}
                        style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "3px 8px", fontSize: 12, color: T.muted, cursor: "pointer" }}
                      >•••</button>
                      {actionMenuMapId === map.id && (
                        <div style={s.actionMenu} onClick={e => e.stopPropagation()}>
                          <FolderMoveMenu mapId={map.id} folders={tree.folders} currentFolderId={map.folder_id} onMove={handleMoveMapToFolder} />
                          <button style={s.actionMenuItem(true)} onClick={e => handleDeleteMap(e, map.id)}>削除</button>
                        </div>
                      )}
                    </div>
                    <button style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: "4px 6px", opacity: 0.6 }} onClick={e => handleDeleteMap(e, map.id)} title="削除">✕</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// フォルダ移動メニュー
function FolderMoveMenu({ mapId, folders, currentFolderId, onMove }) {
  const BORDER = "#e2e8f0";
  const PURPLE = "#a855f7";
  return (
    <>
      <div style={{ padding: "6px 16px 4px", fontSize: 11, color: "#94a3b8", fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>フォルダへ移動</div>
      <button
        style={{ padding: "8px 16px", cursor: "pointer", fontSize: 12, color: !currentFolderId ? PURPLE : "#374151", borderBottom: `1px solid ${BORDER}`, display: "block", width: "100%", textAlign: "left", background: !currentFolderId ? "#f5f3ff" : "none", border: "none" }}
        onClick={() => onMove(mapId, null)}
      >🏠 ルート{!currentFolderId ? " ✓" : ""}</button>
      {folders.map(f => (
        <button key={f.id}
          style={{ padding: "8px 16px", cursor: "pointer", fontSize: 12, color: currentFolderId === f.id ? PURPLE : "#374151", borderBottom: `1px solid ${BORDER}`, display: "block", width: "100%", textAlign: "left", background: currentFolderId === f.id ? "#f5f3ff" : "none", border: "none" }}
          onClick={() => onMove(mapId, f.id)}
        >📁 {f.name}{currentFolderId === f.id ? " ✓" : ""}</button>
      ))}
    </>
  );
}
