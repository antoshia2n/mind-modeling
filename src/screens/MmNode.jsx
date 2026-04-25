import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const PURPLE = "#a855f7";
const GRAY   = "#d1d5db";

export default function MmNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.label ?? "");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(data.label ?? ""); }, [data.label, editing]);
  useEffect(() => {
    if (data.forceEdit && !editing) { setEditing(true); data.onEditStart?.(); }
  }, [data.forceEdit]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    if (e.key === "Escape") { e.stopPropagation(); setDraft(data.label ?? ""); setEditing(false); data.onEditEnd?.(); }
  }

  const showActions = (hovered || selected) && !editing;

  // テキストスタイル（書式適用）
  const textStyle = {
    fontWeight:     data.bold         ? 700    : undefined,
    fontStyle:      data.italic       ? "italic" : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none",
    color:          data.textColor    || undefined,
  };

  // ─── ルートノード ───────────────────────────────────
  if (data.isRoot) {
    const bg = data.nodeColor || "#ffffff";
    return (
      <div
        onDoubleClick={startEdit}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: bg, border: `1.5px solid ${selected ? PURPLE : "#e2e8f0"}`,
          borderRadius: 10, padding: "10px 18px", minWidth: 80, maxWidth: editing ? 480 : 320,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "default",
          userSelect: "none", position: "relative",
        }}
      >
        <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle type="source" position={Position.Right}
          style={data.hasChildren ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, right: -5, opacity: 1, pointerEvents: "none" }
            : { opacity: 0, pointerEvents: "none" }} />

        {selected && !editing && <FormatToolbar data={data} />}

        {editing ? (
          <textarea ref={inputRef} value={draft}
            onChange={e => { autoResizeTA(e.target); setDraft(e.target.value); }}
            onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
            style={{ fontSize: 16, fontWeight: data.bold ? 700 : 600, fontStyle: data.italic ? "italic" : "normal",
              textDecoration: data.strikethrough ? "line-through" : "none", color: data.textColor || "#374151",
              fontFamily: "inherit", background: "none", border: "none", outline: "none", padding: 0,
              width: "100%", resize: "none", overflow: "hidden", display: "block" }} />
        ) : (
          <span style={{ fontSize: 16, lineHeight: 1.5, display: "block", ...textStyle, fontWeight: data.bold ? 700 : 600, color: data.textColor || "#374151" }}>
            {data.label || <span style={{ color: "#9ca3af", fontWeight: 400 }}>新しいノード</span>}
          </span>
        )}

        {showActions && (
          <QuickBtn posStyle={{ right: -36, top: "50%", transform: "translateY(-50%)" }}
            title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>→</QuickBtn>
        )}
      </div>
    );
  }

  // ─── 子ノード ────────────────────────────────────────
  const bg = data.nodeColor ? data.nodeColor : "transparent";
  const hasBg = !!data.nodeColor;

  return (
    <div
      onDoubleClick={startEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center",
        padding: hasBg ? "4px 8px" : "2px 4px", borderRadius: 6,
        background: hasBg ? bg : (selected ? "rgba(168,85,247,0.07)" : "transparent"),
        border: `1.5px solid ${selected ? "rgba(168,85,247,0.4)" : (hasBg ? "transparent" : "transparent")}`,
        cursor: "default", userSelect: "none", maxWidth: editing ? 400 : 240,
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right}
        style={data.hasChildren ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, right: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />

      {selected && !editing && <FormatToolbar data={data} />}

      {data.hasChildren && !editing && (
        <button title={data.collapsed ? "展開 (Cmd+/)" : "折りたたむ (Cmd+/)"}
          onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{
            position: "absolute", right: -26, top: "50%", transform: "translateY(-50%)",
            background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%",
            width: 18, height: 18, fontSize: 7, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, color: PURPLE,
          }}
        >{data.collapsed ? "▶" : "◀"}</button>
      )}

      {editing ? (
        <textarea ref={inputRef} value={draft}
          onChange={e => { autoResizeTA(e.target); setDraft(e.target.value); }}
          onBlur={commitEdit} onKeyDown={handleKeyDown} rows={1}
          style={{ fontSize: 14, ...textStyle, fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"),
            fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
            background: "none", border: "none", outline: "none", padding: 0, minWidth: 60,
            resize: "none", overflow: "hidden" }} />
      ) : (
        <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "nowrap", ...textStyle,
          fontWeight: data.bold ? 700 : 500, color: data.textColor || (T.fg ?? "#374151"),
          fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif" }}>
          {data.label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>新しいノード</span>}
        </span>
      )}

      {showActions && (
        <>
          <QuickBtn posStyle={{ right: data.hasChildren ? -50 : -36, top: "50%", transform: "translateY(-50%)" }}
            title="子ノードを追加 (Tab)" onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>→</QuickBtn>
          <QuickBtn posStyle={{ top: -30, left: "50%", transform: "translateX(-50%)" }}
            title="上に兄弟を追加 (⌘+Enter)" onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}>↑</QuickBtn>
          <QuickBtn posStyle={{ bottom: -30, left: "50%", transform: "translateX(-50%)" }}
            title="下に兄弟を追加 (Enter)" onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}>↓</QuickBtn>
        </>
      )}
    </div>
  );
}

// ─── Whimsical 風フォーマットツールバー ──────────────────

function FormatToolbar({ data }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: "absolute",
        bottom: "calc(100% + 10px)",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1f2937",
        borderRadius: 10,
        padding: "5px 8px",
        display: "flex",
        alignItems: "center",
        gap: 2,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 1000,
        whiteSpace: "nowrap",
      }}
    >
      {/* 太字 */}
      <ToolBtn active={data.bold} title="太字 (⌘B)" onClick={() => data.onToggleBold?.()}>
        <b>B</b>
      </ToolBtn>
      {/* 斜体 */}
      <ToolBtn active={data.italic} title="斜体 (⌘I)" onClick={() => data.onToggleItalic?.()}>
        <i>I</i>
      </ToolBtn>
      {/* 取り消し線 */}
      <ToolBtn active={data.strikethrough} title="取り消し線" onClick={() => data.onToggleStrikethrough?.()}>
        <span style={{ textDecoration: "line-through" }}>S</span>
      </ToolBtn>

      <Sep />

      {/* 文字色 */}
      <ColorBtn
        title="文字色"
        value={data.textColor || "#374151"}
        indicator={<span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>A</span>}
        indicatorUnder={data.textColor}
        onChange={c => data.onTextColorChange?.(c)}
        onReset={() => data.onTextColorChange?.(null)}
      />

      {/* ノード背景色 */}
      <ColorBtn
        title="ノード背景色"
        value={data.nodeColor || "#ffffff"}
        indicator={
          <div style={{
            width: 14, height: 14, borderRadius: 3,
            background: data.nodeColor || "#e5e7eb",
            border: "1.5px solid rgba(255,255,255,0.3)",
          }} />
        }
        onChange={c => data.onNodeColorChange?.(c)}
        onReset={() => data.onNodeColorChange?.(null)}
      />
    </div>
  );
}

function ToolBtn({ children, active, onClick, title }) {
  const [h, setH] = useState(false);
  return (
    <button title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: active ? "rgba(168,85,247,0.5)" : (h ? "rgba(255,255,255,0.1)" : "transparent"),
        border: "none", borderRadius: 5, color: "#fff",
        width: 30, height: 30, display: "flex", alignItems: "center",
        justifyContent: "center", cursor: "pointer", fontSize: 13,
      }}
    >{children}</button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 18, background: "#374151", margin: "0 4px" }} />;
}

function ColorBtn({ title, value, indicator, indicatorUnder, onChange, onReset }) {
  const inputRef = useRef(null);
  return (
    <div title={title} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer" }}>
      <button
        onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
        style={{
          background: "transparent", border: "none",
          width: 30, height: 30, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 2,
        }}
      >
        {indicator}
        {indicatorUnder !== undefined && (
          <div style={{ width: 14, height: 3, borderRadius: 1, background: indicatorUnder || "#ffffff" }} />
        )}
      </button>
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

// ─── クイックアクションボタン ────────────────────────────

function QuickBtn({ children, title, onClick, posStyle }) {
  const [h, setH] = useState(false);
  return (
    <button title={title} onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        position: "absolute", ...posStyle,
        background: "white", border: `1.5px solid ${h ? PURPLE : GRAY}`, borderRadius: "50%",
        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 11, color: h ? PURPLE : "#9ca3af",
        padding: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.12)", zIndex: 10,
      }}
    >{children}</button>
  );
}
