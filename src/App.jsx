import { useState } from "react";
import { useAuthUid, T } from "shia2n-core";
import { APP_NAME, TABS } from "./constants.js";
import Home from "./screens/Home.jsx";

export default function App() {
  const uid = useAuthUid();
  const [tab, setTab] = useState("ホーム");

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif", fontSize: 13, color: T.text }}>
      {/* Header */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{APP_NAME}</div>
        <nav style={{ display: "flex", gap: 3 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? T.text : "transparent", color: tab === t ? "#fff" : T.muted, border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div style={{ padding: "14px 16px", maxWidth: 680, margin: "0 auto" }}>
        {tab === "ホーム" && <Home uid={uid} />}
        {tab === "設定"  && <div style={{ color: T.muted, padding: 24, textAlign: "center" }}>設定画面（未実装）</div>}
      </div>
    </div>
  );
}
