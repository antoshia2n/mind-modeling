import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const PURPLE = "#a855f7";
const GRAY   = "#d1d5db";

/**
 * Whimsical 風マインドマップノード
 *
 * ホバー時に3つのクイックアクションボタンが表示される：
 *   右  → 子ノードを追加
 *   上  → 上に兄弟を追加（ルート以外）
 *   下  → 下に兄弟を追加（ルート以外）
 *
 * data で受け取るもの:
 *   label / collapsed / hasChildren / isRoot / forceEdit
 *   onContentChange / onToggleCollapse / onEditStart / onEditEnd
 *   onAddChild / onAddSiblingAbove / onAddSiblingBelow
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
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  function startEdit() { if (!editing) { setEditing(true); data.onEditStart?.(); } }
  function commitEdit() {
    setEditing(false); data.onEditEnd?.();
    const trimmed = draft.trim();
    if (trimmed !== (data.label ?? "")) data.onContentChange?.(trimmed);
  }
  function handleKeyDown(e) {
    if (e.key === "Enter"  && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); commitEdit(); }
    if (e.key === "Escape")                { e.stopPropagation(); setDraft(data.label ?? ""); setEditing(false); data.onEditEnd?.(); }
  }

  // クイックアクションボタンを表示するか（ホバー中 or 選択中、かつ編集していない）
  const showActions = (hovered || selected) && !editing;

  // ── ルートノード ──────────────────────────────────────
  if (data.isRoot) {
    return (
      <div
        onDoubleClick={startEdit}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: "#ffffff",
          border: `1.5px solid ${selected ? PURPLE : "#e2e8f0"}`,
          borderRadius: 10,
          padding: "10px 18px",
          minWidth: 80, maxWidth: 320,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          cursor: "default", userSelect: "none",
          position: "relative",
        }}
      >
        <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle
          type="source" position={Position.Right}
          style={data.hasChildren ? {
            background: "#fff", border: `2px solid ${PURPLE}`,
            width: 10, height: 10, right: -5, opacity: 1, pointerEvents: "none",
          } : { opacity: 0, pointerEvents: "none" }}
        />

        {editing ? (
          <input ref={inputRef} value={draft}
            onChange={e => setDraft(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
            style={{ fontSize: 16, fontWeight: 600, color: "#374151",
              fontFamily: "inherit", background: "none", border: "none", outline: "none", padding: 0, width: "100%" }}
          />
        ) : (
          <span style={{ fontSize: 16, fontWeight: 600, color: "#374151",
            fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif", lineHeight: 1.5, display: "block" }}>
            {data.label || <span style={{ color: "#9ca3af", fontWeight: 400 }}>新しいノード</span>}
          </span>
        )}

        {/* ルートノードは子追加のみ */}
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

  // ── 子ノード：枠なし・背景なし ───────────────────────
  return (
    <div
      onDoubleClick={startEdit}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center",
        padding: "2px 4px", borderRadius: 4,
        background: selected ? "rgba(168,85,247,0.07)" : "transparent",
        border: `1.5px solid ${selected ? "rgba(168,85,247,0.4)" : "transparent"}`,
        cursor: "default", userSelect: "none", maxWidth: 240,
        transition: "background 0.1s",
      }}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle
        type="source" position={Position.Right}
        style={data.hasChildren ? {
          background: "#fff", border: `2px solid ${PURPLE}`,
          width: 9, height: 9, right: -4.5, opacity: 1, pointerEvents: "none",
        } : { opacity: 0, pointerEvents: "none" }}
      />

      {/* 折りたたみボタン（子があるノードのみ） */}
      {data.hasChildren && !editing && (
        <button
          title={data.collapsed ? "展開 (Cmd+/)" : "折りたたむ (Cmd+/)"}
          onClick={e => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{
            position: "absolute", right: -26, top: "50%", transform: "translateY(-50%)",
            background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%",
            width: 18, height: 18, fontSize: 7, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, color: PURPLE, boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          {data.collapsed ? "▶" : "◀"}
        </button>
      )}

      {/* テキスト or 編集インプット */}
      {editing ? (
        <input ref={inputRef} value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commitEdit} onKeyDown={handleKeyDown}
          size={Math.max(4, draft.length + 1)}
          style={{ fontSize: 14, fontWeight: 500, color: T.fg ?? "#374151",
            fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
            background: "none", border: "none", outline: "none", padding: 0, minWidth: 40 }}
        />
      ) : (
        <span style={{ fontSize: 14, fontWeight: 500, color: T.fg ?? "#374151",
          fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
          lineHeight: 1.5, whiteSpace: "nowrap" }}>
          {data.label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>新しいノード</span>}
        </span>
      )}

      {/* クイックアクションボタン（ホバー or 選択中） */}
      {showActions && (
        <>
          {/* 右：子ノード追加 */}
          <QuickBtn
            posStyle={{ right: data.hasChildren ? -50 : -36, top: "50%", transform: "translateY(-50%)" }}
            title="子ノードを追加 (Tab)"
            onClick={e => { e.stopPropagation(); data.onAddChild?.(); }}
          >→</QuickBtn>

          {/* 上：上に兄弟追加 */}
          <QuickBtn
            posStyle={{ top: -30, left: "50%", transform: "translateX(-50%)" }}
            title="上に兄弟を追加 (⌘+Enter)"
            onClick={e => { e.stopPropagation(); data.onAddSiblingAbove?.(); }}
          >↑</QuickBtn>

          {/* 下：下に兄弟追加 */}
          <QuickBtn
            posStyle={{ bottom: -30, left: "50%", transform: "translateX(-50%)" }}
            title="下に兄弟を追加 (Enter)"
            onClick={e => { e.stopPropagation(); data.onAddSiblingBelow?.(); }}
          >↓</QuickBtn>
        </>
      )}
    </div>
  );
}

// ── クイックアクションボタン共通コンポーネント ──────────

function QuickBtn({ children, title, onClick, posStyle }) {
  const [h, setH] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        position: "absolute",
        ...posStyle,
        background: "white",
        border: `1.5px solid ${h ? PURPLE : GRAY}`,
        borderRadius: "50%",
        width: 24, height: 24,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 11,
        color: h ? PURPLE : "#9ca3af",
        padding: 0,
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        transition: "all 0.1s",
        zIndex: 10,
      }}
    >
      {children}
    </button>
  );
}
