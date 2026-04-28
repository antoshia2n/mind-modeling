import { useState, useRef, useEffect, useCallback } from "react";

const PURPLE = "#a855f7";
const BORDER = "#e2e8f0";
const MUTED  = "#94a3b8";

const SYSTEM_PROMPT = `あなたは議事録・セミナーノートの整形を担当するアシスタントです。
与えられた文字起こしテキストを、読みやすい日本語の議事録に整形してください。

## 出力フォーマット

# タイトル（内容から推測）

## 概要
（全体の要点を3〜5行）

## 主な内容

### [話題1]
- 要点1
- 要点2

### [話題2]
- 要点1

## 決定事項・アクションアイテム
- [ ] アクション（ない場合はセクション省略）

## 重要キーワード
- キーワード：説明

## 注意事項
- 言い淀み・繰り返しは除去して要点のみ残す
- 専門用語・固有名詞はそのまま保持
- Markdown形式で出力`;

function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

// シンプル Markdown レンダラー
function MarkdownView({ text }) {
  const lines = text.split("\n");
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: "#374151" }}>
      {lines.map((line, i) => {
        const l = line.trimEnd();
        if (!l) return <div key={i} style={{ height: 6 }} />;
        if (l.startsWith("# "))   return <div key={i} style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: "0 0 10px" }}>{l.slice(2)}</div>;
        if (l.startsWith("## "))  return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", borderBottom: `1px solid ${BORDER}`, paddingBottom: 4, margin: "14px 0 6px" }}>{l.slice(3)}</div>;
        if (l.startsWith("### ")) return <div key={i} style={{ fontSize: 12, fontWeight: 700, color: "#374151", margin: "10px 0 4px" }}>{l.slice(4)}</div>;
        if (l.startsWith("- [ ] ") || l.startsWith("- [x] ")) {
          const done = l.startsWith("- [x] ");
          return (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
              <span style={{ width: 14, height: 14, border: `1.5px solid #d1d5db`, borderRadius: 3, flexShrink: 0, marginTop: 2, background: done ? PURPLE : "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "white" }}>{done ? "✓" : ""}</span>
              <span style={{ textDecoration: done ? "line-through" : "none", color: done ? MUTED : "#374151" }}>{l.slice(6)}</span>
            </div>
          );
        }
        if (l.startsWith("- ") || l.startsWith("* "))
          return <div key={i} style={{ display: "flex", gap: 6, marginBottom: 2 }}><span style={{ color: PURPLE, flexShrink: 0, fontSize: 8, marginTop: 5 }}>●</span><span>{l.slice(2)}</span></div>;
        return <div key={i}>{l}</div>;
      })}
    </div>
  );
}

export default function MinutesPanel({ open, onClose, uid }) {
  const [status,      setStatus]      = useState("idle");
  const [transcript,  setTranscript]  = useState("");
  const [interim,     setInterim]     = useState("");
  const [minutes,     setMinutes]     = useState("");
  const [elapsed,     setElapsed]     = useState(0);
  const [zeusLoading, setZeusLoading] = useState(false);
  const [tab,         setTab]         = useState("transcript"); // "transcript" | "minutes"
  const [toast,       setToast]       = useState(null);

  const recognitionRef = useRef(null);
  const timerRef       = useRef(null);
  const transcriptRef  = useRef("");
  const textareaRef    = useRef(null);

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // パネルが閉じたら録音停止
  useEffect(() => { if (!open) stopRecording(); }, [open]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  function startRecording() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("Chrome で開いてください（音声認識非対応）", "error"); return; }

    const rec = new SR();
    rec.lang           = "ja-JP";
    rec.continuous     = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let fin = "", im = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t;
        else                      im  += t;
      }
      if (fin) {
        const next = transcriptRef.current + (transcriptRef.current ? "　" : "") + fin;
        transcriptRef.current = next;
        setTranscript(next);
        // テキストエリアを最下部にスクロール
        setTimeout(() => { if (textareaRef.current) textareaRef.current.scrollTop = textareaRef.current.scrollHeight; }, 50);
      }
      setInterim(im);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech") return;
      if (e.error === "not-allowed") { showToast("マイクの許可が必要です", "error"); stopRecording(); }
    };

    // Chrome の自動停止対策：終了後に再起動
    rec.onend = () => {
      if (recognitionRef.current === rec) {
        try { rec.start(); } catch (_) {}
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch { showToast("録音を開始できませんでした", "error"); }
  }

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
    clearInterval(timerRef.current);
    setInterim("");
    setStatus(prev => prev === "recording" ? "idle" : prev);
  }, []);

  useEffect(() => () => stopRecording(), [stopRecording]);

  async function formatMinutes() {
    const text = transcript.trim();
    if (!text) { showToast("文字起こしがありません", "error"); return; }
    setStatus("processing");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `以下の文字起こしを議事録に整形してください。\n\n${text}` }],
        }),
      });
      const data = await res.json();
      const out  = data.content?.find(b => b.type === "text")?.text ?? "";
      if (!out) throw new Error("empty");
      setMinutes(out);
      setStatus("done");
      setTab("minutes");
    } catch {
      showToast("整形に失敗しました", "error");
      setStatus("idle");
    }
  }

  async function saveToZeus() {
    if (!minutes || !uid) return;
    setZeusLoading(true);
    try {
      const res = await fetch("/api/internal/push-to-zeus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, content: minutes, source: "mind-modeling-minutes" }),
      });
      if (!res.ok) throw new Error();
      showToast("Zeus に保存しました");
    } catch { showToast("Zeus への保存に失敗しました", "error"); }
    setZeusLoading(false);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); showToast("コピーしました"); }
    catch { showToast("コピーに失敗しました", "error"); }
  }

  function reset() {
    stopRecording();
    setTranscript(""); transcriptRef.current = "";
    setInterim(""); setMinutes(""); setStatus("idle"); setElapsed(0); setTab("transcript");
  }

  const isRecording  = status === "recording";
  const isProcessing = status === "processing";
  const isDone       = status === "done";

  const panelStyle = {
    position: "absolute", top: 0, right: 0,
    width: 340, height: "100%",
    background: "white",
    borderLeft: `1px solid ${BORDER}`,
    boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
    display: "flex", flexDirection: "column",
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.25s cubic-bezier(0.4,0,0.2,1)",
    zIndex: 200,
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
  };

  return (
    <div style={panelStyle}>

      {/* パネルヘッダー */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", flex: 1 }}>議事録</div>
        <button onClick={reset} style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, color: MUTED, cursor: "pointer" }}>リセット</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
      </div>

      {/* 録音コントロール */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          style={{
            width: 44, height: 44, borderRadius: "50%", border: "none", cursor: isProcessing ? "default" : "pointer",
            background: isRecording ? "#fee2e2" : `linear-gradient(135deg, ${PURPLE}, #7c3aed)`,
            color: isRecording ? "#ef4444" : "white",
            fontSize: isRecording ? 16 : 18, flexShrink: 0,
            boxShadow: isRecording ? "0 0 0 4px rgba(239,68,68,0.2)" : "0 2px 12px rgba(168,85,247,0.4)",
            transition: "all 0.2s",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {isRecording ? "■" : "●"}
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: isRecording ? "#ef4444" : "#374151" }}>
            {isRecording ? "録音中" : isProcessing ? "整形中..." : "録音開始"}
          </div>
          {isRecording && (
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", fontVariantNumeric: "tabular-nums", letterSpacing: 1 }}>
              {formatTime(elapsed)}
            </div>
          )}
          {!isRecording && !isProcessing && (
            <div style={{ fontSize: 11, color: MUTED }}>Chrome のマイク許可が必要</div>
          )}
        </div>

        {transcript && !isProcessing && (
          <button onClick={formatMinutes}
            style={{ background: PURPLE, color: "white", border: "none", borderRadius: 7, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
            整形 →
          </button>
        )}
      </div>

      {/* タブ切替 */}
      <div style={{ display: "flex", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        {[{ key: "transcript", label: "文字起こし" }, { key: "minutes", label: "議事録" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: tab === t.key ? 700 : 400, color: tab === t.key ? PURPLE : MUTED, background: "none", border: "none", borderBottom: `2px solid ${tab === t.key ? PURPLE : "transparent"}`, cursor: "pointer" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* 文字起こしタブ */}
        {tab === "transcript" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
              <textarea
                ref={textareaRef}
                value={transcript + (interim ? (transcript ? "　" : "") + interim : "")}
                onChange={e => { setTranscript(e.target.value); transcriptRef.current = e.target.value; }}
                placeholder={isRecording ? "話してください..." : "録音を開始すると文字がここに表示されます"}
                style={{
                  width: "100%", height: "100%", padding: 14, boxSizing: "border-box",
                  border: "none", outline: "none", resize: "none",
                  fontSize: 13, lineHeight: 1.8, color: "#374151",
                  fontFamily: "inherit", background: "transparent",
                }}
              />
              {/* リアルタイム認識中インジケーター */}
              {isRecording && interim && (
                <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(168,85,247,0.1)", borderRadius: 10, padding: "2px 8px", fontSize: 10, color: PURPLE }}>認識中...</div>
              )}
            </div>
            {transcript && (
              <div style={{ padding: "8px 12px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 8, flexShrink: 0 }}>
                <button onClick={() => copyText(transcript)} style={{ flex: 1, background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 0", fontSize: 11, color: MUTED, cursor: "pointer" }}>コピー</button>
                <button onClick={formatMinutes} disabled={isProcessing}
                  style={{ flex: 1, background: PURPLE, color: "white", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: isProcessing ? "default" : "pointer", opacity: isProcessing ? 0.6 : 1 }}>
                  {isProcessing ? "整形中..." : "議事録に整形"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 議事録タブ */}
        {tab === "minutes" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {!minutes && !isProcessing && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontSize: 13, textAlign: "center", padding: 20 }}>
                文字起こしタブで<br />「議事録に整形」を押してください
              </div>
            )}
            {isProcessing && (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: MUTED, fontSize: 13 }}>
                <div>整形中...</div>
                <div style={{ width: 48, height: 3, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: "60%", height: "100%", background: PURPLE, borderRadius: 2, animation: "mmSlide 1s infinite" }} />
                </div>
              </div>
            )}
            {minutes && !isProcessing && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                  <MarkdownView text={minutes} />
                </div>
                <div style={{ padding: "8px 12px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => copyText(minutes)} style={{ flex: 1, background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "5px 0", fontSize: 11, color: MUTED, cursor: "pointer" }}>コピー</button>
                  <button onClick={saveToZeus} disabled={zeusLoading}
                    style={{ flex: 1, background: zeusLoading ? "#f1f5f9" : "#f59e0b", color: zeusLoading ? MUTED : "white", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 600, cursor: zeusLoading ? "default" : "pointer" }}>
                    {zeusLoading ? "保存中..." : "Zeus に保存"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "rgba(220,38,38,0.92)" : "rgba(22,163,74,0.92)", color: "white", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", zIndex: 300, pointerEvents: "none" }}>
          {toast.msg}
        </div>
      )}

      <style>{`@keyframes mmSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`}</style>
    </div>
  );
}
