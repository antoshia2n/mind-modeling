import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const PURPLE = "#a855f7";
const GRAY   = "#d1d5db";
const TEAL   = "#0ea5e9";

/**
 * MmNode 表示ルール（整理版）：
 *
 * ホバー時     → 折りたたみボタンのみ（hasChildren の場合）
 * 選択時       → フォーマットツールバー（上部）+ 子追加・兄弟上下ボタン
 * ツールバー内 → B/I/S | 文字色/背景色 | テンプレ挿入/マップリンク
 */
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    if (e.key === "Escape") { e.stopPropagation(); setDraft(data.label ?? ""); setEditing(false); data.onEditEnd?.(); }
  }

  const dir    = data.direction ?? "right";
  const isLeft = dir === "left";

  // 折りたたみ：ホバー or 選択中（頻用操作）
  const showCollapse = (hovered || selected) && !editing && data.hasChildren;
  // 子追加・兄弟ボタン：選択中のみ
  const showActions  = selected && !editing;

  const textStyle = {
    fontWeight:     data.bold          ? 700      : undefined,
    fontStyle:      data.italic        ? "italic" : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none",
    color:          data.textColor     || undefined,
  };

  // ─── ルートノード ────────────────────────────────────────
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
        <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="sl" type="source" position={Position.Left}
          style={data.hasLeftChildren
            ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, left: -5, opacity: 1, pointerEvents: "none" }
            : { opacity: 0, pointerEvents: "none" }} />
        <Handle id="sr" type="source" position={Position.Right}
          style={data.hasRightChildren
            ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, right: -5, opacity: 1, pointerEvents: "none" }
            : { opacity: 0, pointerEvents: "none" }} />

        {/* フォーマットツールバー（選択中のみ） */}
        {showActions && <FormatToolbar data={data} isRoot />}

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

        {/* ルートは右方向の子追加ボタンのみ */}
        {showActions && (
          <QuickBtn
            posStyle={{ right: -36, top: "50%", transform: "translateY(-50%)" }}
            title="子ノードを追加 (Tab)"
            onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}
          >→</QuickBtn>
        )}
      </div>
    );
  }

  // ─── 子ノード ─────────────────────────────────────────────
  const hasBg   = !!data.nodeColor;
  const hasLink = !!data.linkedMapId;

  // 折りたたみボタンの位置：左展開→左端、右展開→右端
  const collapseOffset = (() => {
    // 他のボタンと重ならないよう、子追加ボタンの外側に配置
    const base = 26;
    return isLeft ? { left: -base } : { right: -base };
  })();

  // 子追加ボタンのオフセット（折りたたみボタンとの干渉を避ける）
  const childBtnOffset = (() => {
    const base = data.hasChildren ? 52 : 36;
    return isLeft ? { left: -base, top: "50%", transform: "translateY(-50%)" }
                  : { right: -base, top: "50%", transform: "translateY(-50%)" };
  })();

  return (
    <div
      onDoubleClick={startEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", gap: 4,
        padding: hasBg ? "4px 8px" : "2px 4px", borderRadius: 6,
        background: hasBg ? data.nodeColor : (selected ? "rgba(168,85,247,0.07)" : "transparent"),
        border: `1.5px solid ${selected ? "rgba(168,85,247,0.4)" : "transparent"}`,
        cursor: "default", userSelect: "none", maxWidth: editing ? 400 : 260,
      }}
    >
      <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="sr" type="source" position={Position.Right}
        style={!isLeft && data.hasChildren
          ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, right: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />
      <Handle id="sl" type="source" position={Position.Left}
        style={isLeft && data.hasChildren
          ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, left: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />

      {/* フォーマットツールバー（選択中のみ、上部に表示） */}
      {showActions && <FormatToolbar data={data} isLeft={isLeft} />}

      {/* 折りたたみトグル（ホバー or 選択中） */}
      {showCollapse && (
        <button
          title={data.collapsed ? "展開 (Cmd+/)" : "折りたたむ (Cmd+/)"}
          onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{
            position: "absolute", ...collapseOffset, top: "50%", transform: "translateY(-50%)",
            background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%",
            width: 18, height: 18, fontSize: 7, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, color: PURPLE, zIndex: 5,
          }}
        >
          {data.collapsed ? (isLeft ? "◀" : "▶") : (isLeft ? "▶" : "◀")}
        </button>
      )}

      {/* テキスト表示 or 編集 */}
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

      {/* マップリンクアイコン（常時表示、クリックで遷移） */}
      {hasLink && (
        <span
          title="リンク先マップを開く"
          onClick={e => { e.stopPropagation(); data.onNavigateLink?.(); }}
          style={{ fontSize: 11, cursor: "pointer", color: TEAL, flexShrink: 0, lineHeight: 1 }}
        >🔗</span>
      )}

      {/* 操作ボタン群（選択中のみ） */}
      {showActions && (
        <>
          {/* 子追加（向きに応じて左右） */}
          <QuickBtn posStyle={childBtnOffset} title={`子ノードを追加 (Tab)`} onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}>
            {isLeft ? "←" : "→"}
          </QuickBtn>

          {/* 上に兄弟追加 */}
          <QuickBtn posStyle={{ top: -34, left: "50%", transform: "translateX(-50%)" }}
            title="上に兄弟を追加 (⌘+Enter)" onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}>↑</QuickBtn>

          {/* 下に兄弟追加 */}
          <QuickBtn posStyle={{ bottom: -34, left: "50%", transform: "translateX(-50%)" }}
            title="下に兄弟を追加 (Enter)" onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}>↓</QuickBtn>
        </>
      )}
    </div>
  );
}

// ─── フォーマットツールバー（B/I/S + 色 + テンプレ + リンク）────

function FormatToolbar({ data, isLeft, isRoot }) {
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
      {/* 書式 */}
      <ToolBtn active={data.bold}          title="太字 (⌘B)"  onClick={() => data.onToggleBold?.()}><b>B</b></ToolBtn>
      <ToolBtn active={data.italic}        title="斜体 (⌘I)"  onClick={() => data.onToggleItalic?.()}><i>I</i></ToolBtn>
      <ToolBtn active={data.strikethrough} title="取り消し線" onClick={() => data.onToggleStrikethrough?.()}>
        <span style={{ textDecoration: "line-through" }}>S</span>
      </ToolBtn>

      <Sep />

      {/* 色 */}
      <ColorGroup
        title="文字色" value={data.textColor || "#374151"} hasValue={!!data.textColor}
        indicator={<div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ color:"#fff", fontWeight:700, fontSize:13, lineHeight:1 }}>A</span>
          <div style={{ width:14, height:3, borderRadius:1, background: data.textColor || "#fff" }} />
        </div>}
        onChange={c => data.onTextColorChange?.(c)} onReset={() => data.onTextColorChange?.(null)} />
      <ColorGroup
        title="ノード背景色" value={data.nodeColor || "#ffffff"} hasValue={!!data.nodeColor}
        indicator={<div style={{ width:14, height:14, borderRadius:3, background: data.nodeColor || "#e5e7eb", border:"1.5px solid rgba(255,255,255,0.3)" }} />}
        onChange={c => data.onNodeColorChange?.(c)} onReset={() => data.onNodeColorChange?.(null)} />

      <Sep />

      {/* テンプレート挿入（ツールバーに統合） */}
      <ToolBtn title="テンプレートを挿入" onClick={() => data.onInsertTemplate?.()}>
        <span style={{ fontSize: 11, color: "#5eead4" }}>⊕</span>
      </ToolBtn>

      {/* マップリンク（ツールバーに統合） */}
      <ToolBtn
        active={!!data.linkedMapId}
        title={data.linkedMapId ? "マップリンクを変更/解除" : "マップリンクを設定"}
        onClick={() => data.onMapLink?.()}>
        <span style={{ fontSize: 11 }}>🔗</span>
      </ToolBtn>
    </div>
  );
}

// ─── 共通UIコンポーネント ─────────────────────────────────────

function ToolBtn({ children, active, onClick, title }) {
  const [h, setH] = useState(false);
  return (
    <button title={title} onClick={e => { e.stopPropagation(); onClick(); }}
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
  return <div style={{ width: 1, height: 18, background: "#374151", margin: "0 3px" }} />;
}

function ColorGroup({ title, value, hasValue, indicator, onChange, onReset }) {
  const inputRef = useRef(null);
  const [h, setH] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
      <button title={title}
        onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
        onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{ background: h ? "rgba(255,255,255,0.1)" : "transparent", border: "none", borderRadius: 5, width: 30, height: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 2 }}
      >{indicator}</button>
      <input ref={inputRef} type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }} />
      {hasValue && (
        <button title={`${title}をリセット`}
          onClick={e => { e.stopPropagation(); onReset(); }}
          style={{ background:"transparent", border:"none", color:"rgba(255,255,255,0.5)", fontSize:10, width:16, height:16, cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:3 }}
        >✕</button>
      )}
    </div>
  );
}

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
