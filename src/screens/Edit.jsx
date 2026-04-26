import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { getMap, getNodes, updateMap, createNode } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";
import ListMode from "./ListMode.jsx";
import MapMode  from "./MapMode.jsx";

const BORDER = "#e2e8f0";
const ACCENT = "#3b82f6";
const PURPLE = "#a855f7";

export default function Edit({ mapId }) {
  const uid = useAuthUid();
  const [map,       setMap]       = useState(null);
  const [nodes,     setNodes]     = useState([]);
  const [saveState, setSaveState] = useState("saved");
  const [loading,   setLoading]   = useState(true);
  const [mode,      setMode]      = useState("list");

  useEffect(() => {
    if (!uid || !mapId) return;
    Promise.all([getMap(mapId), getNodes(mapId)]).then(async ([m, ns]) => {
      setMap(m);
      if (ns.length === 0) {
        const firstNode = await createNode(uid, mapId, null, 1024, "");
        setNodes(firstNode ? [firstNode] : []);
      } else {
        setNodes(ns);
      }
      setLoading(false);
    });
  }, [uid, mapId]);

  function handleTitleChange(e) { setMap(prev => ({ ...prev, title: e.target.value })); }
  async function handleTitleBlur(e) {
    setSaveState("saving");
    await updateMap(mapId, { title: e.target.value });
    setSaveState("saved");
  }
  function handleNodesChange(newNodes) { setNodes(newNodes); setSaveState("saving"); }
  function handleSaved() { setSaveState("saved"); }

  const s = {
    wrap: {
      minHeight: "100vh", background: T.bg, color: T.fg,
      fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
      display: "flex", flexDirection: "column",
    },
    header: {
      padding: "12px 24px", borderBottom: `1px solid ${BORDER}`,
      display: "flex", alignItems: "center", gap: 14,
      flexShrink: 0, height: 53, boxSizing: "border-box",
    },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0, whiteSpace: "nowrap" },
    titleInput: { flex: 1, background: "none", border: "none", fontSize: 17, fontWeight: 700, color: T.fg, outline: "none", fontFamily: "inherit", minWidth: 0 },
    modeToggle: { display: "flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
    modeBtn: (active) => ({
      background: active ? ACCENT : "none", color: active ? "#fff" : T.muted,
      border: "none", padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
    }),
    shareBtn: {
      background: "none", border: `1px solid ${PURPLE}`,
      borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 500,
      color: PURPLE, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
    },
    saveLabel: { fontSize: 12, color: T.muted, flexShrink: 0, whiteSpace: "nowrap" },
    body: { flex: 1, overflow: mode === "map" ? "hidden" : "auto" },
    center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: T.bg },
  };

  if (loading) return <div style={s.center}><span style={{ color: T.muted }}>読み込み中...</span></div>;
  if (!map)    return <div style={s.center}><span style={{ color: T.muted }}>マップが見つかりません。</span></div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate("/")}>← 一覧</button>
        <input
          style={s.titleInput}
          value={map.title ?? ""}
          onChange={handleTitleChange}
          onBlur={handleTitleBlur}
          placeholder="タイトル"
        />
        <button style={s.shareBtn} onClick={() => navigate(`/m/${mapId}/share`)}>共有</button>
        <div style={s.modeToggle}>
          <button style={s.modeBtn(mode === "list")} onClick={() => setMode("list")}>リスト</button>
          <button style={s.modeBtn(mode === "map")}  onClick={() => setMode("map")}>マップ</button>
        </div>
        <div style={s.saveLabel}>{saveState === "saving" ? "保存中..." : "保存済"}</div>
      </div>
      <div style={s.body}>
        {mode === "list" ? (
          <ListMode uid={uid} mapId={mapId} nodes={nodes} onNodesChange={handleNodesChange} onSaved={handleSaved} />
        ) : (
          <MapMode  uid={uid} mapId={mapId} nodes={nodes} onNodesChange={handleNodesChange} onSaved={handleSaved} />
        )}
      </div>
    </div>
  );
}
