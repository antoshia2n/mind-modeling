import { useRef, useEffect, useState } from "react";
import { T } from "shia2n-core";
import { createNode, updateNode, deleteNode } from "../lib/supabase.js";
import { flattenTree } from "../lib/tree.js";

const INDENT_PX   = 24;
const DEBOUNCE_MS = 800;

export default function ListMode({ uid, mapId, nodes, onNodesChange, onSaved }) {
  const inputRefs  = useRef({});
  const saveTimers = useRef({});
  const flatNodes  = flattenTree(nodes);

  // ─── テキスト変更 ──────────────────────────────────

  function handleContentChange(nodeId, value) {
    onNodesChange(nodes.map(n => (n.id === nodeId ? { ...n, content: value } : n)));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      await updateNode(nodeId, { content: value });
      onSaved();
    }, DEBOUNCE_MS);
  }

  // ─── 書式変更 ──────────────────────────────────────

  async function handleFormatToggle(nodeId, field) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const v = !node[field];
    await updateNode(nodeId, { [field]: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: v } : n));
    onSaved();
  }

  async function handleColorChange(nodeId, field, value) {
    await updateNode(nodeId, { [field]: value || null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: value || null } : n));
    onSaved();
  }

  // ─── キーボード操作 ────────────────────────────────

  function handleKeyDown(e, flatNode) {
    const idx = flatNodes.findIndex(n => n.id === flatNode.id);
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const mod   = isMac ? e.metaKey : e.ctrlKey;

    // 書式ショートカット（Cmd+B / Cmd+I）
    if (e.key === "b" && mod) { e.preventDefault(); handleFormatToggle(flatNode.id, "bold");   return; }
    if (e.key === "i" && mod) { e.preventDefault(); handleFormatToggle(flatNode.id, "italic"); return; }

    // 構造操作
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doEnter(flatNode, idx); }
    else if (e.key === "Tab" && !e.shiftKey)  { e.preventDefault(); doIndent(flatNode, idx); }
    else if (e.key === "Tab" && e.shiftKey)   { e.preventDefault(); doOutdent(flatNode); }
    else if (e.key === "Backspace" && flatNode.content === "") { e.preventDefault(); doDelete(flatNode, idx); }
    else if (e.key === "ArrowUp"   && idx > 0)                { e.preventDefault(); inputRefs.current[flatNodes[idx - 1].id]?.focus(); }
    else if (e.key === "ArrowDown" && idx < flatNodes.length - 1) { e.preventDefault(); inputRefs.current[flatNodes[idx + 1].id]?.focus(); }
  }

  async function doEnter(flatNode, idx) {
    const { id: nodeId, parent_id: parentId } = flatNode;
    const siblings = nodes.filter(n => n.parent_id === parentId && n.map_id === mapId).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    let newOrder;
    if (ci === siblings.length - 1) {
      newOrder = (siblings[ci]?.order_index ?? 0) + 1024;
    } else {
      const prev = siblings[ci].order_index, next = siblings[ci + 1].order_index;
      newOrder = prev + Math.max(1, Math.floor((next - prev) / 2));
    }
    const newNode = await createNode(uid, mapId, parentId, newOrder);
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setTimeout(() => inputRefs.current[newNode.id]?.focus(), 50);
  }

  async function doIndent(flatNode, idx) {
    if (idx === 0) return;
    const prevSibling = flatNodes.slice(0, idx).reverse().find(n => n.depth === flatNode.depth);
    if (!prevSibling) return;
    const newParentId = prevSibling.id;
    const children = nodes.filter(n => n.parent_id === newParentId);
    const newOrder  = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    await updateNode(flatNode.id, { parent_id: newParentId, order_index: newOrder, x: null, y: null });
    onNodesChange(nodes.map(n => n.id === flatNode.id ? { ...n, parent_id: newParentId, order_index: newOrder, x: null, y: null } : n));
    onSaved();
    setTimeout(() => inputRefs.current[flatNode.id]?.focus(), 50);
  }

  async function doOutdent(flatNode) {
    const { id: nodeId, parent_id: parentId } = flatNode;
    if (parentId === null || parentId === undefined) return;
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;
    const grandParentId = parentNode.parent_id ?? null;
    const grandChildren = nodes.filter(n => n.parent_id === grandParentId && n.map_id === mapId).sort((a, b) => a.order_index - b.order_index);
    const pIdx = grandChildren.findIndex(n => n.id === parentId);
    let newOrder;
    if (pIdx === grandChildren.length - 1) {
      newOrder = (grandChildren[pIdx]?.order_index ?? 0) + 1024;
    } else {
      const prev = grandChildren[pIdx].order_index, next = grandChildren[pIdx + 1].order_index;
      newOrder = prev + Math.max(1, Math.floor((next - prev) / 2));
    }
    await updateNode(nodeId, { parent_id: grandParentId, order_index: newOrder, x: null, y: null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, parent_id: grandParentId, order_index: newOrder, x: null, y: null } : n));
    onSaved();
    setTimeout(() => inputRefs.current[nodeId]?.focus(), 50);
  }

  async function doDelete(flatNode, idx) {
    if (nodes.length <= 1) return;
    if (nodes.some(n => n.parent_id === flatNode.id)) return;
    const prevId = idx > 0 ? flatNodes[idx - 1].id : null;
    await deleteNode(flatNode.id);
    onNodesChange(nodes.filter(n => n.id !== flatNode.id)); onSaved();
    if (prevId) setTimeout(() => inputRefs.current[prevId]?.focus(), 50);
  }

  if (flatNodes.length === 0) return <div style={{ padding: 32, color: T.muted, fontSize: 14 }}>準備中...</div>;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 840, margin: "0 auto" }}>
      {flatNodes.map(node => (
        <NodeRow
          key={node.id}
          node={node}
          inputRef={el => { inputRefs.current[node.id] = el; }}
          onChange={value => handleContentChange(node.id, value)}
          onKeyDown={e => handleKeyDown(e, node)}
          onFormatToggle={field => handleFormatToggle(node.id, field)}
          onColorChange={(field, value) => handleColorChange(node.id, field, value)}
        />
      ))}
    </div>
  );
}

// ─── 1行コンポーネント ──────────────────────────────────

function NodeRow({ node, inputRef, onChange, onKeyDown, onFormatToggle, onColorChange }) {
  const taRef   = useRef(null);
  const [focused, setFocused] = useState(false);
  const [rowHovered, setRowHovered] = useState(false);

  function setRef(el) { taRef.current = el; if (typeof inputRef === "function") inputRef(el); }

  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleChange(e) { autoResize(e.target); onChange(e.target.value); }
  useEffect(() => { autoResize(taRef.current); }, [node.content]);

  // 書式スタイル
  const fmt = {
    fontWeight:     node.bold         ? 700     : undefined,
    fontStyle:      node.italic       ? "italic" : "normal",
    textDecoration: node.strikethrough ? "line-through" : "none",
    color:          node.text_color   || T.fg,
  };

  const showToolbar = focused || rowHovered;

  return (
    <div
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        paddingLeft: node.depth * INDENT_PX,
        marginBottom: 2,
        borderRadius: 6,
        // ノード背景色（node_color）を行全体に反映
        background: node.node_color || "transparent",
        padding: `2px ${node.node_color ? 8 : 0}px 2px ${node.depth * INDENT_PX + (node.node_color ? 8 : 0)}px`,
      }}
    >
      {/* 箇条書きの点 */}
      <span style={{ color: T.muted, fontSize: 18, lineHeight: "26px", flexShrink: 0, userSelect: "none" }}>•</span>

      {/* テキスト表示 / 編集エリア */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {/* 書式付き表示（非フォーカス時） */}
        {!focused && (
          <div
            onClick={() => taRef.current?.focus()}
            style={{
              fontSize: 14, lineHeight: "26px", minHeight: "26px",
              fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
              cursor: "text", wordBreak: "break-word", whiteSpace: "pre-wrap",
              ...fmt,
            }}
          >
            {node.content || (
              <span style={{ color: T.muted, fontStyle: "italic", fontWeight: 400 }}>テキストを入力...</span>
            )}
          </div>
        )}

        {/* textarea（ref を常時有効にするため、非フォーカス時は透明で配置） */}
        <textarea
          ref={setRef}
          value={node.content}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={focused ? "テキストを入力..." : ""}
          rows={1}
          style={{
            fontSize: 14, lineHeight: "26px",
            fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
            background: "none", border: "none", outline: "none",
            resize: "none", overflow: "hidden", padding: 0, margin: 0,
            width: "100%",
            ...fmt,
            ...(focused ? {} : {
              position: "absolute", top: 0, left: 0,
              opacity: 0, pointerEvents: "none",
            }),
          }}
        />
      </div>

      {/* 書式ツールバー（ホバー or フォーカス中に表示） */}
      {showToolbar && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 1,
            flexShrink: 0, opacity: 1, transition: "opacity 0.1s",
          }}
          onMouseDown={e => e.preventDefault()} // フォーカスを奪わない
        >
          <InlineBtn active={node.bold} title="太字 (⌘B)" onClick={() => onFormatToggle("bold")}>
            <b>B</b>
          </InlineBtn>
          <InlineBtn active={node.italic} title="斜体 (⌘I)" onClick={() => onFormatToggle("italic")}>
            <i style={{ fontStyle: "italic" }}>I</i>
          </InlineBtn>
          <InlineBtn active={node.strikethrough} title="取り消し線" onClick={() => onFormatToggle("strikethrough")}>
            <span style={{ textDecoration: "line-through" }}>S</span>
          </InlineBtn>
          <Sep />
          <InlineColorBtn
            title="文字色"
            value={node.text_color || "#374151"}
            hasValue={!!node.text_color}
            onChange={v => onColorChange("text_color", v)}
            onReset={() => onColorChange("text_color", null)}
          >
            {/* 文字色インジケータ：「A」+ 下線 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: node.text_color || "#6b7280", lineHeight: 1 }}>A</span>
              <div style={{ width: 12, height: 2.5, borderRadius: 1, background: node.text_color || "#d1d5db" }} />
            </div>
          </InlineColorBtn>
          <InlineColorBtn
            title="ノード背景色"
            value={node.node_color || "#ffffff"}
            hasValue={!!node.node_color}
            onChange={v => onColorChange("node_color", v)}
            onReset={() => onColorChange("node_color", null)}
          >
            {/* 背景色インジケータ：四角 */}
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              background: node.node_color || "#e5e7eb",
              border: "1.5px solid #d1d5db",
            }} />
          </InlineColorBtn>
        </div>
      )}
    </div>
  );
}

// ─── ツールバー用コンポーネント ─────────────────────────

function InlineBtn({ children, active, onClick, title }) {
  const [h, setH] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: active ? "rgba(168,85,247,0.12)" : (h ? "#f3f4f6" : "transparent"),
        border: active ? "1px solid rgba(168,85,247,0.3)" : "1px solid transparent",
        borderRadius: 5,
        color: active ? "#7c3aed" : "#6b7280",
        width: 26, height: 26,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 12,
        transition: "all 0.1s",
        padding: 0,
      }}
    >{children}</button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 16, background: "#e5e7eb", margin: "0 2px" }} />;
}

function InlineColorBtn({ children, title, value, hasValue, onChange, onReset }) {
  const inputRef = useRef(null);
  const [h, setH] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        title={title}
        onClick={() => inputRef.current?.click()}
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        style={{
          background: h ? "#f3f4f6" : "transparent",
          border: "1px solid transparent",
          borderRadius: 5,
          width: 26, height: 26,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0,
          outline: hasValue ? "2px solid rgba(168,85,247,0.3)" : "none",
          transition: "all 0.1s",
        }}
      >
        {children}
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
