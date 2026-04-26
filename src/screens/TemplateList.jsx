import { useState, useEffect } from "react";
import { useAuthUid, T } from "shia2n-core";
import { navigate } from "../lib/navigate.js";

const BORDER = "#e2e8f0";
const PURPLE = "#a855f7";
const DANGER = "#ef4444";

function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` };
}

export default function TemplateList() {
  const uid = useAuthUid();
  const [items,     setItems]   = useState([]);
  const [loading,   setLoading] = useState(true);
  const [error,     setError]   = useState(null);
  const [search,    setSearch]  = useState("");
  const [debSearch, setDeb]     = useState("");

  useEffect(() => { const t = setTimeout(() => setDeb(search), 300); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true); setError(null);
    const qs = new URLSearchParams({ user_id: uid, limit: "200" });
    if (debSearch) qs.set("search", debSearch);
    fetch(`/api/internal/list-templates?${qs}`, { headers: authHeaders() })
      .then(async res => {
        if (!res.ok) { setError(`取得に失敗しました（HTTP ${res.status}）`); return; }
        const data = await res.json();
        setItems(data.items ?? []);
      })
      .catch(() => setError("ネットワークエラー"))
      .finally(() => setLoading(false));
  }, [uid, debSearch]);

  async function handleDelete(templateId, name) {
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    const res = await fetch("/api/internal/delete-template", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ template_id: templateId, user_id: uid }),
    });
    if (res.ok) setItems(prev => prev.filter(t => t.id !== templateId));
    else alert("削除に失敗しました。");
  }

  async function handleUse(templateId) {
    // テンプレから新規マップ → タイトル入力 → 作成
    const title = window.prompt("新しいマップのタイトルを入力してください：");
    if (!title?.trim()) return;
    const res = await fetch("/api/internal/create-map-from-template", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ template_id: templateId, title: title.trim(), user_id: uid }),
    });
    if (!res.ok) { alert("マップ作成に失敗しました。"); return; }
    const data = await res.json();
    navigate(`/m/${data.map_id}`);
  }

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" },
    header: { padding: "12px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 14, height: 53, boxSizing: "border-box" },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 700 },
    body: { padding: "20px 28px", maxWidth: 760, margin: "0 auto" },
    searchInput: { width: "100%", boxSizing: "border-box", background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "9px 14px", fontSize: 14, color: T.fg, fontFamily: "inherit", outline: "none", marginBottom: 16 },
    card: { background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 18px", marginBottom: 10, display: "flex", alignItems: "center", gap: 14 },
    info: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    desc: { fontSize: 12, color: T.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    meta: { fontSize: 11, color: T.muted, marginTop: 4, display: "flex", gap: 12 },
    useBtn: { background: PURPLE, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 },
    delBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "6px 10px", fontSize: 12, color: T.muted, cursor: "pointer", flexShrink: 0 },
    errorBox: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#dc2626", marginBottom: 20 },
    empty: { textAlign: "center", color: T.muted, fontSize: 14, padding: 40, lineHeight: 1.8 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate("/")}>← 一覧</button>
        <div style={s.headerTitle}>テンプレート一覧</div>
      </div>
      <div style={s.body}>
        {error && <div style={s.errorBox}>{error}</div>}
        <input style={s.searchInput} value={search} onChange={e => setSearch(e.target.value)} placeholder="テンプレート名・説明で検索..." />
        {loading ? <div style={s.empty}>読み込み中...</div> :
         items.length === 0 ? <div style={s.empty}>{debSearch ? "検索結果がありません。" : "テンプレートがありません。\nマップ編集画面の「テンプレート保存」から作成してください。"}</div> :
         items.map(t => (
          <div key={t.id} style={s.card}>
            <div style={s.info}>
              <div style={s.name}>{t.name}</div>
              {t.description && <div style={s.desc}>{t.description}</div>}
              <div style={s.meta}>
                <span>{t.node_count}ノード</span>
                <span>使用 {t.use_count}回</span>
                {t.last_used_at && <span>最終使用: {new Date(t.last_used_at).toLocaleDateString("ja-JP")}</span>}
                <span>作成: {new Date(t.created_at).toLocaleDateString("ja-JP")}</span>
              </div>
            </div>
            <button style={s.useBtn} onClick={() => handleUse(t.id)}>使う</button>
            <button style={s.delBtn} onClick={() => handleDelete(t.id, t.name)}>削除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
