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

  function handleContentChange(nodeId, value) {
    onNodesChange(nodes.map(n => (n.id === nodeId ? { ...n, content: value } : n)));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      await updateNode(nodeId, { content: value });
      onSaved();
    }, DEBOUNCE_MS);
  }

  function handleKeyDown(e, flatNode) {
    const idx = flatNodes.findIndex(n => n.id === flatNode.id);
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doEnter(flatNode, idx); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); doIndent(flatNode, idx); }
    else if (e.key === "Tab" && e.shiftKey)  { e.preventDefault(); doOutdent(flatNode); }
    else if (e.key === "Backspace" && flatNode.content === "") { e.preventDefault(); doDelete(flatNode, idx); }
    else if (e.key === "ArrowUp"   && idx > 0)                 { e.preventDefault(); inputRefs.current[flatNodes[idx - 1].id]?.focus(); }
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
    const parentIdx = grandChildren.findIndex(n => n.id === parentId);
    let newOrder;
    if (parentIdx === grandChildren.length - 1) {
      newOrder = (grandChildren[parentIdx]?.order_index ?? 0) + 1024;
    } else {
      const prev = grandChildren[parentIdx].order_index, next = grandChildren[parentIdx + 1].order_index;
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
    <div style={{ padding: "24px 32px", maxWidth: 800, margin: "0 auto" }}>
      {flatNodes.map(node => (
        <NodeRow
          key={node.id}
          node={node}
          inputRef={el => { inputRefs.current[node.id] = el; }}
          onChange={value => handleContentChange(node.id, value)}
          onKeyDown={e => handleKeyDown(e, node)}
        />
      ))}
    </div>
  );
}

function NodeRow({ node, inputRef, onChange, onKeyDown }) {
  const taRef   = useRef(null);
  const [focused, setFocused] = useState(false);

  function setRef(el) { taRef.current = el; if (typeof inputRef === "function") inputRef(el); }

  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleChange(e) { autoResize(e.target); onChange(e.target.value); }
  useEffect(() => { autoResize(taRef.current); }, [node.content]);

  // 書式スタイル（表示・編集共通）
  const formatStyle = {
    fontWeight:     node.bold         ? 700   : undefined,
    fontStyle:      node.italic       ? "italic" : "normal",
    textDecoration: node.strikethrough ? "line-through" : "none",
    color:          node.text_color   || T.fg,
  };

  const baseTextStyle = {
    flex: 1, fontSize: 14, lineHeight: "26px",
    fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    ...formatStyle,
  };

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingLeft: node.depth * INDENT_PX, marginBottom: 4 }}>
      <span style={{ color: T.muted, fontSize: 18, lineHeight: "26px", flexShrink: 0, userSelect: "none" }}>•</span>

      <div style={{ flex: 1, position: "relative" }}>
        {/* 書式付き表示（非フォーカス時）*/}
        {!focused && (
          <div
            onClick={() => taRef.current?.focus()}
            style={{
              ...baseTextStyle,
              minHeight: "26px",
              cursor: "text",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {node.content || (
              <span style={{ color: T.muted, fontStyle: "italic", fontWeight: 400 }}>テキストを入力...</span>
            )}
          </div>
        )}

        {/* textarea（フォーカス時のみ表示） */}
        <textarea
          ref={setRef}
          value={node.content}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={1}
          style={{
            ...baseTextStyle,
            background: "none", border: "none", outline: "none",
            resize: "none", overflow: "hidden", padding: 0, margin: 0,
            // フォーカス時は表示、非フォーカス時は絶対配置で隠す（ref は常に有効）
            ...(focused ? {} : {
              position: "absolute", top: 0, left: 0,
              opacity: 0, pointerEvents: "none", width: "100%",
            }),
          }}
        />
      </div>
    </div>
  );
}
