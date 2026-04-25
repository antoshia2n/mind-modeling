import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

/**
 * Whimsical 風マインドマップノード
 * - 枠なし・背景なし（テキスト直接表示）
 * - 選択時のみ薄い背景ハイライト
 * - エッジはノードの左右端からダイレクトに出る
 */
export default function MmNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.label ?? "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(data.label ?? "");
  }, [data.label, editing]);

  useEffect(() => {
    if (data.forceEdit && !editing) {
      setEditing(true);
      data.onEditStart?.();
    }
  }, [data.forceEdit]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEdit() {
    if (!editing) {
      setEditing(true);
      data.onEditStart?.();
    }
  }

  function commitEdit() {
    setEditing(false);
    data.onEditEnd?.();
    const trimmed = draft.trim();
    if (trimmed !== (data.label ?? "")) data.onContentChange?.(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      commitEdit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      setDraft(data.label ?? "");
      setEditing(false);
      data.onEditEnd?.();
    }
  }

  // Whimsical 風：枠なし・背景なし。選択時のみ薄いハイライト
  const containerStyle = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 6px",
    borderRadius: 6,
    background: selected
      ? "rgba(168, 85, 247, 0.08)"   // 選択時：紫の薄いハイライト
      : "transparent",
    border: selected
      ? "1.5px solid rgba(168, 85, 247, 0.4)"
      : "1.5px solid transparent",
    cursor: "default",
    userSelect: "none",
    transition: "background 0.1s, border 0.1s",
    minWidth: 40,
    maxWidth: 220,
  };

  const textStyle = {
    fontSize: 14,
    fontWeight: 500,
    color: T.fg ?? "#1e293b",
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    lineHeight: 1.5,
    wordBreak: "break-word",
    whiteSpace: "nowrap",  // Whimsical はデフォルト1行
  };

  const inputStyle = {
    fontSize: 14,
    fontWeight: 500,
    color: T.fg ?? "#1e293b",
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    background: "none",
    border: "none",
    outline: "none",
    padding: 0,
    margin: 0,
    minWidth: 40,
    maxWidth: 200,
  };

  return (
    <div onDoubleClick={startEdit} style={containerStyle}>
      {/* エッジの接続点（非表示・端に配置） */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none", left: -1 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none", right: -1 }}
      />

      {/* テキスト or 編集インプット */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          style={inputStyle}
          size={Math.max(4, draft.length + 1)}
        />
      ) : (
        <span style={textStyle}>
          {data.label || (
            <span style={{ color: T.muted ?? "#94a3b8", fontStyle: "italic", fontWeight: 400 }}>
              新しいノード
            </span>
          )}
        </span>
      )}

      {/* 折りたたみトグル（子があるノードのみ） */}
      {data.hasChildren && (
        <button
          title={data.collapsed ? "展開 (Cmd+/)" : "折りたたむ (Cmd+/)"}
          onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: "#a855f7",
            fontSize: 10,
            lineHeight: 1,
            flexShrink: 0,
            opacity: 0.7,
          }}
        >
          {data.collapsed ? "▶" : "◀"}
        </button>
      )}
    </div>
  );
}
