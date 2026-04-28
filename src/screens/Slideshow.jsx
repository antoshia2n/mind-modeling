import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthUid, supabase } from "shia2n-core";
import { getMap, getPdfSignedUrl } from "../lib/supabase.js";

/**
 * /slideshow/:nodeId
 * 別タブで開くセミナー用 PDF スライドショー
 * - 矢印キー左右でページ送り
 * - Space → 次ページ
 * - ESC → タブを閉じる
 * - F キー → フルスクリーン
 */

// pdfjs を CDN から動的ロード（npm変更不要）
async function loadPdfjsLib() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdfjs 読み込み失敗"));
    document.head.appendChild(script);
  });
}

function parseNodeId() {
  const p = window.location.pathname;
  const m = p.match(/\/slideshow\/([^/]+)/);
  return m ? m[1] : null;
}

export default function Slideshow() {
  const uid    = useAuthUid();
  const nodeId = parseNodeId();

  const canvasRef     = useRef(null);
  const pdfDocRef     = useRef(null);
  const renderingRef  = useRef(false);
  const hintTimerRef  = useRef(null);

  const [status,      setStatus]      = useState("loading"); // loading | ready | error
  const [errorMsg,    setErrorMsg]    = useState("");
  const [mapTitle,    setMapTitle]    = useState("");
  const [nodeLabel,   setNodeLabel]   = useState("");
  const [pdfFilename, setPdfFilename] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages,  setTotalPages]  = useState(0);
  const [showHints,   setShowHints]   = useState(true);

  // ヒントを3秒後に非表示
  useEffect(() => {
    hintTimerRef.current = setTimeout(() => setShowHints(false), 4000);
    return () => clearTimeout(hintTimerRef.current);
  }, []);

  // PDF ロード
  useEffect(() => {
    if (!uid || !nodeId) return;

    async function init() {
      try {
        // ノード情報を取得
        const { data: nodeData } = await supabase
          .from("mm_nodes").select("*").eq("id", nodeId).single();

        if (!nodeData) { setErrorMsg("ノードが見つかりません。"); setStatus("error"); return; }
        if (!nodeData.pdf_url) { setErrorMsg("このノードには PDF が添付されていません。"); setStatus("error"); return; }

        setNodeLabel(nodeData.content || "Untitled");
        setPdfFilename(nodeData.pdf_filename || "document.pdf");

        // マップタイトル取得
        const map = await getMap(nodeData.map_id);
        setMapTitle(map?.title || "");

        // 署名付き URL 取得
        const signedUrl = await getPdfSignedUrl(nodeData.pdf_url);
        if (!signedUrl) { setErrorMsg("PDF URL の取得に失敗しました。"); setStatus("error"); return; }

        // pdfjs ロード
        const pdfjsLib = await loadPdfjsLib();
        const pdf = await pdfjsLib.getDocument(signedUrl).promise;
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
        setStatus("ready");
        await renderPage(pdf, 1);
      } catch (e) {
        console.error("[Slideshow]", e);
        setErrorMsg("PDF の読み込みに失敗しました。");
        setStatus("error");
      }
    }
    init();
  }, [uid, nodeId]);

  const renderPage = useCallback(async (pdf, pageNum) => {
    if (renderingRef.current || !canvasRef.current) return;
    renderingRef.current = true;
    try {
      const page     = await pdf.getPage(pageNum);
      const canvas   = canvasRef.current;
      const ctx      = canvas.getContext("2d");
      const viewport = page.getViewport({ scale: 1 });

      // 画面に合わせてスケール
      const scaleW   = (window.innerWidth  * 0.94) / viewport.width;
      const scaleH   = (window.innerHeight * 0.92) / viewport.height;
      const scale    = Math.min(scaleW, scaleH);
      const scaled   = page.getViewport({ scale });

      canvas.width  = scaled.width;
      canvas.height = scaled.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      setCurrentPage(pageNum);
    } catch (e) {
      console.error("[Slideshow] renderPage:", e);
    } finally {
      renderingRef.current = false;
    }
  }, []);

  const goNext = useCallback(() => {
    if (!pdfDocRef.current) return;
    setCurrentPage(prev => {
      const next = Math.min(prev + 1, pdfDocRef.current.numPages);
      renderPage(pdfDocRef.current, next);
      return next;
    });
  }, [renderPage]);

  const goPrev = useCallback(() => {
    if (!pdfDocRef.current) return;
    setCurrentPage(prev => {
      const next = Math.max(prev - 1, 1);
      renderPage(pdfDocRef.current, next);
      return next;
    });
  }, [renderPage]);

  // キーボード操作
  useEffect(() => {
    function handleKey(e) {
      if (status !== "ready") return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); goPrev(); }
      if (e.key === "Escape")     { window.close(); }
      if (e.key === "f" || e.key === "F") {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      }
      // キー操作でヒント再表示
      setShowHints(true);
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setShowHints(false), 2500);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [status, goNext, goPrev]);

  // ウィンドウリサイズ時に再レンダリング
  useEffect(() => {
    let timer;
    function handleResize() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (pdfDocRef.current && status === "ready") {
          renderPage(pdfDocRef.current, currentPage);
        }
      }, 200);
    }
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); clearTimeout(timer); };
  }, [status, currentPage, renderPage]);

  const s = {
    wrap: {
      width: "100vw", height: "100vh", background: "#0f0f0f",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
      overflow: "hidden", position: "relative",
      userSelect: "none",
    },
    canvas: { display: "block", boxShadow: "0 8px 40px rgba(0,0,0,0.8)", borderRadius: 2 },
    header: {
      position: "absolute", top: 0, left: 0, right: 0,
      padding: "10px 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
      opacity: showHints ? 1 : 0, transition: "opacity 0.5s",
      pointerEvents: "none",
    },
    headerLeft:  { color: "#fff", fontSize: 13, lineHeight: 1.5 },
    headerRight: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
    footer: {
      position: "absolute", bottom: 0, left: 0, right: 0,
      padding: "14px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
      opacity: showHints ? 1 : 0, transition: "opacity 0.5s",
      pointerEvents: "none",
    },
    pageNum: { color: "#fff", fontSize: 14, fontWeight: 600 },
    hints: { color: "rgba(255,255,255,0.6)", fontSize: 12, display: "flex", gap: 16 },
    hintKey: { background: "rgba(255,255,255,0.15)", borderRadius: 4, padding: "2px 7px", fontFamily: "monospace" },
    center: { color: "#fff", textAlign: "center" },
    loader: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
    errorTitle: { fontSize: 18, fontWeight: 700, marginBottom: 10 },
    errorMsg: { color: "rgba(255,255,255,0.6)", fontSize: 14 },
    closeBtn: { marginTop: 20, background: "#fff", color: "#111", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer" },

    // 左右クリックエリア（タッチ操作対応）
    prevArea: { position: "absolute", left: 0, top: "15%", width: "12%", height: "70%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    nextArea: { position: "absolute", right: 0, top: "15%", width: "12%", height: "70%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
    arrowBtn: (show) => ({
      color: "rgba(255,255,255,0.5)", fontSize: 28, background: "rgba(255,255,255,0.06)",
      borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
      opacity: show ? 1 : 0, transition: "opacity 0.3s",
    }),
  };

  if (status === "loading") {
    return (
      <div style={s.wrap}>
        <div style={s.center}>
          <div style={s.loader}>PDF を読み込んでいます...</div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={s.wrap}>
        <div style={s.center}>
          <div style={s.errorTitle}>⚠️ エラー</div>
          <div style={s.errorMsg}>{errorMsg}</div>
          <button style={s.closeBtn} onClick={() => window.close()}>タブを閉じる</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap} onClick={() => { setShowHints(true); clearTimeout(hintTimerRef.current); hintTimerRef.current = setTimeout(() => setShowHints(false), 2500); }}>
      {/* ヘッダー */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{nodeLabel}</div>
          {mapTitle && <div style={{ opacity: 0.6, fontSize: 12 }}>{mapTitle}</div>}
        </div>
        <div style={s.headerRight}>{pdfFilename}</div>
      </div>

      {/* PDF キャンバス */}
      <canvas ref={canvasRef} style={s.canvas} />

      {/* 左右クリックエリア */}
      <div style={s.prevArea} onClick={e => { e.stopPropagation(); goPrev(); }}>
        <div style={s.arrowBtn(currentPage > 1)}>‹</div>
      </div>
      <div style={s.nextArea} onClick={e => { e.stopPropagation(); goNext(); }}>
        <div style={s.arrowBtn(currentPage < totalPages)}>›</div>
      </div>

      {/* フッター */}
      <div style={s.footer}>
        <div style={s.pageNum}>{currentPage} / {totalPages}</div>
        <div style={s.hints}>
          <span><span style={s.hintKey}>←</span> 前 / <span style={s.hintKey}>→</span> 次</span>
          <span><span style={s.hintKey}>F</span> フルスクリーン</span>
          <span><span style={s.hintKey}>ESC</span> 閉じる</span>
        </div>
      </div>
    </div>
  );
}
