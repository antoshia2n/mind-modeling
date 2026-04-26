import { useState } from "react";

const BORDER = "#e2e8f0";
const PURPLE = "#a855f7";

/**
 * テンプレートとして保存するモーダル
 * props:
 *   mapId       - 保存元マップID
 *   mapTitle    - デフォルトのテンプレ名
 *   userId
 *   onClose     - 閉じる
 *   onSaved(name) - 保存成功
 */
export default function SaveTemplateModal({ mapId, mapTitle, userId, onClose, onSaved }) {
  const [name,     setName]    = useState(mapTitle || "");
  const [desc,     setDesc]    = useState("");
  const [saving,   setSaving]  = useState(false);
  const [error,    setError]   = useState(null);

  async function handleSave() {
    if (!name.trim() || saving) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/internal/create-template-from-map", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
        body: JSON.stringify({ map_id: mapId, name: name.trim(), description: desc.trim() || null, user_id: userId }),
      });
      if (!res.ok) { setError("保存に失敗しました。"); return; }
      onSaved(name.trim());
    } catch { setError("ネットワークエラー"); }
    finally { setSaving(false); }
  }

  const s = {
    backdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 },
    modal: { background: "#fff", borderRadius: 14, padding: "24px 28px", width: 420, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 20, color: "#374151" },
    label: { fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" },
    input: { width: "100%", boxSizing: "border-box", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#374151", fontFamily: "inherit", outline: "none", marginBottom: 14 },
    error: { color: "#dc2626", fontSize: 13, marginBottom: 12 },
    btnRow: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 },
    cancelBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 16px", fontSize: 14, color: "#6b7280", cursor: "pointer" },
    saveBtn: (can) => ({ background: can ? PURPLE : "#e2e8f0", color: can ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 700, cursor: can ? "pointer" : "default" }),
  };

  return (
    <div style={s.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.title}>テンプレートとして保存</div>
        <label style={s.label}>テンプレート名（必須）</label>
        <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="例：戦略立案フレームワーク" autoFocus />
        <label style={s.label}>説明（任意）</label>
        <input style={s.input} value={desc} onChange={e => setDesc(e.target.value)} placeholder="テンプレートの用途や使い方" />
        {error && <div style={s.error}>{error}</div>}
        <div style={s.btnRow}>
          <button style={s.cancelBtn} onClick={onClose}>キャンセル</button>
          <button style={s.saveBtn(!!name.trim() && !saving)} onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
