import { T, card, lb10 } from "shia2n-core";

export default function Home({ uid }) {
  return (
    <div style={{ ...card, padding: "20px 24px" }}>
      <div style={{ ...lb10, marginBottom: 8 }}>ようこそ</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>新しいアプリができました</div>
      <div style={{ fontSize: 12, color: T.muted }}>
        UID: <code style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{uid}</code>
      </div>
    </div>
  );
}
