import { useState, useEffect } from "react";
import { T } from "shia2n-core";
import { flattenTree } from "../lib/tree.js";
import { calcLayout } from "../lib/layout.js";
import ShareMapView from "./ShareMapView.jsx";
import ShareListView from "./ShareListView.jsx";

const BORDER = "#e2e8f0";
const ACCENT = "#3b82f6";

/**
 * 読み取り専用公開ビュー（ログイン不要）
 * /share/:token でレンダリングされる
 */
export default function ShareView({ token }) {
  const [status, setStatus]  = useState("loading"); // loading | ok | not_found | expired | error
  const [map,    setMap]     = useState(null);
  const [nodes,  setNodes]   = useState([]);
  const [mode,   setMode]    = useState("map"); // "list" | "map"

  useEffect(() => {
    if (!token) { setStatus("not_found"); return; }
    fetch(`/api/internal/get-share-content?token=${token}`)
      .then(async res => {
        if (res.status === 404) { setStatus("not_found"); return; }
        if (res.status === 410) { setStatus("expired");   return; }
        if (!res.ok)             { setStatus("error");     return; }
        const data = await res.json();
        setMap(data.map);
        setNodes(data.nodes);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [token]);

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
    title: { flex: 1, fontSize: 17, fontWeight: 700, color: T.fg, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    modeToggle: { display: "flex", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden", flexShrink: 0 },
    modeBtn: (active) => ({
      background: active ? ACCENT : "none", color: active ? "#fff" : T.muted,
      border: "none", padding: "6px 14px", fontSize: 13,
      fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
    }),
    badge: {
      fontSize: 11, color: T.muted, background: "#f1f5f9",
      border: `1px solid ${BORDER}`, borderRadius: 6,
      padding: "3px 8px", flexShrink: 0,
    },
    body: { flex: 1, overflow: mode === "map" ? "hidden" : "auto" },
    center: { display: "flex", alignItems: "center", justifyContent: "center", flex: 1, flexDirection: "column", gap: 16 },
    footer: {
      padding: "8px 24px", borderTop: `1px solid ${BORDER}`,
      fontSize: 11, color: T.muted, textAlign: "center",
      flexShrink: 0,
    },
  };

  if (status === "loading") {
    return (
      <div style={{ ...s.wrap, alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: T.muted }}>読み込み中...</span>
      </div>
    );
  }

  if (status === "not_found") return <ErrorScreen title="リンクが無効です" message="このリンクは存在しないか、無効化されました。" />;
  if (status === "expired")   return <ErrorScreen title="リンクの期限が切れています" message="このリンクの有効期限が切れました。共有者に新しいリンクを依頼してください。" />;
  if (status === "error")     return <ErrorScreen title="エラーが発生しました" message="しばらく待ってから再度お試しください。" />;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>{map?.title || "Untitled"}</div>
        <span style={s.badge}>閲覧専用</span>
        <div style={s.modeToggle}>
          <button style={s.modeBtn(mode === "list")} onClick={() => setMode("list")}>リスト</button>
          <button style={s.modeBtn(mode === "map")}  onClick={() => setMode("map")}>マップ</button>
        </div>
      </div>

      <div style={s.body}>
        {mode === "list" ? (
          <ShareListView nodes={nodes} />
        ) : (
          <ShareMapView nodes={nodes} />
        )}
      </div>

      <div style={s.footer}>
        Mind-Modeling for shia2n
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
      background: "#f8fafc",
      fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    }}>
      <div style={{ fontSize: 32 }}>🔒</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#374151" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#6b7280" }}>{message}</div>
    </div>
  );
}
