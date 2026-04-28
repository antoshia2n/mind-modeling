import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const PURPLE = "#a855f7";
const GRAY   = "#d1d5db";
const TEAL   = "#0ea5e9";
const PDF_COLOR = "#ef4444"; // PDF アイコンの赤

const FOCUS_EVENT = "mm-focus-node";

/**
 * MmNode - PDF 機能追加版
 *
 * data に追加されたプロパティ：
 *   pdfUrl      - Storage パス（あれば添付済み）
 *   pdfFilename - 表示用ファイル名
 *   onUploadPdf()       - PDF アップロードトリガー
 *   onDeletePdf()       - PDF 削除
 *   onOpenSlideshow()   - スライドショーを別タブで開く
 */
export default function MmNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.label ?? "");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(data.label ?? ""); }, [data.label, editing]);

  useEffect(() => {
    const nodeId = data.nodeId;
    if (!nodeId) return;
    function handleFocusEvent(e) {
      if (e.detail?.nodeId === nodeId && !editing) { setEditing(true); data.onEditStart?.(); }
    }
    window.addEventListener(FOCUS_EVENT, handleFocusEvent);
    return () => window.removeEventListener(FOCUS_EVENT, handleFocusEvent);
  }, [data.nodeId, editing, data.onEditStart]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch (_) {}
      autoResizeTA(inputRef.current);
    }
  }, [editing]);

  function autoResizeTA(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }
  function startEdit() { if (!editing) { setEditing(true); data.onEditStart?.(); } }
  function commitEdit() {
    setEditing(false); data.onEditEnd?.();
    const t = draft.trim();
    if (t !== (data.label ?? "")) data.onContentChange?.(t);
  }
  function handleKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); commitEdit(); return; }
    if (e.key === "Escape") { e.stopPropagation(); setDraft(data.label ?? ""); setEditing(false); data.onEditEnd?.(); }
  }

  const dir          = data.direction ?? "right";
  const isLeft       = dir === "left";
  const isDropTarget = data.isDropTarget;
  const showCollapse = (hovered || selected) && !editing && data.hasChildren;
  const showActions  = selected && !editing && !isDropTarget;
  const hasPdf       = !!data.pdfUrl;

  const textStyle = {
    fontWeight:     data.bold          ? 700      : undefined,
    fontStyle:      data.italic        ? "italic" : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none",
    color:          data.textColor     || undefined,
  };

  // ─── ルートノード ─────────────────────────────────────────
  if (data.isRoot) {
    const bg     = data.nodeColor || "#ffffff";
    const border = isDropTarget ? "2px solid #10b981" : `1.5px solid ${selected ? PURPLE : "#e2e8f0"}`;
    return (
      <div onDoubleClick={startEdit} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ background: isDropTarget ? "#f0fdf4" : bg, border, borderRadius: 10, padding: "10px 18px", minWidth: 80, maxWidth: editing ? 480 : 320, boxShadow: isDropTarget ? "0 0 0 3px #10b98140" : "0 1px 4px rgba(0,0,0,0.08)", cursor: "default", userSelect: "none", position: "relative", transition: "border 0.1s" }}>
        {isDropTarget && <DropLabel />}
        <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="sl" type="source" position={Position.Left}  style={data.hasLeftChildren  ? dotStyle(-5)      : { opacity: 0, pointerEvents: "none" }} />
        <Handle id="sr" type="source" position={Position.Right} style={data.hasRightChildren ? dotStyle(-5, true): { opacity: 0, pointerEvents: "none" }} />
        {showActions && <FormatToolbar data={data} hasPdf={hasPdf} />}
        {editing ? (
          <textarea ref={inputRef} value={draft} onChange={e => { autoResizeTA(e.target); setDraft(e.target.value); }} onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
            style={{ fontSize: 16, fontWeight: data.bold ? 700 : 600, fontStyle: data.italic ? "italic" : "normal", textDecoration: data.strikethrough ? "line-through" : "none", color: data.textColor || "#374151", fontFamily: "inherit", background: "none", border: "none", outline: "none", padding: 0, width: "100%", resize: "none", overflow: "hidden", display: "block" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1.5, ...textStyle, fontWeight: data.bold ? 700 : 600, color: data.textColor || "#374151" }}>
              {data.label || <span style={{ color: "#9ca3af", fontWeight: 400 }}>新しいノード</span>}
            </span>
            {hasPdf && <PdfBadge onClick={e => { e.stopPropagation(); data.onOpenSlideshow?.(); }} />}
          </div>
        )}
        {showActions && <QuickBtn posStyle={{ right: -36, top: "50%", transform: "translateY(-50%)" }} title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>→</QuickBtn>}
      </div>
    );
  }

  // ─── 子ノード ─────────────────────────────────────────────
  const hasBg      = !!data.nodeColor;
  const hasLink    = !!data.linkedMapId;
  const nodeBorder = isDropTarget ? "2px solid #10b981" : (selected ? `1.5px solid rgba(168,85,247,0.6)` : "1.5px solid transparent");
  const nodeBg     = isDropTarget ? "#f0fdf4" : (hasBg ? data.nodeColor : (selected ? "rgba(168,85,247,0.07)" : "transparent"));
  const collapseOffset = isLeft ? { left: -26 } : { right: -26 };
  const childBtnOffset = (() => {
    const base = data.hasChildren ? 52 : 36;
    return isLeft ? { left: -base, top: "50%", transform: "translateY(-50%)" } : { right: -base, top: "50%", transform: "translateY(-50%)" };
  })();

  return (
    <div onDoubleClick={startEdit} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, padding: hasBg || isDropTarget ? "4px 8px" : "2px 4px", borderRadius: 6, background: nodeBg, border: nodeBorder, cursor: "default", userSelect: "none", maxWidth: editing ? 400 : 280, boxShadow: isDropTarget ? "0 0 0 3px #10b98140" : "none", transition: "border 0.1s" }}>
      {isDropTarget && <DropLabel />}
      <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="sr" type="source" position={Position.Right} style={!isLeft && data.hasChildren ? dotStyle(-4.5) : { opacity: 0, pointerEvents: "none" }} />
      <Handle id="sl" type="source" position={Position.Left}  style={isLeft && data.hasChildren ? dotStyle(-4.5)  : { opacity: 0, pointerEvents: "none" }} />

      {showActions && <FormatToolbar data={data} hasPdf={hasPdf} isLeft={isLeft} />}

      {/* 折りたたみ */}
      {showCollapse && (
        <button title={data.collapsed ? "展開" : "折りたたむ"} onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{ position: "absolute", ...collapseOffset, top: "50%", transform: "translateY(-50%)", background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%", width: 18, height: 18, fontSize: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, color: PURPLE, zIndex: 5 }}>
          {data.collapsed ? (isLeft ? "◀" : "▶") : (isLeft ? "▶" : "◀")}
        </button>
      )}

      {editing ? (
        <textarea ref={inputRef} value={draft} onChange={e => { autoResizeTA(e.target); setDraft(e.target.value); }} onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
          style={{ fontSize: 14, ...textStyle, fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"), fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", background: "none", border: "none", outline: "none", padding: 0, minWidth: 60, resize: "none", overflow: "hidden" }} />
      ) : (
        <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "nowrap", ...textStyle, fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"), fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" }}>
          {data.label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>新しいノード</span>}
        </span>
      )}

      {/* PDF バッジ（添付済みの場合） */}
      {hasPdf && <PdfBadge onClick={e => { e.stopPropagation(); data.onOpenSlideshow?.(); }} />}

      {/* マップリンクアイコン */}
      {hasLink && (
        <span title="リンク先マップを開く" onClick={e => { e.stopPropagation(); data.onNavigateLink?.(); }}
          style={{ fontSize: 11, cursor: "pointer", color: TEAL, flexShrink: 0, lineHeight: 1 }}>🔗</span>
      )}

      {/* クイックアクション（選択中のみ） */}
      {showActions && (
        <>
          <QuickBtn posStyle={childBtnOffset} title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>
            {isLeft ? "←" : "→"}
          </QuickBtn>
          <QuickBtn posStyle={{ top: -34, left: "50%", transform: "translateX(-50%)" }} title="上に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}>↑</QuickBtn>
          <QuickBtn posStyle={{ bottom: -34, left: "50%", transform: "translateX(-50%)" }} title="下に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}>↓</QuickBtn>
        </>
      )}
    </div>
  );
}

// ─── PDF バッジ ───────────────────────────────────────────

function PdfBadge({ onClick }) {
  const [h, setH] = useState(false);
  return (
    <span
      title="スライドショーで開く"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{ fontSize: 12, cursor: "pointer", flexShrink: 0, lineHeight: 1, opacity: h ? 1 : 0.8, transition: "opacity 0.15s" }}
    >📄</span>
  );
}

// ─── ドロップラベル ──────────────────────────────────────

function DropLabel() {
  return <div style={{ position: "absolute", top: -24, left: "50%", transform: "translateX(-50%)", background: "#10b981", color: "#fff", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100, fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" }}>ここに移動</div>;
}

function dotStyle(offset, isRight = false) {
  return { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, ...(isRight ? { right: offset } : { left: offset }), opacity: 1, pointerEvents: "none" };
}

// ─── フォーマットツールバー（PDF ボタン追加）──────────────

function FormatToolbar({ data, hasPdf }) {
  return (
    <div onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      style={{ position: "absolute", bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)", background: "#1f2937", borderRadius: 10, padding: "5px 8px", display: "flex", alignItems: "center", gap: 2, boxShadow: "0 4px 16px rgba(0,0,0,0.3)", zIndex: 1000, whiteSpace: "nowrap" }}>
      <ToolBtn active={data.bold}          title="太字 (⌘B)"  onClick={() => data.onToggleBold?.()}><b>B</b></ToolBtn>
      <ToolBtn active={data.italic}        title="斜体 (⌘I)"  onClick={() => data.onToggleItalic?.()}><i>I</i></ToolBtn>
      <ToolBtn active={data.strikethrough} title="取り消し線" onClick={() => data.onToggleStrikethrough?.()}><span style={{ textDecoration: "line-through" }}>S</span></ToolBtn>
      <Sep />
      <ColorGroup title="文字色" value={data.textColor || "#374151"} hasValue={!!data.textColor}
        indicator={<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}><span style={{ color:"#fff", fontWeight:700, fontSize:13, lineHeight:1 }}>A</span><div style={{ width:14, height:3, borderRadius:1, background: data.textColor || "#fff" }} /></div>}
        onChange={c => data.onTextColorChange?.(c)} onReset={() => data.onTextColorChange?.(null)} />
      <ColorGroup title="ノード背景色" value={data.nodeColor || "#ffffff"} hasValue={!!data.nodeColor}
        indicator={<div style={{ width:14, height:14, borderRadius:3, background: data.nodeColor || "#e5e7eb", border:"1.5px solid rgba(255,255,255,0.3)" }} />}
        onChange={c => data.onNodeColorChange?.(c)} onReset={() => data.onNodeColorChange?.(null)} />
      <Sep />
      {/* テンプレ・マップリンク */}
      <ToolBtn title="テンプレートを挿入" onClick={() => data.onInsertTemplate?.()}>
        <span style={{ fontSize:11, color:"#5eead4" }}>⊕</span>
      </ToolBtn>
      <ToolBtn active={!!data.linkedMapId} title={data.linkedMapId ? "マップリンクを変更/解除" : "マップリンクを設定"} onClick={() => data.onMapLink?.()}>
        <span style={{ fontSize:11 }}>🔗</span>
      </ToolBtn>
      <Sep />
      {/* PDF 操作 */}
      {hasPdf ? (
        <>
          <ToolBtn title="スライドショーで開く" onClick={() => data.onOpenSlideshow?.()}>
            <span style={{ fontSize:12 }}>▶</span>
          </ToolBtn>
          <ToolBtn title="PDF を差し替える" onClick={() => data.onUploadPdf?.()}>
            <span style={{ fontSize:11, color:"#fca5a5" }}>📄</span>
          </ToolBtn>
          <ToolBtn title="PDF を削除" onClick={() => data.onDeletePdf?.()}>
            <span style={{ fontSize:10, color:"#ef4444" }}>✕</span>
          </ToolBtn>
        </>
      ) : (
        <ToolBtn title="PDF を添付してスライドショーで使う" onClick={() => data.onUploadPdf?.()}>
          <span style={{ fontSize:11 }}>📎</span>
        </ToolBtn>
      )}
    </div>
  );
}

function ToolBtn({ children, active, onClick, title }) {
  const [h, setH] = useState(false);
  return <button title={title} onClick={e => { e.stopPropagation(); onClick(); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ background: active ? "rgba(168,85,247,0.5)" : (h ? "rgba(255,255,255,0.1)" : "transparent"), border:"none", borderRadius:5, color:"#fff", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:13 }}>{children}</button>;
}
function Sep() { return <div style={{ width:1, height:18, background:"#374151", margin:"0 3px" }} />; }
function ColorGroup({ title, value, hasValue, indicator, onChange, onReset }) {
  const inputRef = useRef(null);
  const [h, setH] = useState(false);
  return <div style={{ display:"flex", alignItems:"center", gap:1 }}>
    <button title={title} onClick={e => { e.stopPropagation(); inputRef.current?.click(); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? "rgba(255,255,255,0.1)" : "transparent", border:"none", borderRadius:5, width:30, height:30, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", gap:2 }}>{indicator}</button>
    <input ref={inputRef} type="color" value={value} onChange={e => onChange(e.target.value)} style={{ position:"absolute", opacity:0, width:0, height:0, pointerEvents:"none" }} />
    {hasValue && <button title={`${title}をリセット`} onClick={e => { e.stopPropagation(); onReset(); }} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.5)", fontSize:10, width:16, height:16, cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:3 }}>✕</button>}
  </div>;
}
function QuickBtn({ children, title, onClick, posStyle }) {
  const [h, setH] = useState(false);
  return <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ position:"absolute", ...posStyle, background:"white", border:`1.5px solid ${h ? PURPLE : GRAY}`, borderRadius:"50%", width:24, height:24, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:11, color: h ? PURPLE : "#9ca3af", padding:0, boxShadow:"0 1px 4px rgba(0,0,0,0.12)", zIndex:10 }}>{children}</button>;
}
