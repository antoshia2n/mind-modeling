import { useState, useRef, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { T } from "shia2n-core";

const BORDER = "#e2e8f0";
const ACCENT = "#3b82f6";
const DANGER = "#ef4444";

/**
 * マインドマップ用カスタムノード
 *
 * data で受け取るもの:
 *   label             - 表示テキスト
 *   collapsed         - 折りたたみ状態
 *   hasChildren       - 子ノードの有無（折りたたみボタン表示制御）
 *   isRoot            - ルートノードか（削除ボタンを非表示）
 *   onContentChange   - テキスト変更コールバック
 *   onAddChild        - 子追加コールバック
 *   onDelete          - 削除コールバック
 *   onToggleCollapse  - 折りたたみ切替コールバック
 */
export default function MmNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.label ?? "");
  const inputRef = useRef(null);

  useEffect(() => { setDraft(data.label ?? ""); }, [data.label]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commitEdit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (data.label ?? "")) data.onContentChange?.(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter")  { e.preventDefault(); commitEdit(); }
    if (e.key === "Escape") { setDraft(data.label ?? ""); setEditing(false); }
  }

  const nodeStyle = {
    background: T.surface ?? "#f8fafc",
    border: `2px solid ${selected ? ACCENT : BORDER}`,
    borderRadius: 8,
    padding: "8px 12px",
    minWidth: 80,
    maxWidth: 200,
    fontSize: 13,
    color: T.fg ?? "#1e293b",
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    cursor: "default",
    userSelect: "none",
    boxShadow: selected ? "0 0 0 3px rgba(59,130,246,0.15)" : "none",
    opacity: data.collapsed ? 0.85 : 1,
  };

  return (
    <div onDoubleClick={() => setEditing(true)} style={nodeStyle}>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />

      {/* 折りたたみボタン（子がある場合のみ表示） */}
      {data.hasChildren && (
        <button
          title={data.collapsed ? "展開する" : "折りたたむ"}
          onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.(); }}
          style={{
            position: "absolute",
            right: -10,
            top: "50%",
            transform: "translateY(-50%)",
            background: BORDER,
            border: "none",
            borderRadius: "50%",
            width: 18,
            height: 18,
            fontSize: 9,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            color: "#64748b",
            lineHeight: 1,
          }}
        >
          {data.collapsed ? "▶" : "▼"}
        </button>
      )}

      {/* テキスト or インライン編集 */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          style={{
            background: "none", border: "none", outline: "none",
            color: T.fg ?? "#1e293b", fontSize: 13,
            width: "100%", fontFamily: "inherit",
          }}
        />
      ) : (
        <span style={{ wordBreak: "break-word", lineHeight: 1.5 }}>
          {data.label || (
            <span style={{ color: T.muted ?? "#94a3b8", fontStyle: "italic" }}>(空)</span>
          )}
        </span>
      )}

      {/* 選択中アクションボタン */}
      {selected && !editing && (
        <div style={{
          display: "flex", gap: 4,
          marginTop: 8, paddingTop: 6,
          borderTop: `1px solid ${BORDER}`,
        }}>
          <ActionBtn label="+ 子" color={ACCENT} onClick={() => data.onAddChild?.()} />
          {!data.isRoot && (
            <ActionBtn label="削除" color={DANGER} onClick={() => data.onDelete?.()} />
          )}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick, color }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        flex: 1, background: "none", border: `1px solid ${color}`,
        borderRadius: 4, padding: "2px 0", fontSize: 11,
        color, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
