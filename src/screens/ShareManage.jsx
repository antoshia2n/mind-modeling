import { useState, useEffect } from "react";
import { T } from "shia2n-core";
import { navigate } from "../lib/navigate.js";

const BORDER  = "#e2e8f0";
const ACCENT  = "#3b82f6";
const DANGER  = "#ef4444";
const PURPLE  = "#a855f7";

/**
 * 共有URL管理画面 /m/:mapId/share
 * - 共有リンク一覧表示
 * - 新規作成・無効化・URLコピー・メモ編集
 */
export default function ShareManage({ mapId }) {
  const [links,     setLinks]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [creating,  setCreating]  = useState(false);
  const [newNote,   setNewNote]   = useState("");
  const [newExpiry, setNewExpiry] = useState(""); // ISO date string or ""
  const [copiedId,  setCopiedId]  = useState(null);

  useEffect(() => { loadLinks(); }, [mapId]);

  async function loadLinks() {
    setLoading(true);
    const res  = await fetch(
      `/api/internal/list-share-links?map_id=${mapId}`,
      { headers: { "Authorization": `Bearer ${window.__MM_SECRET__}` } }
    );
    const data = res.ok ? await res.json() : [];
    setLinks(data);
    setLoading(false);
  }

  async function handleCreate() {
    setCreating(true);
    const body = { map_id: mapId };
    if (newNote.trim()) body.note = newNote.trim();
    if (newExpiry)       body.expires_at = new Date(newExpiry).toISOString();

    const res = await fetch("/api/internal/create-share-link", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${window.__MM_SECRET__}`,
      },
      body: JSON.stringify(body),
    });

    setCreating(false);
    if (res.ok) {
      setNewNote("");
      setNewExpiry("");
      await loadLinks();
    } else {
      alert("作成に失敗しました。");
    }
  }

  async function handleRevoke(linkId) {
    if (!window.confirm("このリンクを無効化しますか？\nアクセスできなくなります。")) return;
    const res = await fetch("/api/internal/revoke-share-link", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${window.__MM_SECRET__}`,
      },
      body: JSON.stringify({ share_link_id: linkId }),
    });
    if (res.ok) await loadLinks();
    else alert("無効化に失敗しました。");
  }

  async function handleCopy(url, linkId) {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(linkId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const s = {
    wrap: {
      minHeight: "100vh", background: T.bg, color: T.fg,
      fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    },
    header: {
      padding: "12px 24px", borderBottom: `1px solid ${BORDER}`,
      display: "flex", alignItems: "center", gap: 14, height: 53, boxSizing: "border-box",
    },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 700 },
    body: { padding: "24px 32px", maxWidth: 720, margin: "0 auto" },
    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 14, fontWeight: 700, color: T.fg, marginBottom: 12 },
    card: {
      background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10,
      padding: "16px 20px", marginBottom: 10,
    },
    row: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
    urlText: {
      flex: 1, fontSize: 12, color: T.muted, overflow: "hidden",
      textOverflow: "ellipsis", whiteSpace: "nowrap",
      fontFamily: "'DM Mono','JetBrains Mono',monospace",
    },
    copyBtn: (copied) => ({
      background: copied ? "#dcfce7" : "white",
      border: `1px solid ${copied ? "#86efac" : BORDER}`,
      borderRadius: 6, padding: "4px 10px", fontSize: 12,
      color: copied ? "#16a34a" : T.muted, cursor: "pointer", flexShrink: 0,
    }),
    revokeBtn: {
      background: "none", border: `1px solid ${BORDER}`,
      borderRadius: 6, padding: "4px 10px", fontSize: 12,
      color: DANGER, cursor: "pointer", flexShrink: 0,
    },
    metaRow: { display: "flex", gap: 16, fontSize: 12, color: T.muted },
    badge: (active) => ({
      display: "inline-block",
      background: active ? "#dcfce7" : "#fee2e2",
      color:      active ? "#16a34a" : "#dc2626",
      borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 600, flexShrink: 0,
    }),
    form: {
      background: T.surface, border: `1px solid ${BORDER}`,
      borderRadius: 10, padding: "16px 20px",
    },
    formRow: { display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-end" },
    label: { fontSize: 12, color: T.muted, marginBottom: 4, display: "block" },
    input: {
      background: T.bg, border: `1px solid ${BORDER}`,
      borderRadius: 6, padding: "6px 10px", fontSize: 13, color: T.fg,
      fontFamily: "inherit", outline: "none",
    },
    createBtn: {
      background: PURPLE, color: "#fff", border: "none",
      borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600,
      cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1,
    },
  };

  // 有効 / 無効に分類
  const activeLinks   = links.filter(l => l.active);
  const inactiveLinks = links.filter(l => !l.active);

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
              <div style={{ flex: 1 }}>
                <label style={s.label}>メモ（任意）</label>
                <input
                  style={{ ...s.input, width: "100%", boxSizing: "border-box" }}
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="○○さん用、クライアント向け など"
                />
              </div>
              <div style={{ flexShrink: 0 }}>
                <label style={s.label}>有効期限（任意）</label>
                <input
                  type="date"
                  style={s.input}
                  value={newExpiry}
                  onChange={e => setNewExpiry(e.target.value)}
                />
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
            <LinkCard
              key={link.id}
              link={link}
              onCopy={handleCopy}
              onRevoke={handleRevoke}
              copiedId={copiedId}
              s={s}
            />
          ))}
        </div>

        {/* 無効なリンク一覧 */}
        {inactiveLinks.length > 0 && (
          <div style={s.section}>
            <div style={s.sectionTitle}>無効化済み（{inactiveLinks.length}件）</div>
            {inactiveLinks.map(link => (
              <LinkCard key={link.id} link={link} copiedId={copiedId} s={s} readOnly />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkCard({ link, onCopy, onRevoke, copiedId, s, readOnly = false }) {
  const copied = copiedId === link.id;
  const expired = link.expires_at && new Date(link.expires_at) < new Date();

  return (
    <div style={s.card}>
      <div style={s.row}>
        <span style={s.badge(link.active && !expired)}>
          {!link.active ? "無効" : expired ? "期限切れ" : "有効"}
        </span>
        <span style={s.urlText}>{link.share_url}</span>
        {!readOnly && (
          <>
            <button style={s.copyBtn(copied)} onClick={() => onCopy(link.share_url, link.id)}>
              {copied ? "コピー済" : "URLをコピー"}
            </button>
            <button style={s.revokeBtn} onClick={() => onRevoke(link.id)}>無効化</button>
          </>
        )}
      </div>
      <div style={s.metaRow}>
        {link.note && <span>📝 {link.note}</span>}
        <span>閲覧 {link.view_count ?? 0}回</span>
        {link.last_viewed_at && (
          <span>最終閲覧: {new Date(link.last_viewed_at).toLocaleDateString("ja-JP")}</span>
        )}
        {link.expires_at && (
          <span>期限: {new Date(link.expires_at).toLocaleDateString("ja-JP")}</span>
        )}
        {link.revoked_at && (
          <span>無効化: {new Date(link.revoked_at).toLocaleDateString("ja-JP")}</span>
        )}
        <span style={{ fontSize: 11, color: "#c4c4c4" }}>
          作成: {new Date(link.created_at).toLocaleDateString("ja-JP")}
        </span>
      </div>
    </div>
  );
}
