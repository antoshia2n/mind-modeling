import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, updateNodePosition, deleteNode } from "../lib/supabase.js";
import { getPositions } from "../lib/layout.js";
import MmNode from "./MmNode.jsx";

const nodeTypes = { mmNode: MmNode };

// Whimsical 風：紫の曲線エッジ
const EDGE_STYLE = {
  stroke: "#a855f7",
  strokeWidth: 2.5,
};

const DEBOUNCE_MS = 800;

// ─── ユーティリティ ──────────────────────────────────

function getDescendantIds(nodeId, nodes) {
  const result = [];
  for (const n of nodes) {
    if (n.parent_id === nodeId) {
      result.push(n.id);
      result.push(...getDescendantIds(n.id, nodes));
    }
  }
  return result;
}

function getHiddenIds(nodes) {
  const hidden = new Set();
  for (const n of nodes) {
    if (n.collapsed) {
      for (const id of getDescendantIds(n.id, nodes)) hidden.add(id);
    }
  }
  return hidden;
}

function findDropTarget(dragged, allRfNodes) {
  const dw = dragged.measured?.width  ?? 120;
  const dh = dragged.measured?.height ?? 32;
  const cx = dragged.position.x + dw / 2;
  const cy = dragged.position.y + dh / 2;
  for (const n of allRfNodes) {
    if (n.id === dragged.id || n.hidden) continue;
    const nw = n.measured?.width  ?? 120;
    const nh = n.measured?.height ?? 32;
    if (cx >= n.position.x && cx <= n.position.x + nw &&
        cy >= n.position.y && cy <= n.position.y + nh) return n;
  }
  return null;
}

// ─── MapMode ────────────────────────────────────────

export default function MapMode({ uid, mapId, nodes, onNodesChange, onSaved }) {
  const saveTimers = useRef({});
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [editingId,   setEditingId]   = useState(null);
  const [forceEditId, setForceEditId] = useState(null);

  // ─── 操作ハンドラ ──────────────────────────────────

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, content: value } : n));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      await updateNode(nodeId, { content: value });
      onSaved();
    }, DEBOUNCE_MS);
  }, [nodes, onNodesChange, onSaved]);

  const addSibling = useCallback(async (nodeId, position = "after") => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const parentId = node.parent_id;
    const siblings = nodes
      .filter(n => n.parent_id === parentId && n.map_id === mapId)
      .sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);

    let newOrder;
    if (position === "after") {
      if (ci === siblings.length - 1) {
        newOrder = (siblings[ci]?.order_index ?? 0) + 1024;
      } else {
        const prev = siblings[ci].order_index;
        const next = siblings[ci + 1].order_index;
        newOrder = prev + Math.max(1, Math.floor((next - prev) / 2));
      }
    } else {
      if (ci === 0) {
        newOrder = Math.max(1, siblings[0].order_index - 512);
      } else {
        const prev = siblings[ci - 1].order_index;
        const curr = siblings[ci].order_index;
        newOrder = prev + Math.max(1, Math.floor((curr - prev) / 2));
      }
    }

    const newNode = await createNode(uid, mapId, parentId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]);
    onSaved();
    setSelectedId(newNode.id);
    setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const children = nodes.filter(n => n.parent_id === nodeId);
    const newOrder  = children.length > 0
      ? Math.max(...children.map(n => n.order_index)) + 1024
      : 1024;
    const newNode = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]);
    onSaved();
    setSelectedId(newNode.id);
    setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const removeNode = useCallback(async (nodeId) => {
    if (nodes.length <= 1) return;
    await deleteNode(nodeId);
    const removedIds = [nodeId, ...getDescendantIds(nodeId, nodes)];
    onNodesChange(nodes.filter(n => !removedIds.includes(n.id)));
    onSaved();
    setSelectedId(null);
  }, [nodes, onNodesChange, onSaved]);

  const toggleCollapse = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newCollapsed = !node.collapsed;
    await updateNode(nodeId, { collapsed: newCollapsed });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, collapsed: newCollapsed } : n));
    onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const moveSelection = useCallback((nodeId, direction) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const hiddenIds = getHiddenIds(nodes);
    if (direction === "right") {
      const children = nodes
        .filter(n => n.parent_id === nodeId && !hiddenIds.has(n.id))
        .sort((a, b) => a.order_index - b.order_index);
      if (children.length > 0) setSelectedId(children[0].id);
    } else if (direction === "left") {
      if (node.parent_id) setSelectedId(node.parent_id);
    } else {
      const siblings = nodes
        .filter(n => n.parent_id === node.parent_id && !hiddenIds.has(n.id))
        .sort((a, b) => a.order_index - b.order_index);
      const ci = siblings.findIndex(n => n.id === nodeId);
      if (direction === "up"   && ci > 0)                   setSelectedId(siblings[ci - 1].id);
      if (direction === "down" && ci < siblings.length - 1) setSelectedId(siblings[ci + 1].id);
    }
  }, [nodes]);

  // ─── Whimsical 風キーボードショートカット ──────────

  useEffect(() => {
    function handleKeyDown(e) {
      if (document.activeElement?.tagName === "INPUT") return;
      if (!selectedId) return;

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod   = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === "Enter" && !mod && !e.shiftKey) {
        e.preventDefault(); addSibling(selectedId, "after"); return;
      }
      if (e.key === "Enter" && mod && !e.shiftKey) {
        e.preventDefault(); addSibling(selectedId, "before"); return;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault(); addChild(selectedId); return;
      }
      if (e.key === "/" && mod) {
        e.preventDefault(); toggleCollapse(selectedId); return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        e.preventDefault(); removeNode(selectedId); return;
      }
      if (e.key === "F2") {
        e.preventDefault(); setForceEditId(selectedId); return;
      }
      if (e.key === "Escape") { setSelectedId(null); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); moveSelection(selectedId, "up");    return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); moveSelection(selectedId, "down");  return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); moveSelection(selectedId, "left");  return; }
      if (e.key === "ArrowRight") { e.preventDefault(); moveSelection(selectedId, "right"); return; }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, addSibling, addChild, toggleCollapse, removeNode, moveSelection]);

  // ─── react-flow との同期 ────────────────────────────

  useEffect(() => {
    const positions = getPositions(nodes);
    const hiddenIds  = getHiddenIds(nodes);

    setRfNodes(prev =>
      nodes.map(n => {
        const existing = prev.find(p => p.id === n.id);
        const position =
          (n.x != null && n.y != null) ? { x: n.x, y: n.y } :
          existing?.position            ? existing.position  :
          positions[n.id]              ?? { x: 0, y: 0 };

        return {
          id:       n.id,
          position,
          type:     "mmNode",
          hidden:   hiddenIds.has(n.id),
          selected: n.id === selectedId,
          data: {
            label:            n.content ?? "",
            collapsed:        n.collapsed,
            hasChildren:      nodes.some(c => c.parent_id === n.id),
            forceEdit:        n.id === forceEditId,
            onContentChange:  (v) => handleContentChange(n.id, v),
            onToggleCollapse: ()  => toggleCollapse(n.id),
            onEditStart: () => { setEditingId(n.id); setForceEditId(null); },
            onEditEnd:   () => setEditingId(null),
          },
        };
      })
    );

    setRfEdges(
      nodes
        .filter(n => n.parent_id)
        .map(n => ({
          id:     `e-${n.parent_id}-${n.id}`,
          source: n.parent_id,
          target: n.id,
          type:   "smoothstep",
          style:  EDGE_STYLE,
          hidden: hiddenIds.has(n.id),
        }))
    );
  }, [nodes, selectedId, forceEditId, handleContentChange, toggleCollapse]);

  // ─── ドラッグ終了処理 ──────────────────────────────

  const handleNodeDragStop = useCallback(async (event, node, allRfNodes) => {
    const target = findDropTarget(node, allRfNodes);
    if (target) {
      const descendants = getDescendantIds(node.id, nodes);
      if (descendants.includes(target.id) || target.id === node.id) return;
      const newSiblings = nodes.filter(n => n.parent_id === target.id);
      const newOrder    = newSiblings.length > 0
        ? Math.max(...newSiblings.map(n => n.order_index)) + 1024
        : 1024;
      await updateNode(node.id, { parent_id: target.id, order_index: newOrder, x: null, y: null });
      onNodesChange(nodes.map(n =>
        n.id === node.id
          ? { ...n, parent_id: target.id, order_index: newOrder, x: null, y: null }
          : n
      ));
      onSaved();
    } else {
      const { x, y } = node.position;
      await updateNodePosition(node.id, x, y);
      onNodesChange(nodes.map(n => n.id === node.id ? { ...n, x, y } : n));
      onSaved();
    }
  }, [nodes, onNodesChange, onSaved]);

  const handleNodeClick  = useCallback((e, node) => { setSelectedId(node.id); setForceEditId(null); }, []);
  const handlePaneClick  = useCallback(() => { if (!editingId) { setSelectedId(null); setForceEditId(null); } }, [editingId]);

  // ─── レンダリング ──────────────────────────────────

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px)" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onRfNodesChange}
        onEdgesChange={onRfEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
        selectionKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.2}
        maxZoom={2}
      >
        {/* Whimsical 風：薄いドット格子背景 */}
        <Background
          variant={BackgroundVariant.Dots}
          color="#d1d5db"
          gap={24}
          size={1.5}
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* キーボードショートカット凡例 */}
      <div style={{
        position: "absolute", bottom: 16, right: 16,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #e2e8f0",
        borderRadius: 8, padding: "8px 12px",
        fontSize: 11, color: "#94a3b8",
        lineHeight: 1.9, pointerEvents: "none",
        backdropFilter: "blur(4px)",
      }}>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟追加 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加</div>
        <div><b style={{color:"#6b7280"}}>⌘+Enter</b> 上に兄弟 ・ <b style={{color:"#6b7280"}}>⌘+/</b> 折りたたみ</div>
        <div><b style={{color:"#6b7280"}}>↑↓←→</b> 移動 ・ <b style={{color:"#6b7280"}}>Del</b> 削除</div>
        <div>ダブルクリックで編集</div>
      </div>
    </div>
  );
}
