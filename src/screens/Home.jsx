import { useAuthUid, T } from "shia2n-core";

export default function Home() {
  const uid = useAuthUid();

  const wrap = {
    minHeight: "100vh",
    background: T.bg,
    color: T.fg,
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  };

  const heading = {
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: "0.02em",
  };

  const subtle = {
    fontSize: 12,
    color: T.muted,
    fontFamily: "'DM Mono','JetBrains Mono',monospace",
    background: T.surface,
    padding: "8px 12px",
    borderRadius: 6,
  };

  const phase = {
    fontSize: 11,
    color: T.muted,
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  };

  return (
    <div style={wrap}>
      <div style={phase}>Phase 0 — Setup Complete</div>
      <div style={heading}>Hello, Mind-Modeling</div>
      <div style={subtle}>uid: {uid ?? "(未取得)"}</div>
    </div>
  );
}
