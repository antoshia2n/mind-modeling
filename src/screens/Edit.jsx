import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { getMap, getNodes, getMaps, updateMap, createNode } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";
import { ReactFlowProvider } from "@xyflow/react";
import ListMode from "./ListMode.jsx";
import MapMode  from "./MapMode.jsx";
import SaveTemplateModal    from "./SaveTemplateModal.jsx";
import { TemplatePickerModal, MapPickerModal } from "./TemplatePickerModal.jsx";

const BORDER  = "#e2e8f0";
const ACCENT  = "#3b82f6";
const PURPLE  = "#a855f7";
const ZEUS    = "#f59e0b"; // Zeus ボタンの色

/**
 * マップを階層構造のテキストに変換（Zeus push 用）
 * @param {Array} nodes
 * @returns {string}
 */
function buildHierarchicalText(nodes) {
  if (!nodes || nodes.length === 0) return "";

  const byParent = {};
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(n);
  }
  for (const key in byParent) byParent[key].sort((a, b) => a.order_index - b.order_index);

  const lines = [];
  function dfs(parentId, depth) {
    for (const n of byParent[parentId] ?? []) {
      const indent = "  ".repeat(depth);
      const prefix = depth === 0 ? "" : "- ";
      lines.push(`${indent}${prefix}${n.content || "(空)"}`.trimEnd());
      dfs(n.id, depth + 1);
    }
  }
  dfs("__root__", 0);
  return lines.join("\n");
}

export default function Edit({ mapId }) {
  const uid = useAuthUid();
  const [map,        setMap]        = useState(null);
  const [nodes,      setNodes]      = useState([]);
  const [allMaps,    setAllMaps]    = useState([]);
  const [saveState,  setSaveState]  = useState("saved");
  const [loading,    setLoading]    = useState(true);
  const [mode,       setMode]       = useState("map");
  const [layoutMode, setLayoutMode] = useState(() => localStorage.getItem(`mm_layout_${mapId}`) ?? "bi");

  // Zeus 連携状態
  const [zeusState, setZeusState] = useState("idle"); // "idle" | "pushing" | "done" | "error"
  const [zeusLastSync, setZeusLastSync] = useState(null); // ISO文字列

  // モーダル管理
  const [showSaveTemplate,   setShowSaveTemplate]   = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showMapPicker,      setShowMapPicker]      = useState(false);
  const [templatePickerMode, setTemplatePickerMode] = useState("insert");
  const [selectedNodeForLink, setSelectedNodeForLink] = useState(null);
  const [insertParentNodeId,  setInsertParentNodeId]  = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!uid || !mapId) return;
    Promise.all([getMap(mapId), getNodes(mapId), getMaps(uid)]).then(async ([m, ns, ms]) => {
      setMap(m);
      setAllMaps(ms.filter(x => x.id !== mapId));
      setZeusLastSync(m?.last_synced_at ?? null);
      if (ns.length === 0) {
        const firstNode = await createNode(uid, mapId, null, 1024, "");
        setNodes(firstNode ? [firstNode] : []);
      } else {
        setNodes(ns);
      }
      setLoading(false);
    });
  }, [uid, mapId]);

  function showToast(msg, type = "success") { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); }
  function handleTitleChange(e) { setMap(prev => ({ ...prev, title: e.target.value })); }
  async function handleTitleBlur(e) {
    setSaveState("saving");
    await updateMap(mapId, { title: e.target.value });
    setSaveState("saved");
  }
  function handleNodesChange(newNodes) { setNodes(newNodes); setSaveState("saving"); }
  function handleSaved() { setSaveState("saved"); }

  function toggleLayoutMode() {
    const next = layoutMode === "bi" ? "lr" : "bi";
    setLayoutMode(next);
    localStorage.setItem(`mm_layout_${mapId}`, next);
  }

  // ─── テンプレート挿入 ───────────────────────────────────
  function handleRequestTemplateInsert(parentNodeId) {
    setInsertParentNodeId(parentNodeId);
    setTemplatePickerMode("insert");
    setShowTemplatePicker(true);
  }

  // ─── マップリンク ────────────────────────────────────────
  function handleRequestMapLink(nodeId, currentLinkedMapId) {
    setSelectedNodeForLink({ nodeId, currentLinkedMapId });
    setShowMapPicker(true);
  }

  async function handleTemplateSelect(templateId) {
    setShowTemplatePicker(false);
    const res = await fetch("/api/internal/insert-template-as-subtree", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
      body: JSON.stringify({ template_id: templateId, target_map_id: mapId, parent_node_id: insertParentNodeId ?? null, user_id: uid }),
    });
    if (!res.ok) { showToast("テンプレート挿入に失敗しました。", "error"); return; }
    const data = await res.json();
    const newNodes = await getNodes(mapId);
    setNodes(newNodes); setSaveState("saved");
    showToast(`${data.inserted_count}ノードを挿入しました`);
  }

  async function handleMapLinkSelect(linkedMapId) {
    setShowMapPicker(false);
    if (!selectedNodeForLink) return;
    const res = await fetch("/api/internal/update-node-link", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
      body: JSON.stringify({ node_id: selectedNodeForLink.nodeId, linked_map_id: linkedMapId, user_id: uid }),
    });
    if (!res.ok) { showToast("マップリンクの更新に失敗しました。", "error"); return; }
    setNodes(nodes.map(n => n.id === selectedNodeForLink.nodeId ? { ...n, linked_map_id: linkedMapId } : n));
    setSelectedNodeForLink(null);
    showToast(linkedMapId ? "マップリンクを設定しました" : "マップリンクを解除しました");
  }

  // ─── Zeus に保存 ─────────────────────────────────────────
  async function handleZeusPush() {
    const isChanged = !zeusLastSync || new Date(map?.updated_at) > new Date(zeusLastSync);
    if (!isChanged && zeusLastSync) {
      if (!window.confirm("マップは変更されていません。それでも Zeus に再保存しますか？")) return;
    } else {
      if (!window.confirm(`このマップを Zeus に保存しますか？`)) return;
    }

    setZeusState("pushing");
    try {
      const content    = buildHierarchicalText(nodes);
      const source_url = `https://mm.shia2n.jp/m/${mapId}`;

      // サーバー側プロキシ経由（CORS回避・シークレット隠蔽）
      const res = await fetch("/api/internal/push-to-zeus-proxy", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}`,
        },
        body: JSON.stringify({
          title:        map?.title || "Untitled",
          content,
          source_url,
          map_id:       mapId,
          node_count:   nodes.length,
          zeus_item_id: map?.zeus_item_id ?? null,
        }),
      });

      if (!res.ok) {
        let errDetail = "";
        try {
          const errData = await res.json();
          errDetail = errData.detail || errData.error || JSON.stringify(errData);
        } catch { errDetail = await res.text().catch(() => ""); }
        // Zeus が何を返したか確認できるようにアラートで表示
        window.alert(`Zeus 保存エラー（HTTP ${res.status}）\n\n${errDetail}`);
        showToast(`Zeus への保存に失敗しました（HTTP ${res.status}）`, "error");
        setZeusState("error"); return;
      }

      const data = await res.json();
      const zeusItemId     = data.item_id ?? map?.zeus_item_id;
      const lastSyncedAt   = new Date().toISOString();

      // mm_maps に zeus_item_id と last_synced_at を保存
      await updateMap(mapId, { zeus_item_id: zeusItemId, last_synced_at: lastSyncedAt });
      setMap(prev => ({ ...prev, zeus_item_id: zeusItemId, last_synced_at: lastSyncedAt }));
      setZeusLastSync(lastSyncedAt);
      setZeusState("done");
      showToast("Zeus に保存しました");

      // 3秒後に状態をリセット
      setTimeout(() => setZeusState("idle"), 3000);
    } catch (e) {
      showToast("ネットワークエラーが発生しました。", "error");
      setZeusState("error");
      setTimeout(() => setZeusState("idle"), 3000);
    }
  }

  // Zeus ボタンのラベルと色
  const isZeusChanged = !zeusLastSync || (map?.updated_at && new Date(map.updated_at) > new Date(zeusLastSync));
  const zeusLabel = (() => {
    if (zeusState === "pushing") return "保存中...";
    if (zeusState === "done")    return "✓ 保存済み";
    if (zeusState === "error")   return "⚠ エラー";
    if (!zeusLastSync)           return "Zeus に保存";
    if (isZeusChanged)           return "Zeus に再保存";
    return "Zeus に保存済み";
  })();
  const zeusDisabled = zeusState === "pushing";
  const zeusBtnStyle = {
    background: zeusState === "done" ? "#dcfce7" : (isZeusChanged || !zeusLastSync ? ZEUS : "none"),
    color: zeusState === "done" ? "#16a34a" : (isZeusChanged || !zeusLastSync ? "#fff" : T.muted),
    border: `1px solid ${zeusState === "done" ? "#86efac" : (isZeusChanged || !zeusLastSync ? ZEUS : BORDER)}`,
    borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600,
    cursor: zeusDisabled ? "default" : "pointer", flexShrink: 0, whiteSpace: "nowrap",
    opacity: zeusDisabled ? 0.7 : 1,
  };

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", display: "flex", flexDirection: "column" },
    header: { padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, height: 53, boxSizing: "border-box" },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: "0 4px", whiteSpace: "nowrap" },
    titleInput: { flex: 1, background: "none", border: "none", fontSize: 16, fontWeight: 700, color: T.fg, outline: "none", fontFamily: "inherit", minWidth: 0 },
    modeToggle: { display: "flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
    modeBtn: (active) => ({ background: active ? ACCENT : "none", color: active ? "#fff" : T.muted, border: "none", padding: "6px 10px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }),
    iconBtn: (color) => ({ background: "none", border: `1px solid ${color ?? BORDER}`, borderRadius: 7, padding: "6px 10px", fontSize: 12, fontWeight: 600, color: color ?? T.muted, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }),
    saveLabel: { fontSize: 11, color: T.muted, flexShrink: 0, whiteSpace: "nowrap" },
    body: { flex: 1, overflow: mode === "map" ? "hidden" : "auto" },
    center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: T.bg },
  };

  if (loading) return <div style={s.center}><span style={{ color: T.muted }}>読み込み中...</span></div>;
  if (!map)    return <div style={s.center}><span style={{ color: T.muted }}>マップが見つかりません。</span></div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate("/")}>←</button>
        <input style={s.titleInput} value={map.title ?? ""} onChange={handleTitleChange} onBlur={handleTitleBlur} placeholder="タイトル" />

        {/* Zeus に保存 */}
        <button style={zeusBtnStyle} onClick={handleZeusPush} disabled={zeusDisabled} title="マインドマップを Zeus に保存">
          {zeusLabel}
        </button>

        {/* テンプレート保存 */}
        <button style={s.iconBtn(PURPLE)} onClick={() => setShowSaveTemplate(true)}>テンプレ保存</button>

        {/* 共有 */}
        <button style={s.iconBtn(PURPLE)} onClick={() => navigate(`/m/${mapId}/share`)}>共有</button>

        {/* リスト⇔マップ */}
        <div style={s.modeToggle}>
          <button style={s.modeBtn(mode === "list")} onClick={() => setMode("list")}>リスト</button>
          <button style={s.modeBtn(mode === "map")}  onClick={() => setMode("map")}>マップ</button>
        </div>

        {/* レイアウト切替 */}
        {mode === "map" && (
          <button style={s.iconBtn()} onClick={toggleLayoutMode} title={layoutMode === "bi" ? "左→右に切替" : "中央展開に切替"}>
            {layoutMode === "bi" ? "⇔中央" : "→LR"}
          </button>
        )}

        <div style={s.saveLabel}>{saveState === "saving" ? "保存中..." : "保存済"}</div>
      </div>

      <div style={s.body}>
        {mode === "list" ? (
          <ListMode uid={uid} mapId={mapId} nodes={nodes} onNodesChange={handleNodesChange} onSaved={handleSaved} />
        ) : (
          <ReactFlowProvider>
            <MapMode
              uid={uid} mapId={mapId} nodes={nodes} layoutMode={layoutMode}
              onNodesChange={handleNodesChange} onSaved={handleSaved}
              onRequestTemplateInsert={handleRequestTemplateInsert}
              onRequestMapLink={handleRequestMapLink}
            />
          </ReactFlowProvider>
        )}
      </div>

      {/* モーダル */}
      {showSaveTemplate && (
        <SaveTemplateModal mapId={mapId} mapTitle={map.title} userId={uid}
          onClose={() => setShowSaveTemplate(false)}
          onSaved={name => { setShowSaveTemplate(false); showToast(`「${name}」をテンプレートに保存しました`); }} />
      )}
      {showTemplatePicker && (
        <TemplatePickerModal userId={uid} mode={templatePickerMode}
          onClose={() => setShowTemplatePicker(false)} onSelect={handleTemplateSelect} />
      )}
      {showMapPicker && (
        <MapPickerModal maps={allMaps} currentLink={selectedNodeForLink?.currentLinkedMapId}
          onClose={() => setShowMapPicker(false)} onSelect={handleMapLinkSelect} />
      )}

      {/* トースト */}
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "rgba(220,38,38,0.92)" : "rgba(22,163,74,0.92)", color: "#fff", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600, zIndex: 9999, pointerEvents: "none", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
