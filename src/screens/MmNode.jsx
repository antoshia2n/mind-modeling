import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const PURPLE = "#a855f7";
const GRAY   = "#d1d5db";
const TEAL   = "#0ea5e9";
const AMBER  = "#f59e0b";

const FOCUS_EVENT = "mm-focus-node";

const URL_RE = /^https?:\/\/[^\s]+$/;
function isUrl(text) { return URL_RE.test(text?.trim() ?? ""); }
function getDomain(url) {
  try { return new URL(url.trim()).hostname.replace(/^www\./, ""); } catch { return url; }
}

export default function MmNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.label ?? "");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(data.label ?? ""); }, [data.label, editing]);

  useEffect(() => {
    const nodeId = data.nodeId;
    if (!nodeId) return;
    function onFocus(e) { if (e.detail?.nodeId === nodeId && !editing) { setEditing(true); data.onEditStart?.(); } }
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [data.nodeId, editing, data.onEditStart]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch (_) {}
      autoResize(inputRef.current);
    }
  }, [editing]);

  function autoResize(el) { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
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
  const isTb         = dir === "down" || data.layoutMode === "tb";
  const isDropTgt    = data.isDropTarget;
  const showCollapse = (hovered || selected) && !editing && data.hasChildren;
  const showActions  = selected && !editing && !isDropTgt;
  const hasPdf       = !!data.pdfUrl;
  const hasMapLink   = !!data.linkedMapId;
  const hasLinkUrl   = !!data.linkUrl;
  const contentIsUrl = isUrl(data.label);

  const textStyle = {
    fontWeight: data.bold ? 700 : undefined, fontStyle: data.italic ? "italic" : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none", color: data.textColor || undefined,
  };

  const handleLR = <>
    <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
    <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    <Handle id="sr" type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
    <Handle id="sl" type="source" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
  </>;
  const handleTB = <>
    <Handle id="tt" type="target" position={Position.Top}    style={{ opacity: 0, pointerEvents: "none" }} />
    <Handle id="sb" type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
  </>;

  // ─── ルートノード ─────────────────────────────────────────
  if (data.isRoot) {
    const bg     = data.nodeColor || "#ffffff";
    const border = isDropTgt ? "2px solid #10b981" : `1.5px solid ${selected ? PURPLE : "#e2e8f0"}`;
    return (
      <div data-nodeid={data.nodeId}
        onDoubleClick={startEdit}
        onMouseDown={e => { if (!editing) data.onDragStart?.(data.nodeId, data.label, e); }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ background: isDropTgt ? "#f0fdf4" : bg, border, borderRadius: 10, padding: "10px 18px", minWidth: 80, maxWidth: editing ? 480 : 300, boxShadow: "0 2px 8px rgba(0,0,0,0.07)", cursor: "default", userSelect: "none", position: "relative" }}>
        {isDropTgt && <DropLabel />}
        {handleLR}
        <Handle id="sl" type="source" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="sr" type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
        {isTb && <Handle id="sb" type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />}
        {showActions && <FormatToolbar data={data} hasPdf={hasPdf} hasLinkUrl={hasLinkUrl} />}
        {editing ? (
          <textarea ref={inputRef} value={draft} onChange={e => { autoResize(e.target); setDraft(e.target.value); }} onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
            style={{ fontSize: 16, fontWeight: data.bold ? 700 : 600, fontStyle: data.italic ? "italic" : "normal", textDecoration: data.strikethrough ? "line-through" : "none", color: data.textColor || "#374151", fontFamily: "inherit", background: "none", border: "none", outline: "none", padding: 0, width: "100%", resize: "none", overflow: "hidden", display: "block" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <NodeLabel label={data.label} urlFlag={contentIsUrl} baseStyle={{ ...textStyle, fontWeight: data.bold ? 700 : 600, color: data.textColor || "#374151", fontSize: 16 }} maxWidth={260} />
            {hasPdf    && <PdfBadge  onClick={e => { e.stopPropagation(); data.onOpenSlideshow?.(); }} />}
            {hasLinkUrl && <LinkBadge url={data.linkUrl} />}
          </div>
        )}
        {showActions && !isTb && <QuickBtn posStyle={{ right: -36, top: "50%", transform: "translateY(-50%)" }} title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>›</QuickBtn>}
        {showActions && isTb  && <QuickBtn posStyle={{ bottom: -36, left: "50%", transform: "translateX(-50%)" }} title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>↓</QuickBtn>}
      </div>
    );
  }

  // ─── 子ノード ─────────────────────────────────────────────
  const hasBg      = !!data.nodeColor;
  const nodeBorder = isDropTgt ? "2px solid #10b981" : (selected ? `1.5px solid rgba(168,85,247,0.6)` : "1.5px solid transparent");
  const nodeBg     = isDropTgt ? "#f0fdf4" : (hasBg ? data.nodeColor : (selected ? "rgba(168,85,247,0.06)" : "transparent"));

  const collapseStyle = isTb
    ? { position: "absolute", bottom: -26, left: "50%", transform: "translateX(-50%)", background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%", width: 18, height: 18, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, color: PURPLE, zIndex: 5 }
    : { position: "absolute", ...(isLeft ? { left: -24 } : { right: -24 }), top: "50%", transform: "translateY(-50%)", background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%", width: 18, height: 18, fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, color: PURPLE, zIndex: 5 };

  const childBtnStyle = (() => {
    if (isTb) return { bottom: data.hasChildren ? -52 : -36, left: "50%", transform: "translateX(-50%)" };
    const base = data.hasChildren ? 52 : 36;
    return isLeft ? { left: -base, top: "50%", transform: "translateY(-50%)" } : { right: -base, top: "50%", transform: "translateY(-50%)" };
  })();

  return (
    <div data-nodeid={data.nodeId}
      onDoubleClick={startEdit}
      onMouseDown={e => { if (!editing) data.onDragStart?.(data.nodeId, data.label, e); }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: hasBg || isDropTgt ? "3px 8px" : "1px 2px", borderRadius: 5, background: nodeBg, border: nodeBorder, cursor: "default", userSelect: "none", boxShadow: isDropTgt ? "0 0 0 3px #10b98140" : "none" }}>
      {isDropTgt && <DropLabel />}
      {handleLR}
      {handleTB}
      {showActions && <FormatToolbar data={data} hasPdf={hasPdf} hasLinkUrl={hasLinkUrl} />}

      {showCollapse && (
        <button title={data.collapsed ? "展開" : "折りたたむ"} onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(); }} style={collapseStyle}>
          {data.collapsed ? (isTb ? "▾" : (isLeft ? "‹" : "›")) : (isTb ? "▴" : (isLeft ? "›" : "‹"))}
        </button>
      )}

      {editing ? (
        <textarea ref={inputRef} value={draft} onChange={e => { autoResize(e.target); setDraft(e.target.value); }} onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
          style={{ fontSize: 14, ...textStyle, fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"), fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", background: "none", border: "none", outline: "none", padding: 0, minWidth: 60, resize: "none", overflow: "hidden" }} />
      ) : (
        <NodeLabel label={data.label} urlFlag={contentIsUrl} baseStyle={{ ...textStyle, fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"), fontSize: 14 }} maxWidth={220} />
      )}

      {hasPdf     && <PdfBadge  onClick={e => { e.stopPropagation(); data.onOpenSlideshow?.(); }} />}
      {hasLinkUrl && <LinkBadge url={data.linkUrl} />}
      {hasMapLink && (
        <span title="リンク先マップを開く" onClick={e => { e.stopPropagation(); data.onNavigateLink?.(); }}
          style={{ fontSize: 10, cursor: "pointer", color: TEAL, flexShrink: 0, fontWeight: 700 }}>↗</span>
      )}

      {showActions && (
        <>
          <QuickBtn posStyle={childBtnStyle} title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>
            {isTb ? "↓" : (isLeft ? "‹" : "›")}
          </QuickBtn>
          {!isTb && <>
            <QuickBtn posStyle={{ top: -32, left: "50%", transform: "translateX(-50%)" }} title="上に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}>↑</QuickBtn>
            <QuickBtn posStyle={{ bottom: -32, left: "50%", transform: "translateX(-50%)" }} title="下に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}>↓</QuickBtn>
          </>}
          {isTb && <>
            <QuickBtn posStyle={{ left: -32, top: "50%", transform: "translateY(-50%)" }} title="左に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}>←</QuickBtn>
            <QuickBtn posStyle={{ right: -32, top: "50%", transform: "translateY(-50%)" }} title="右に兄弟を追加" onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}>→</QuickBtn>
          </>}
        </>
      )}
    </div>
  );
}

// ─── NodeLabel ────────────────────────────────────────────────

function NodeLabel({ label, urlFlag, baseStyle, maxWidth }) {
  const font = { fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", lineHeight: 1.5 };
  if (urlFlag && label) {
    return (
      <a href={label.trim()} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={label.trim()}
        style={{ ...font, ...baseStyle, color: "#3b82f6", textDecoration: "underline", textUnderlineOffset: 2, maxWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", cursor: "pointer" }}>
        {getDomain(label)}
      </a>
    );
  }
  return (
    <span style={{ ...font, ...baseStyle, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth, display: "block" }}>
      {label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>新しいノード</span>}
    </span>
  );
}

function PdfBadge({ onClick }) {
  const [h, setH] = useState(false);
  return (
    <span title="スライドショーで開く" onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0, lineHeight: 1, color: h ? "#fff" : PURPLE, background: h ? PURPLE : "rgba(168,85,247,0.1)", border: `1px solid rgba(168,85,247,0.3)`, borderRadius: 3, padding: "1px 4px", letterSpacing: 0.3, transition: "all 0.1s" }}>
      PDF
    </span>
  );
}

function LinkBadge({ url }) {
  const [h, setH] = useState(false);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={url}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ fontSize: 9, fontWeight: 700, cursor: "pointer", flexShrink: 0, lineHeight: 1, textDecoration: "none", color: h ? "#fff" : AMBER, background: h ? AMBER : "rgba(245,158,11,0.1)", border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 3, padding: "1px 5px", letterSpacing: 0.3, transition: "all 0.1s" }}>
      URL
    </a>
  );
}

function DropLabel() {
  return <div style={{ position: "absolute", top: -22, left: "50%", transform: "translateX(-50%)", background: "#10b981", color: "#fff", borderRadius: 5, padding: "1px 7px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100 }}>ここへ移動</div>;
}

function FormatToolbar({ data, hasPdf, hasLinkUrl }) {
  return (
    <div onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      style={{ position: "absolute", bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)", background: "#1e293b", borderRadius: 10, padding: "5px 8px", display: "flex", alignItems: "center", gap: 2, boxShadow: "0 4px 20px rgba(0,0,0,0.25)", zIndex: 1000, whiteSpace: "nowrap" }}>
      <ToolBtn active={data.bold}          title="太字" onClick={() => data.onToggleBold?.()}><b style={{ fontSize: 12 }}>B</b></ToolBtn>
      <ToolBtn active={data.italic}        title="斜体" onClick={() => data.onToggleItalic?.()}><i style={{ fontSize: 12 }}>I</i></ToolBtn>
      <ToolBtn active={data.strikethrough} title="取り消し線" onClick={() => data.onToggleStrikethrough?.()}><span style={{ textDecoration: "line-through", fontSize: 12 }}>S</span></ToolBtn>
      <Sep />
      <ColorGroup title="文字色" value={data.textColor || "#374151"} hasValue={!!data.textColor}
        indicator={<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}><span style={{ color:"#fff", fontWeight:700, fontSize:12 }}>A</span><div style={{ width:14, height:2, borderRadius:1, background: data.textColor || "#fff" }} /></div>}
        onChange={c => data.onTextColorChange?.(c)} onReset={() => data.onTextColorChange?.(null)} />
      <ColorGroup title="背景色" value={data.nodeColor || "#ffffff"} hasValue={!!data.nodeColor}
        indicator={<div style={{ width:13, height:13, borderRadius:3, background: data.nodeColor || "#e2e8f0", border:"1.5px solid rgba(255,255,255,0.2)" }} />}
        onChange={c => data.onNodeColorChange?.(c)} onReset={() => data.onNodeColorChange?.(null)} />
      <Sep />
      <ToolBtn title="テンプレートを挿入" onClick={() => data.onInsertTemplate?.()}>
        <span style={{ fontSize: 11, color: "#5eead4", fontWeight: 700 }}>+T</span>
      </ToolBtn>
      <ToolBtn active={!!data.linkedMapId} title="別マップにリンク" onClick={() => data.onMapLink?.()}>
        <span style={{ fontSize: 12, color: "#7dd3fc" }}>↗</span>
      </ToolBtn>
      <ToolBtn active={hasLinkUrl} title={hasLinkUrl ? `URL: ${data.linkUrl}` : "URLリンクを設定"} onClick={() => data.onSetLinkUrl?.()}>
        <span style={{ fontSize: 10, fontWeight: 700, color: hasLinkUrl ? AMBER : "#94a3b8" }}>URL</span>
      </ToolBtn>
      <Sep />
      {hasPdf ? <>
        <ToolBtn title="スライドショーで開く" onClick={() => data.onOpenSlideshow?.()}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#c4b5fd" }}>▶ PDF</span>
        </ToolBtn>
        <ToolBtn title="PDF差し替え" onClick={() => data.onUploadPdf?.()}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#fca5a5" }}>± PDF</span>
        </ToolBtn>
        <ToolBtn title="PDF削除" onClick={() => data.onDeletePdf?.()}>
          <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>× PDF</span>
        </ToolBtn>
      </> : (
        <ToolBtn title="PDFを添付" onClick={() => data.onUploadPdf?.()}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>+ PDF</span>
        </ToolBtn>
      )}
    </div>
  );
}

function ToolBtn({ children, active, onClick, title }) {
  const [h, setH] = useState(false);
  return <button title={title} onClick={e => { e.stopPropagation(); onClick(); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ background: active ? "rgba(168,85,247,0.45)" : (h ? "rgba(255,255,255,0.1)" : "transparent"), border:"none", borderRadius:5, color:"#fff", width:32, height:28, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:13 }}>{children}</button>;
}
function Sep() { return <div style={{ width:1, height:16, background:"#334155", margin:"0 2px" }} />; }
function ColorGroup({ title, value, hasValue, indicator, onChange, onReset }) {
  const ref = useRef(null); const [h, setH] = useState(false);
  return <div style={{ display:"flex", alignItems:"center", gap:1 }}>
    <button title={title} onClick={e => { e.stopPropagation(); ref.current?.click(); }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? "rgba(255,255,255,0.1)" : "transparent", border:"none", borderRadius:5, width:32, height:28, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", gap:2 }}>{indicator}</button>
    <input ref={ref} type="color" value={value} onChange={e => onChange(e.target.value)} style={{ position:"absolute", opacity:0, width:0, height:0, pointerEvents:"none" }} />
    {hasValue && <button onClick={e => { e.stopPropagation(); onReset(); }} style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.4)", fontSize:10, width:14, height:14, cursor:"pointer", padding:0 }}>×</button>}
  </div>;
}
function QuickBtn({ children, title, onClick, posStyle }) {
  const [h, setH] = useState(false);
  return <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
    style={{ position:"absolute", ...posStyle, background:"white", border:`1.5px solid ${h ? PURPLE : GRAY}`, borderRadius:"50%", width:22, height:22, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:11, color: h ? PURPLE : "#9ca3af", padding:0, boxShadow:"0 1px 4px rgba(0,0,0,0.1)", zIndex:10 }}>{children}</button>;
}
