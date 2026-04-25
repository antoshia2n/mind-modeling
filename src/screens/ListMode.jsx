import { useRef, useEffect } from "react";
import { T } from "shia2n-core";
import { createNode, updateNode, deleteNode } from "../lib/supabase.js";
import { flattenTree } from "../lib/tree.js";

const INDENT_PX = 24;       // 1階層あたりのインデント幅（px）
const DEBOUNCE_MS = 800;    // テキスト変更の自動保存間隔（ms）

export default function ListMode({ uid, mapId, nodes, onNodesChange, onSaved }) {
  const inputRefs = useRef({});     // { nodeId: HTMLTextAreaElement }
  const saveTimers = useRef({});    // { nodeId: TimerId }

  const flatNodes = flattenTree(nodes);

  // ─── テキスト変更（debounce 保存） ─────────────────
  function handleContentChange(nodeId, value) {
    // UI は即時更新
    const newNodes = nodes.map((n) => (n.id === nodeId ? { ...n, content: value } : n));
    onNodesChange(newNodes);
    // DB への保存は 800ms 後
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      await updateNode(nodeId, { content: value });
      onSaved();
    }, DEBOUNCE_MS);
  }

  // ─── キーボードイベント ─────────────────────────────
  function handleKeyDown(e, flatNode) {
    const idx = flatNodes.findIndex((n) => n.id === flatNode.id);

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doEnter(flatNode, idx);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      doIndent(flatNode, idx);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      doOutdent(flatNode);
    } else if (e.key === "Backspace" && flatNode.content === "") {
      e.preventDefault();
      doDelete(flatNode, idx);
    } else if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      inputRefs.current[flatNodes[idx - 1].id]?.focus();
    } else if (e.key === "ArrowDown" && idx < flatNodes.length - 1) {
      e.preventDefault();
      inputRefs.current[flatNodes[idx + 1].id]?.focus();
    }
  }

  // Enter: 同階層に新ノードを直後に追加
  async function doEnter(flatNode, idx) {
    const { id: nodeId, parent_id: parentId } = flatNode;
    const siblings = nodes
      .filter((n) => n.parent_id === parentId && n.map_id === mapId)
      .sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex((n) => n.id === nodeId);

    let newOrder;
    if (ci === siblings.length - 1) {
      // 末尾に追加
      newOrder = (siblings[ci]?.order_index ?? 0) + 1024;
    } else {
      // 前後の中間に挿入
      const prev = siblings[ci].order_index;
      const next = siblings[ci + 1].order_index;
      newOrder = prev + Math.max(1, Math.floor((next - prev) / 2));
    }

    const newNode = await createNode(uid, mapId, parentId, newOrder);
    if (!newNode) return;
    onNodesChange([...nodes, newNode]);
    onSaved();
    setTimeout(() => inputRefs.current[newNode.id]?.focus(), 50);
  }

  // Tab: インデント（直前の兄弟ノードの子にする）
  async function doIndent(flatNode, idx) {
    if (idx === 0) return;
    // 直前の同 depth のノードを探す（それが新しい親になる）
    const prevSibling = flatNodes.slice(0, idx).reverse().find((n) => n.depth === flatNode.depth);
    if (!prevSibling) return;

    const newParentId = prevSibling.id;
    const children = nodes.filter((n) => n.parent_id === newParentId);
    const newOrder = children.length > 0
      ? Math.max(...children.map((n) => n.order_index)) + 1024
      : 1024;

    await updateNode(flatNode.id, { parent_id: newParentId, order_index: newOrder });
    const newNodes = nodes.map((n) =>
      n.id === flatNode.id ? { ...n, parent_id: newParentId, order_index: newOrder } : n
    );
    onNodesChange(newNodes);
    onSaved();
    setTimeout(() => inputRefs.current[flatNode.id]?.focus(), 50);
  }

  // Shift+Tab: アウトデント（親の親の子にする）
  async function doOutdent(flatNode) {
    const { id: nodeId, parent_id: parentId } = flatNode;
    if (parentId === null || parentId === undefined) return; // すでにルート

    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) return;
    const grandParentId = parentNode.parent_id ?? null;

    // 親ノードの直後に挿入する order_index を計算
    const grandChildren = nodes
      .filter((n) => n.parent_id === grandParentId && n.map_id === mapId)
      .sort((a, b) => a.order_index - b.order_index);
    const parentIdx = grandChildren.findIndex((n) => n.id === parentId);

    let newOrder;
    if (parentIdx === grandChildren.length - 1) {
      newOrder = (grandChildren[parentIdx]?.order_index ?? 0) + 1024;
    } else {
      const prev = grandChildren[parentIdx].order_index;
      const next = grandChildren[parentIdx + 1].order_index;
      newOrder = prev + Math.max(1, Math.floor((next - prev) / 2));
    }

    await updateNode(nodeId, { parent_id: grandParentId, order_index: newOrder });
    const newNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, parent_id: grandParentId, order_index: newOrder } : n
    );
    onNodesChange(newNodes);
    onSaved();
    setTimeout(() => inputRefs.current[nodeId]?.focus(), 50);
  }

  // Backspace（空ノード）: 削除して前ノードにフォーカス
  async function doDelete(flatNode, idx) {
    if (nodes.length <= 1) return; // 最後の1ノードは削除しない
    const hasChildren = nodes.some((n) => n.parent_id === flatNode.id);
    if (hasChildren) return; // 子があるノードは削除しない

    const prevId = idx > 0 ? flatNodes[idx - 1].id : null;
    await deleteNode(flatNode.id);
    const newNodes = nodes.filter((n) => n.id !== flatNode.id);
    onNodesChange(newNodes);
    onSaved();
    if (prevId) setTimeout(() => inputRefs.current[prevId]?.focus(), 50);
  }

  // ─── レンダリング ────────────────────────────────────
  if (flatNodes.length === 0) {
    return <div style={{ padding: 32, color: T.muted, fontSize: 14 }}>準備中...</div>;
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 800, margin: "0 auto" }}>
      {flatNodes.map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          inputRef={(el) => { inputRefs.current[node.id] = el; }}
          onChange={(value) => handleContentChange(node.id, value)}
          onKeyDown={(e) => handleKeyDown(e, node)}
        />
      ))}
    </div>
  );
}

// ─── 1ノード分の行コンポーネント ─────────────────────────
function NodeRow({ node, inputRef, onChange, onKeyDown }) {
  const taRef = useRef(null);

  function setRef(el) {
    taRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
  }

  // textarea の高さをコンテンツに合わせて自動調整する
  function autoResize(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleChange(e) {
    autoResize(e.target);
    onChange(e.target.value);
  }

  useEffect(() => {
    autoResize(taRef.current);
  }, [node.content]);

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      paddingLeft: node.depth * INDENT_PX,
      marginBottom: 4,
    }}>
      {/* 箇条書きの点（•） */}
      <span style={{
        color: T.muted,
        fontSize: 18,
        lineHeight: "26px",
        flexShrink: 0,
        userSelect: "none",
      }}>
        •
      </span>

      {/* テキスト入力エリア */}
      <textarea
        ref={setRef}
        value={node.content}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={node.depth === 0 ? "テキストを入力..." : ""}
        rows={1}
        style={{
          flex: 1,
          background: "none",
          border: "none",
          outline: "none",
          color: T.fg,
          fontSize: 14,
          lineHeight: "26px",
          fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
          resize: "none",
          overflow: "hidden",
          padding: 0,
          margin: 0,
        }}
      />
    </div>
  );
}
