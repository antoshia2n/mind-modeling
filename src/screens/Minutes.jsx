import { useState, useRef, useEffect, useCallback } from "react";
import { useAuthUid } from "shia2n-core";
import { navigate } from "../lib/navigate.js";

// ─── 定数 ─────────────────────────────────────────────────────

const PURPLE = "#a855f7";
const BORDER = "#e2e8f0";
const MUTED  = "#94a3b8";

const SYSTEM_PROMPT = `あなたは議事録・セミナーノートの整形を担当するアシスタントです。
与えられた文字起こしテキストを、読みやすい日本語の議事録に整形してください。

## 出力フォーマット

# タイトル（内容から推測して適切なタイトルをつける）

## 概要
（全体の要点を3〜5行でまとめる）

## 主な内容

### [話題1のタイトル]
- 要点1
- 要点2

### [話題2のタイトル]
- 要点1
- 要点2

## 決定事項・アクションアイテム
- [ ] アクション1
- [ ] アクション2

（決定事項・アクションアイテムがない場合はこのセクションを省略）

## 重要なキーワード・用語
- キーワード1：説明
- キーワード2：説明

## 注意事項
- 話者の言い淀み・繰り返しは除去して要点だけ残す
- 専門用語や固有名詞はそのまま保持する
- Markdown形式で出力する
- セクションは話の流れに合わせて柔軟に増減してよい`;

// ─── Minutes ─────────────────────────────────────────────────

export default function Minutes() {
  const uid = useAuthUid();

  const [status,       setStatus]       = useState("idle");    // idle | recording | processing | done | error
  const [transcript,   setTranscript]   = useState("");        // 確定テキスト
  const [interim,      setInterim]      = useState("");        // 認識中テキスト
  const [minutes,      setMinutes]      = useState("");        // 整形済み議事録
  const [elapsed,      setElapsed]      = useState(0);        // 録音時間（秒）
  const [toast,        setToast]        = useState(null);
  const [zeusLoading,  setZeusLoading]  = useState(false);

  const recognitionRef = useRef(null);
  const timerRef       = useRef(null);
  const transcriptRef  = useRef("");    // onresult クロージャから参照するため ref でも保持

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  function showToast(msg, type = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ─── 録音開始 ───────────────────────────────────────────────

  function startRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("このブラウザは音声認識に対応していません（Chrome を使用してください）", "error");
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang            = "ja-JP";
    rec.continuous      = true;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let newFinal   = "";
      let newInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) newFinal += text;
        else                          newInterim += text;
      }
      if (newFinal) {
        const next = transcriptRef.current + (transcriptRef.current ? "　" : "") + newFinal;
        transcriptRef.current = next;
        setTranscript(next);
      }
      setInterim(newInterim);
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech") return; // 無音は無視
      if (e.error === "not-allowed") { showToast("マイクの許可が必要です", "error"); stopRecording(); return; }
      console.warn("SpeechRecognition error:", e.error);
    };

    // Chrome は一定時間で自動停止するため、終了後に再起動して継続録音
    rec.onend = () => {
      if (recognitionRef.current === rec && status !== "idle") {
        try { rec.start(); } catch (_) {}
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setStatus("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (e) {
      showToast("録音を開始できませんでした", "error");
    }
  }

  // ─── 録音停止 ───────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // 再起動ループを止める
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    clearInterval(timerRef.current);
    setInterim("");
    setStatus("idle");
  }, []);

  useEffect(() => () => {
    stopRecording();
  }, [stopRecording]);

  // ─── 議事録整形（Claude API）───────────────────────────────

  async function formatMinutes() {
    const text = transcript.trim();
    if (!text) { showToast("文字起こしテキストがありません", "error"); return; }
    setStatus("processing");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `以下の文字起こしテキストを議事録に整形してください。\n\n${text}` }],
        }),
      });

      const data = await res.json();
      const output = data.content?.find(b => b.type === "text")?.text ?? "";
      if (!output) throw new Error("APIレスポンスが空です");
      setMinutes(output);
      setStatus("done");
    } catch (e) {
      console.error(e);
      showToast("整形に失敗しました", "error");
      setStatus("idle");
    }
  }

  // ─── Zeus に保存 ─────────────────────────────────────────────

  async function saveToZeus() {
    if (!minutes) return;
    setZeusLoading(true);
    try {
      const res = await fetch("/api/internal/push-to-zeus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, content: minutes, source: "mind-modeling-minutes" }),
      });
      if (!res.ok) throw new Error();
      showToast("Zeus に保存しました");
    } catch {
      showToast("Zeus への保存に失敗しました", "error");
    }
    setZeusLoading(false);
  }

  // ─── クリップボードにコピー ────────────────────────────────

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); showToast("コピーしました"); }
    catch { showToast("コピーに失敗しました", "error"); }
  }

  // ─── 時間フォーマット ─────────────────────────────────────

  function formatTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  const isRecording  = status === "recording";
  const isProcessing = status === "processing";
  const isDone       = status === "done";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" }}>

      {/* ヘッダー */}
      <div style={{ background: "white", borderBottom: `1px solid ${BORDER}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => navigate("/")} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: 13, padding: "4px 8px" }}>← ホーム</button>
        <div style={{ width: 1, height: 16, background: BORDER }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>議事録モード</div>
        <div style={{ fontSize: 11, color: MUTED, background: "#f1f5f9", borderRadius: 10, padding: "2px 8px" }}>β</div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* 録音コントロール */}
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              style={{
                width: 80, height: 80, borderRadius: "50%", border: "none", cursor: "pointer",
                background: isRecording ? "#fee2e2" : `linear-gradient(135deg, ${PURPLE}, #7c3aed)`,
                color: isRecording ? "#ef4444" : "white",
                fontSize: isRecording ? 28 : 32,
                boxShadow: isRecording
                  ? "0 0 0 6px rgba(239,68,68,0.2), 0 4px 16px rgba(239,68,68,0.3)"
                  : "0 4px 20px rgba(168,85,247,0.4)",
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
              }}
            >
              {isRecording ? "■" : "●"}
            </button>
          </div>

          <div style={{ fontSize: 14, fontWeight: 600, color: isRecording ? "#ef4444" : "#374151", marginBottom: 4 }}>
            {isRecording ? "録音中" : "クリックして録音開始"}
          </div>

          {isRecording && (
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#1e293b", letterSpacing: 2 }}>
              {formatTime(elapsed)}
            </div>
          )}

          <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
            Chrome のマイク許可が必要です ・ 日本語に最適化
          </div>
        </div>

        {/* 文字起こし表示 */}
        <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>文字起こし</div>
            <div style={{ display: "flex", gap: 8 }}>
              {transcript && (
                <>
                  <button onClick={() => copyToClipboard(transcript)}
                    style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: MUTED, cursor: "pointer" }}>
                    コピー
                  </button>
                  <button onClick={() => { setTranscript(""); transcriptRef.current = ""; setInterim(""); setMinutes(""); setStatus("idle"); }}
                    style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#ef4444", cursor: "pointer" }}>
                    クリア
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ minHeight: 160, maxHeight: 320, overflowY: "auto", padding: 16 }}>
            {!transcript && !interim && !isRecording && (
              <div style={{ color: MUTED, fontSize: 13, textAlign: "center", paddingTop: 40 }}>
                録音を開始するとここにリアルタイムで文字が表示されます
              </div>
            )}
            {(transcript || interim) && (
              <div style={{ fontSize: 14, lineHeight: 1.8, color: "#374151" }}>
                <span>{transcript}</span>
                {interim && <span style={{ color: "#94a3b8" }}>{transcript ? "　" : ""}{interim}</span>}
              </div>
            )}
          </div>
        </div>

        {/* 整形ボタン */}
        {transcript && !isProcessing && (
          <button onClick={formatMinutes}
            style={{ background: `linear-gradient(135deg, ${PURPLE}, #7c3aed)`, color: "white", border: "none", borderRadius: 10, padding: "14px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer", boxShadow: "0 4px 16px rgba(168,85,247,0.35)" }}>
            議事録に整形する →
          </button>
        )}

        {isProcessing && (
          <div style={{ textAlign: "center", padding: 24, color: MUTED, fontSize: 14 }}>
            <div style={{ marginBottom: 8 }}>整形中...</div>
            <div style={{ width: 40, height: 4, background: BORDER, borderRadius: 2, margin: "0 auto", overflow: "hidden" }}>
              <div style={{ width: "60%", height: "100%", background: PURPLE, borderRadius: 2, animation: "slide 1s infinite" }} />
            </div>
          </div>
        )}

        {/* 整形済み議事録 */}
        {isDone && minutes && (
          <div style={{ background: "white", border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>整形済み議事録</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => copyToClipboard(minutes)}
                  style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, color: MUTED, cursor: "pointer" }}>
                  コピー
                </button>
                <button onClick={saveToZeus} disabled={zeusLoading}
                  style={{ background: zeusLoading ? "#f1f5f9" : PURPLE, color: zeusLoading ? MUTED : "white", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: zeusLoading ? "default" : "pointer" }}>
                  {zeusLoading ? "保存中..." : "Zeus に保存"}
                </button>
              </div>
            </div>

            <div style={{ padding: 20, maxHeight: 600, overflowY: "auto" }}>
              <MarkdownView text={minutes} />
            </div>

            <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER}`, display: "flex", gap: 8 }}>
              <button onClick={formatMinutes}
                style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#374151", cursor: "pointer" }}>
                再整形
              </button>
              <button onClick={() => { setStatus("idle"); setMinutes(""); }}
                style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 12px", fontSize: 12, color: "#374151", cursor: "pointer" }}>
                文字起こしを編集
              </button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? "rgba(220,38,38,0.92)" : "rgba(22,163,74,0.92)", color: "white", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600, zIndex: 9999, pointerEvents: "none" }}>
          {toast.msg}
        </div>
      )}

      <style>{`
        @keyframes slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}

// ─── シンプルな Markdown レンダラー ──────────────────────────
// 外部ライブラリなしで h1/h2/h3/li/p を描画

function MarkdownView({ text }) {
  const lines = text.split("\n");
  const elements = [];
  let key = 0;

  for (const line of lines) {
    const l = line.trimEnd();
    if (!l) { elements.push(<div key={key++} style={{ height: 8 }} />); continue; }

    if (l.startsWith("### ")) {
      elements.push(<h3 key={key++} style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: "16px 0 6px", borderBottom: "1px solid #f1f5f9", paddingBottom: 4 }}>{l.slice(4)}</h3>);
    } else if (l.startsWith("## ")) {
      elements.push(<h2 key={key++} style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: "20px 0 8px", borderBottom: "1px solid #e2e8f0", paddingBottom: 6 }}>{l.slice(3)}</h2>);
    } else if (l.startsWith("# ")) {
      elements.push(<h1 key={key++} style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: "0 0 16px" }}>{l.slice(2)}</h1>);
    } else if (l.startsWith("- [ ] ") || l.startsWith("- [x] ")) {
      const done = l.startsWith("- [x] ");
      elements.push(
        <div key={key++} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4, fontSize: 14, lineHeight: 1.6, color: "#374151" }}>
          <span style={{ width: 16, height: 16, border: "1.5px solid #d1d5db", borderRadius: 3, flexShrink: 0, marginTop: 3, background: done ? "#a855f7" : "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "white" }}>
            {done ? "✓" : ""}
          </span>
          <span style={{ textDecoration: done ? "line-through" : "none", color: done ? "#94a3b8" : "#374151" }}>{l.slice(6)}</span>
        </div>
      );
    } else if (l.startsWith("- ") || l.startsWith("* ")) {
      elements.push(<div key={key++} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4, fontSize: 14, lineHeight: 1.6, color: "#374151" }}><span style={{ color: "#a855f7", flexShrink: 0, marginTop: 3, fontSize: 10 }}>●</span><span>{l.slice(2)}</span></div>);
    } else if (l.startsWith("  - ") || l.startsWith("  * ")) {
      elements.push(<div key={key++} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 3, fontSize: 13, lineHeight: 1.6, color: "#64748b", paddingLeft: 20 }}><span style={{ color: "#d1d5db", flexShrink: 0, marginTop: 3, fontSize: 8 }}>●</span><span>{l.slice(4)}</span></div>);
    } else {
      elements.push(<p key={key++} style={{ fontSize: 14, lineHeight: 1.7, color: "#374151", margin: "0 0 6px" }}>{l}</p>);
    }
  }

  return <div>{elements}</div>;
}
