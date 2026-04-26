import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthUid, T } from "shia2n-core";
import { navigate } from "../lib/navigate.js";
import { parseIndentedText, countNodes, guessTitle, formatPreview } from "../lib/textImport.js";

const BORDER  = "#e2e8f0";
const PURPLE  = "#a855f7";
const ACCENT  = "#3b82f6";
const DANGER  = "#ef4444";
const WARNING = "#f59e0b";
const MAX_WARN_NODES = 10000;
const HELP_KEY = "mm_import_help_open";

export default function ImportScreen() {
  const uid = useAuthUid();

  const [rawText,     setRawText]     = useState("");
  const [title,       setTitle]       = useState("");
  const [note,        setNote]        = useState("");
  const [preview,     setPreview]     = useState(null);
  const [importing,   setImporting]   = useState(false);
  const [toast,       setToast]       = useState(null);
  const [titleEdited, setTitleEdited] = useState(false);
  // ヘルプの開閉状態を localStorage に記憶（初回のみ開く）
  const [helpOpen, setHelpOpen] = useState(() => {
    const stored = localStorage.getItem(HELP_KEY);
    return stored === null ? true : stored === "1";
  });

  const textareaRef = useRef(null);

  function toggleHelp() {
    const next = !helpOpen;
    setHelpOpen(next);
    localStorage.setItem(HELP_KEY, next ? "1" : "0");
  }

  useEffect(() => {
    if (!rawText.trim()) { setPreview(null); if (!titleEdited) setTitle(""); return; }
    const { items, errors } = parseIndentedText(rawText);
    setPreview({ items, errors, nodeCount: countNodes(items), previewText: formatPreview(items, 60) });
    if (!titleEdited) setTitle(guessTitle(items));
  }, [rawText, titleEdited]);

  function handleTitleChange(e) { setTitle(e.target.value); setTitleEdited(true); }
  function showToast(msg, type = "success") { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); }

  function resetForm() {
    setRawText(""); setTitle(""); setNote(""); setPreview(null); setTitleEdited(false);
    setTimeout(() => textareaRef.current?.focus(), 80);
  }

  const handleImport = useCallback(async () => {
    if (!rawText.trim() || !title.trim() || importing) return;
    if (preview?.nodeCount > MAX_WARN_NODES) {
      if (!window.confirm(`このマップは ${preview.nodeCount} ノードあります。続行しますか？`)) return;
    }
    setImporting(true);

    let res;
    try {
      res = await fetch("/api/internal/import-text-to-map", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${window.__MM_SECRET__ ?? ""}` },
        body: JSON.stringify({ title: title.trim(), indented_text: rawText, user_id: uid, source_note: note.trim() || null }),
      });
    } catch {
      showToast("ネットワークに接続できません。", "error");
      setImporting(false); return;
    }

    let data;
    try { data = await res.json(); } catch {
      showToast(`サーバーエラーが発生しました（HTTP ${res.status}）。`, "error");
      setImporting(false); return;
    }

    if (!res.ok) {
      showToast(data?.message || data?.error || `インポートに失敗しました（HTTP ${res.status}）`, "error");
      setImporting(false); return;
    }

    showToast(`✓ インポート完了（${data.node_count ?? preview?.nodeCount ?? 0}ノード）`, "success");
    setImporting(false);
    setTimeout(resetForm, 800);
  }, [rawText, title, note, uid, preview, importing]);

  const canImport = rawText.trim() && title.trim() && (preview?.nodeCount ?? 0) > 0 && !importing;

  const s = {
    wrap: { minHeight: "100vh", background: T.bg, color: T.fg, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", display: "flex", flexDirection: "column" },
    header: { padding: "12px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0, height: 53, boxSizing: "border-box" },
    backBtn: { background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 14, padding: 0 },
    headerTitle: { flex: 1, fontSize: 16, fontWeight: 700 },
    historyLink: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 7, padding: "5px 12px", fontSize: 13, color: T.muted, cursor: "pointer", whiteSpace: "nowrap" },
    body: { flex: 1, padding: "24px 32px", maxWidth: 860, margin: "0 auto", width: "100%", boxSizing: "border-box" },
    help: { background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, marginBottom: 20, overflow: "hidden" },
    helpHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", cursor: "pointer", userSelect: "none" },
    helpTitle: { fontSize: 13, fontWeight: 700, color: "#0369a1" },
    helpContent: { padding: "0 16px 14px", fontSize: 13, color: "#0369a1", lineHeight: 1.9 },
    helpCode: { background: "#e0f2fe", borderRadius: 6, padding: "8px 12px", fontFamily: "'DM Mono','JetBrains Mono',monospace", fontSize: 12, marginTop: 8, lineHeight: 1.7 },
    section: { marginBottom: 18 },
    label: { fontSize: 13, fontWeight: 600, color: T.fg, marginBottom: 8, display: "block" },
    sublabel: { fontSize: 12, color: T.muted, marginLeft: 8, fontWeight: 400 },
    textarea: { width: "100%", boxSizing: "border-box", height: 180, resize: "vertical", background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", fontSize: 14, color: T.fg, fontFamily: "'DM Mono','JetBrains Mono',monospace", outline: "none", lineHeight: 1.6 },
    previewBox: { background: "#f8fafc", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 14px", fontFamily: "'DM Mono','JetBrains Mono',monospace", fontSize: 12, lineHeight: 1.7, color: "#374151", whiteSpace: "pre", overflowX: "auto", maxHeight: 240, overflowY: "auto" },
    nodeCount: (n) => ({ fontSize: 13, fontWeight: 600, marginBottom: 8, color: n > MAX_WARN_NODES ? DANGER : (n > 500 ? WARNING : ACCENT) }),
    errorBox: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: DANGER, marginBottom: 8, lineHeight: 1.7 },
    input: { width: "100%", boxSizing: "border-box", background: T.surface, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: T.fg, fontFamily: "inherit", outline: "none" },
    btnRow: { display: "flex", gap: 10, alignItems: "center" },
    clearBtn: { background: "none", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 18px", fontSize: 14, color: T.muted, cursor: "pointer" },
    importBtn: (can) => ({ background: can ? PURPLE : "#e2e8f0", color: can ? "#fff" : "#94a3b8", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: can ? "pointer" : "default", flex: 1 }),
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={() => navigate("/")}>← 一覧</button>
        <div style={s.headerTitle}>Whimsical からインポート</div>
        <button style={s.historyLink} onClick={() => navigate("/import-history")}>履歴を見る</button>
      </div>

      <div style={s.body}>
        {/* ヘルプ（開閉状態を記憶） */}
        <div style={s.help}>
          <div style={s.helpHeader} onClick={toggleHelp}>
            <span style={s.helpTitle}>📋 インポート手順（クリックで{helpOpen ? "閉じる" : "開く"}）</span>
            <span style={{ fontSize: 12, color: "#0369a1" }}>{helpOpen ? "▲" : "▼"}</span>
          </div>
          {helpOpen && (
            <div style={s.helpContent}>
              <div>1. Whimsical でマインドマップを開く</div>
              <div>2. <b>ルートノードを選択</b>（ここが重要）</div>
              <div>3. <b>Cmd+C</b>（Windows: Ctrl+C）でコピー</div>
              <div>4. 下のテキストエリアをクリック → <b>Cmd+V</b> で貼り付け</div>
              <div>5. プレビューを確認 → 「インポートして次へ」</div>
              <div style={s.helpCode}>{`- 親ノード\n  - 子ノード1\n    - 孫ノード\n  - 子ノード2`}</div>
            </div>
          )}
        </div>

        <div style={s.section}>
          <label style={s.label}>テキストを貼り付け<span style={s.sublabel}>（Cmd+V で直接ペースト）</span></label>
          <textarea ref={textareaRef} style={s.textarea} value={rawText} onChange={e => setRawText(e.target.value)}
            placeholder={"- ルートノード\n  - 子ノード1\n    - 孫ノード\n  - 子ノード2"} autoFocus />
        </div>

        {preview && (
          <div style={s.section}>
            <div style={s.nodeCount(preview.nodeCount)}>
              {preview.nodeCount > MAX_WARN_NODES
                ? `⚠️ ${preview.nodeCount.toLocaleString()}ノード（非常に大きいマップです）`
                : `全 ${preview.nodeCount.toLocaleString()} ノードを取り込みます`}
            </div>
            {preview.errors.length > 0 && (
              <div style={s.errorBox}>{preview.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}</div>
            )}
            <div style={s.previewBox}>{preview.previewText}</div>
          </div>
        )}

        <div style={s.section}>
          <label style={s.label}>マップタイトル<span style={s.sublabel}>（自動入力済み・編集可能）</span></label>
          <input style={s.input} value={title} onChange={handleTitleChange} placeholder="マップのタイトルを入力" />
        </div>

        <div style={s.section}>
          <label style={s.label}>メモ<span style={s.sublabel}>（任意）「Whimsical の○○フォルダから」など</span></label>
          <input style={s.input} value={note} onChange={e => setNote(e.target.value)} placeholder="例：Whimsical の「戦略」フォルダから" />
        </div>

        <div style={s.btnRow}>
          <button style={s.clearBtn} onClick={resetForm}>クリア</button>
          <button style={s.importBtn(canImport)} onClick={handleImport} disabled={!canImport}>
            {importing ? "インポート中..." : "インポートして次へ →"}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)",
          background: toast.type === "success" ? "rgba(22,163,74,0.92)" : "rgba(220,38,38,0.92)",
          color: "#fff", borderRadius: 10, padding: "10px 22px",
          fontSize: 14, fontWeight: 600, zIndex: 9999,
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
          pointerEvents: "none",
        }}>{toast.msg}</div>
      )}
    </div>
  );
}
