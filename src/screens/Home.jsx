import { useState, useEffect, useMemo } from "react";
import { useAuthUid, T } from "shia2n-core";
import { getMaps, createMap, deleteMap } from "../lib/supabase.js";
import { navigate } from "../lib/navigate.js";

const ACCENT  = "#3b82f6";
const PURPLE  = "#a855f7";
const BORDER  = "#e2e8f0";

export default function Home() {
  const uid = useAuthUid();
  const [maps,     setMaps]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [search,   setSearch]   = useState("");
  const [sort,     setSort]     = useState("updated"); // "updated" | "title"
  const [hoverId,  setHoverId]  = useState(null);

  useEffect(() => {
    if (!uid) return;
    getMaps(uid).then(data => { setMaps(data); setLoading(false); });
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
    setMaps(prev => prev.filter(m => m.id !== mapId));
  }

  // 検索 + ソート
  const filteredMaps = useMemo(() => {
    let result = maps;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(m => (m.title || "").toLowerCase().includes(q));
    }
    if (sort === "title") {
      result = [...result].sort((a, b) => (a.title || "").localeCompare(b.title || "", "ja"));
    }
    // sort === "updated" は getMaps が updated_at desc で返すのでそのまま
    return result;
  }, [maps, search, sort]);

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header: { padding: "16px 28px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 },
    appTitle: { fontSize: 18, fontWeight: 700, flex: 1 },
    importBtn: {
      background: "none", border: `1px solid ${PURPLE}`,
      borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600,
      color: PURPLE, cursor: "pointer", whiteSpace: "nowrap",
    },
    createBtn: {
      background: ACCENT, color: "#fff", border: "none",
      borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 600,
      cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1,
    },
    toolbar: {
      padding: "12px 28px", display: "flex", alignItems: "center", gap: 10,
      borderBottom: `1px solid ${BORDER}`,
    },
    searchInput: {
      flex: 1, background: T.surface, border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: "8px 12px", fontSize: 14, color: T.fg,
      fontFamily: "inherit", outline: "none",
    },
    sortBtn: (active) => ({
      background: active ? "#f1f5f9" : "none",
      border: `1px solid ${active ? "#94a3b8" : BORDER}`,
      borderRadius: 7, padding: "7px 12px", fontSize: 12,
      color: active ? "#374151" : T.muted, cursor: "pointer",
    }),
    body: { padding: "20px 28px", maxWidth: 720, margin: "0 auto" },
    count: { fontSize: 12, color: T.muted, marginBottom: 12 },
    grid: { display: "flex", flexDirection: "column", gap: 8 },
    card: (hovered) => ({
      background: hovered ? "#f8fafc" : T.surface,
      border: `1px solid ${hovered ? "#94a3b8" : BORDER}`,
      borderRadius: 10, padding: "14px 18px", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      transition: "background 0.1s, border 0.1s",
    }),
    mapTitle: { fontSize: 15, fontWeight: 600 },
    mapDate:  { fontSize: 12, color: T.muted, marginTop: 3 },
    delBtn:   { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 15, padding: "4px 8px", flexShrink: 0, opacity: 0.6 },
    empty:    { textAlign: "center", color: T.muted, fontSize: 14, padding: 48, lineHeight: 1.9 },
    center:   { minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" },
  };

  if (loading) return <div style={s.center}><span style={{ color: T.muted }}>読み込み中...</span></div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.appTitle}>Mind-Modeling</div>
        <button style={s.importBtn} onClick={() => navigate("/import")}>Whimsical から移行</button>
        <button style={s.createBtn} onClick={handleCreate} disabled={creating}>
          {creating ? "作成中..." : "+ 新規マップ"}
        </button>
      </div>

      {/* 検索・ソートツールバー */}
      <div style={s.toolbar}>
        <input
          style={s.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="マップ名で検索..."
        />
        <button style={s.sortBtn(sort === "updated")} onClick={() => setSort("updated")}>更新日順</button>
        <button style={s.sortBtn(sort === "title")}   onClick={() => setSort("title")}>名前順</button>
      </div>

      <div style={s.body}>
        {filteredMaps.length === 0 && !search && maps.length === 0 ? (
          <div style={s.empty}>
            マップがありません。<br />
            「+ 新規マップ」で作成するか、<br />
            「Whimsical から移行」で既存のマップを取り込んでください。
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={s.empty}>「{search}」に一致するマップがありません。</div>
        ) : (
          <>
            <div style={s.count}>{filteredMaps.length}件</div>
            <div style={s.grid}>
              {filteredMaps.map(map => (
                <div
                  key={map.id}
                  style={s.card(hoverId === map.id)}
                  onClick={() => navigate(`/m/${map.id}`)}
                  onMouseEnter={() => setHoverId(map.id)}
                  onMouseLeave={() => setHoverId(null)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={s.mapTitle}>{map.title || "Untitled"}</div>
                    <div style={s.mapDate}>
                      {new Date(map.updated_at).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}
                    </div>
                  </div>
                  <button style={s.delBtn} onClick={e => handleDelete(e, map.id)} title="削除">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
