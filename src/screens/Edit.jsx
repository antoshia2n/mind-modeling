import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { getMap, getNodes, updateMap, createNode } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";
import ListMode from "./ListMode.jsx";

const BORDER = "#e2e8f0";

export default function Edit({ mapId }) {
  const uid = useAuthUid();
  const [map, setMap] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving"
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid || !mapId) return;
    Promise.all([getMap(mapId), getNodes(mapId)]).then(async ([m, ns]) => {
      setMap(m);
      if (ns.length === 0) {
        // 初回：最初のノードを自動作成する
        const firstNode = await createNode(uid, mapId, null, 1024, "");
        setNodes(firstNode ? [firstNode] : []);
      } else {
        setNodes(ns);
      }
      setLoading(false);
    });
  }, [uid, mapId]);

  function handleTitleChange(e) {
    setMap((prev) => ({ ...prev, title: e.target.value }));
  }

  async function handleTitleBlur(e) {
    setSaveState("saving");
    await updateMap(mapId, { title: e.target.value });
    setSaveState("saved");
  }

  function handleNodesChange(newNodes) {
    setNodes(newNodes);
    setSaveState("saving");
  }

  function handleSaved() {
    setSaveState("saved");
  }

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", display: "flex", flexDirection: "column" },
    header: { padding: "14px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0, whiteSpace: "nowrap" },
    titleInput: { flex: 1, background: "none", border: "none", fontSize: 18, fontWeight: 700, color: T.fg, outline: "none", fontFamily: "inherit", minWidth: 0 },
    saveLabel: { fontSize: 12, color: T.muted, flexShrink: 0, whiteSpace: "nowrap" },
    body: { flex: 1, overflow: "auto" },
    center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: T.bg },
  };

  if (loading) return <div style={s.center}><span style={{ color: T.muted }}>読み込み中...</span></div>;
  if (!map) return <div style={s.center}><span style={{ color: T.muted }}>マップが見つかりません。</span></div>;

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
        <div style={s.saveLabel}>{saveState === "saving" ? "保存中..." : "保存済"}</div>
      </div>
      <div style={s.body}>
        <ListMode
          uid={uid}
          mapId={mapId}
          nodes={nodes}
          onNodesChange={handleNodesChange}
          onSaved={handleSaved}
        />
      </div>
    </div>
  );
}
