import { useState, useEffect } from "react";
import { T } from "shia2n-core";
import { navigate } from "../lib/navigate.js";

const BORDER  = "#e2e8f0";
const PURPLE  = "#a855f7";
const DANGER  = "#ef4444";
const SUCCESS = "#16a34a";

export default function ShareManage({ mapId }) {
  const [links,     setLinks]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [creating,  setCreating]  = useState(false);
  const [newNote,   setNewNote]   = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [copiedId,  setCopiedId]  = useState(null);

  useEffect(() => { loadLinks(); }, [mapId]);

  async function loadLinks() {
    setLoading(true);
    try {
      const res  = await fetch(
        `/api/internal/list-share-links?map_id=${mapId}`,
        { headers: authHeaders() }
      );
      setLinks(res.ok ? await res.json() : []);
    } catch { setLinks([]); }
    setLoading(false);
  }

  function authHeaders() {
    return {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}`,
    };
  }

  async function handleCreate() {
    setCreating(true);
    const body = { map_id: mapId };
    if (newNote.trim()) body.note       = newNote.trim();
    if (newExpiry)      body.expires_at = new Date(newExpiry).toISOString();
    try {
      const res = await fetch("/api/internal/create-share-link", {
        method: "POST", headers: authHeaders(), body: JSON.stringify(body),
      });
      if (res.ok) { setNewNote(""); setNewExpiry(""); await loadLinks(); }
      else alert("作成に失敗しました。");
    } catch { alert("作成に失敗しました。"); }
    setCreating(false);
  }

  async function handleRevoke(linkId) {
    if (!window.confirm("このリンクを無効化しますか？\nアクセスできなくなります。")) return;
    try {
      const res = await fetch("/api/internal/revoke-share-link", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ share_link_id: linkId }),
      });
      if (res.ok) await loadLinks();
      else alert("無効化に失敗しました。");
    } catch { alert("無効化に失敗しました。"); }
  }

  async function handleReactivate(linkId) {
    if (!window.confirm("このリンクを再有効化しますか？\n再び誰でもアクセスできるようになります。")) return;
    try {
      const res = await fetch("/api/internal/reactivate-share-link", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ share_link_id: linkId }),
      });
      if (res.ok) await loadLinks();
      else alert("再有効化に失敗しました。");
    } catch { alert("再有効化に失敗しました。"); }
  }

  async function handleCopy(url, linkId) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const activeLinks   = links.filter(l => l.active);
  const inactiveLinks = links.filter(l => !l.active);

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header: { padding: "12px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 14, height: 53, boxSizing: "border-box" },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 700 },
    body: { padding: "24px 32px", maxWidth: 720, margin: "0 auto" },
    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 14, fontWeight: 700, color: T.fg, marginBottom: 12 },
    card: { background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px", marginBottom: 10 },
    row: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" },
    urlText: { flex: 1, fontSize: 12, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'DM Mono','JetBrains Mono',monospace", minWidth: 0 },
    metaRow: { display: "flex", gap: 12, fontSize: 12, color: T.muted, flexWrap: "wrap" },
    badge: (active) => ({
      display: "inline-block",
      background: active ? "#dcfce7" : "#fee2e2",
      color:      active ? SUCCESS   : DANGER,
      borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, flexShrink: 0,
    }),
    form: { background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "16px 20px" },
    formRow: { display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-end", flexWrap: "wrap" },
    label: { fontSize: 12, color: T.muted, marginBottom: 4, display: "block" },
    input: { background: T.bg, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, color: T.fg, fontFamily: "inherit", outline: "none" },
    btn: (color, filled = true) => ({
      background: filled ? color : "none",
      border: `1px solid ${color}`,
      borderRadius: 6, padding: "4px 10px", fontSize: 12,
      color: filled ? "#fff" : color, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
    }),
    createBtn: { background: PURPLE, color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate(`/m/${mapId}`)}>← 編集画面に戻る</button>
        <div style={s.headerTitle}>共有URL管理</div>
      </div>

      <div style={s.body}>
        {/* 新規作成フォーム */}
        <div style={s.section}>
          <div style={s.sectionTitle}>+ 新規共有URLを作成</div>
          <div style={s.form}>
            <div style={s.formRow}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={s.label}>メモ（任意）</label>
                <input style={{ ...s.input, width: "100%", boxSizing: "border-box" }}
                  value={newNote} onChange={e => setNewNote(e.target.value)}
                  placeholder="○○さん用、クライアント向け など" />
              </div>
              <div style={{ flexShrink: 0 }}>
                <label style={s.label}>有効期限（任意）</label>
                <input type="date" style={s.input}
                  value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
              </div>
            </div>
            <button style={s.createBtn} onClick={handleCreate} disabled={creating}>
              {creating ? "作成中..." : "URLを発行"}
            </button>
          </div>
        </div>

        {/* 有効なリンク一覧 */}
        <div style={s.section}>
          <div style={s.sectionTitle}>有効な共有URL（{activeLinks.length}件）</div>
          {loading ? (
            <div style={{ color: T.muted, fontSize: 13 }}>読み込み中...</div>
          ) : activeLinks.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 13 }}>まだURLがありません。上のフォームから発行してください。</div>
          ) : activeLinks.map(link => (
            <LinkCard key={link.id} link={link}
              onCopy={handleCopy} onRevoke={handleRevoke}
              copiedId={copiedId} s={s} />
          ))}
        </div>

        {/* 無効化済み一覧（再有効化ボタン付き） */}
        {inactiveLinks.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionTitle}>無効化済み（{inactiveLinks.length}件）</div>
            {inactiveLinks.map(link => (
              <LinkCard key={link.id} link={link}
                onCopy={handleCopy} onReactivate={handleReactivate}
                copiedId={copiedId} s={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkCard({ link, onCopy, onRevoke, onReactivate, copiedId, s }) {
  const expired = link.expires_at && new Date(link.expires_at) < new Date();
  const copied  = copiedId === link.id;

  return (
    <div style={s.card}>
      <div style={s.row}>
        <span style={s.badge(link.active && !expired)}>
          {!link.active ? "無効" : expired ? "期限切れ" : "有効"}
        </span>
        <span style={s.urlText}>{link.share_url}</span>

        {/* 有効なリンク：コピー + 無効化 */}
        {link.active && (
          <>
            <button style={s.btn(copied ? "#16a34a" : "#6b7280", false)}
              onClick={() => onCopy(link.share_url, link.id)}>
              {copied ? "コピー済" : "URLをコピー"}
            </button>
            <button style={s.btn(DANGER, false)} onClick={() => onRevoke?.(link.id)}>
              無効化
            </button>
          </>
        )}

        {/* 無効化済みリンク：再有効化 */}
        {!link.active && (
          <button style={s.btn("#6b7280", false)} onClick={() => onReactivate?.(link.id)}>
            再有効化
          </button>
        )}
      </div>

      <div style={s.metaRow}>
        {link.note && <span>📝 {link.note}</span>}
        <span>閲覧 {link.view_count ?? 0}回</span>
        {link.last_viewed_at && <span>最終閲覧: {new Date(link.last_viewed_at).toLocaleDateString("ja-JP")}</span>}
        {link.expires_at     && <span>期限: {new Date(link.expires_at).toLocaleDateString("ja-JP")}</span>}
        {link.revoked_at     && <span>無効化: {new Date(link.revoked_at).toLocaleDateString("ja-JP")}</span>}
        <span style={{ fontSize: 11, color: "#c4c4c4" }}>作成: {new Date(link.created_at).toLocaleDateString("ja-JP")}</span>
      </div>
    </div>
  );
}
