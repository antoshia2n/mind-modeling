import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { getMaps, createMap, deleteMap } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";

const ACCENT = "#3b82f6";
const BORDER = "#e2e8f0";

export default function Home() {
  const uid = useAuthUid();
  const [maps, setMaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!uid) return;
    getMaps(uid).then((data) => { setMaps(data); setLoading(false); });
  }, [uid]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    const map = await createMap(uid);
    setCreating(false);
    if (map) navigate(`/m/${map.id}`);
  }

  async function handleDelete(e, mapId) {
    e.stopPropagation();
    if (!window.confirm("このマップを削除しますか？\n（ノードも全て削除されます）")) return;
    await deleteMap(mapId);
    setMaps((prev) => prev.filter((m) => m.id !== mapId));
  }

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header: { padding: "20px 32px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" },
    appTitle: { fontSize: 18, fontWeight: 700 },
    createBtn: { background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1 },
    body: { padding: "28px 32px", maxWidth: 720, margin: "0 auto" },
    grid: { display: "flex", flexDirection: "column", gap: 10 },
    card: { background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" },
    mapTitle: { fontSize: 15, fontWeight: 600 },
    mapDate: { fontSize: 12, color: T.muted, marginTop: 4 },
    delBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, padding: "4px 8px", lineHeight: 1, flexShrink: 0 },
    empty: { textAlign: "center", color: T.muted, fontSize: 14, padding: 48, lineHeight: 1.8 },
    center: { minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" },
  };

  if (loading) return <div style={s.center}><span style={{ color: T.muted }}>読み込み中...</span></div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.appTitle}>Mind-Modeling</div>
        <button style={s.createBtn} onClick={handleCreate} disabled={creating}>
          {creating ? "作成中..." : "+ 新規マップ"}
        </button>
      </div>
      <div style={s.body}>
        {maps.length === 0 ? (
          <div style={s.empty}>マップがありません。<br />「+ 新規マップ」ボタンから作成してください。</div>
        ) : (
          <div style={s.grid}>
            {maps.map((map) => (
              <div key={map.id} style={s.card} onClick={() => navigate(`/m/${map.id}`)}>
                <div>
                  <div style={s.mapTitle}>{map.title || "Untitled"}</div>
                  <div style={s.mapDate}>{new Date(map.updated_at).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}</div>
                </div>
                <button style={s.delBtn} onClick={(e) => handleDelete(e, map.id)} title="削除">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
