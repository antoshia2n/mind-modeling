import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, deleteNode } from "../lib/supabase.js";
import { calcLayout } from "../lib/layout.js";
import MmNode from "./MmNode.jsx";

const nodeTypes = { mmNode: MmNode };
const EDGE_STYLE = { stroke: "#a855f7", strokeWidth: 2.5 };
const DEBOUNCE_MS = 800;

function getDescendantIds(nodeId, nodes) {
  const result = [];
  for (const n of nodes) {
    if (n.parent_id === nodeId) { result.push(n.id); result.push(...getDescendantIds(n.id, nodes)); }
  }
  return result;
}

function getHiddenIds(nodes) {
  const hidden = new Set();
  for (const n of nodes) {
    if (n.collapsed) for (const id of getDescendantIds(n.id, nodes)) hidden.add(id);
  }
  return hidden;
}

function findDropTarget(dragged, allRfNodes) {
  const dw = dragged.measured?.width ?? 120, dh = dragged.measured?.height ?? 32;
  const cx = dragged.position.x + dw / 2, cy = dragged.position.y + dh / 2;
  for (const n of allRfNodes) {
    if (n.id === dragged.id || n.hidden) continue;
    const nw = n.measured?.width ?? 120, nh = n.measured?.height ?? 32;
    if (cx >= n.position.x && cx <= n.position.x + nw && cy >= n.position.y && cy <= n.position.y + nh) return n;
  }
  return null;
}

function collectSubtree(nodeId, nodes) {
  const result = [];
  function dfs(id, parentIdx) {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    const myIdx = result.length;
    result.push({
      content: node.content ?? "", parentIdx,
      bold: node.bold ?? false, italic: node.italic ?? false,
      strikethrough: node.strikethrough ?? false,
      text_color: node.text_color ?? null, node_color: node.node_color ?? null,
    });
    nodes.filter(n => n.parent_id === id).sort((a, b) => a.order_index - b.order_index).forEach(c => dfs(c.id, myIdx));
  }
  dfs(nodeId, -1);
  return result;
}

/**
 * @param {string} layoutMode - "bi"（双方向）または "lr"（左→右）
 */
export default function MapMode({ uid, mapId, nodes, layoutMode = "bi", onNodesChange, onSaved }) {
  const saveTimers = useRef({});
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);
  const [selectedId,  setSelectedId]  = useState(null);
  const [editingId,   setEditingId]   = useState(null);
  const [forceEditId, setForceEditId] = useState(null);
  const [toastMsg,    setToastMsg]    = useState(null);

  function showToast(msg) { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2000); }

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, content: value } : n));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => { await updateNode(nodeId, { content: value }); onSaved(); }, DEBOUNCE_MS);
  }, [nodes, onNodesChange, onSaved]);

  const addSibling = useCallback(async (nodeId, position = "after") => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const siblings = nodes.filter(n => n.parent_id === node.parent_id && n.map_id === mapId).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    let newOrder;
    if (position === "after") {
      newOrder = ci === siblings.length - 1 ? (siblings[ci]?.order_index ?? 0) + 1024
        : siblings[ci].order_index + Math.max(1, Math.floor((siblings[ci + 1].order_index - siblings[ci].order_index) / 2));
    } else {
      newOrder = ci === 0 ? Math.max(1, siblings[0].order_index - 512)
        : siblings[ci - 1].order_index + Math.max(1, Math.floor((siblings[ci].order_index - siblings[ci - 1].order_index) / 2));
    }
    const newNode = await createNode(uid, mapId, node.parent_id, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const children = nodes.filter(n => n.parent_id === nodeId);
    const newOrder  = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    const newNode = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const removeNode = useCallback(async (nodeId) => {
    if (nodes.length <= 1) return;
    await deleteNode(nodeId);
    onNodesChange(nodes.filter(n => ![nodeId, ...getDescendantIds(nodeId, nodes)].includes(n.id)));
    onSaved(); setSelectedId(null);
  }, [nodes, onNodesChange, onSaved]);

  const toggleCollapse = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const v = !node.collapsed;
    await updateNode(nodeId, { collapsed: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, collapsed: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const moveSelection = useCallback((nodeId, direction) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const hiddenIds = getHiddenIds(nodes);
    if (direction === "right") {
      const children = nodes.filter(n => n.parent_id === nodeId && !hiddenIds.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      if (children.length > 0) setSelectedId(children[0].id);
    } else if (direction === "left") {
      if (node.parent_id) setSelectedId(node.parent_id);
    } else {
      const siblings = nodes.filter(n => n.parent_id === node.parent_id && !hiddenIds.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      const ci = siblings.findIndex(n => n.id === nodeId);
      if (direction === "up"   && ci > 0)                   setSelectedId(siblings[ci - 1].id);
      if (direction === "down" && ci < siblings.length - 1) setSelectedId(siblings[ci + 1].id);
    }
  }, [nodes]);

  const toggleFormat = useCallback(async (nodeId, field) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const v = !node[field];
    await updateNode(nodeId, { [field]: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const setColor = useCallback(async (nodeId, field, value) => {
    await updateNode(nodeId, { [field]: value ?? null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: value ?? null } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const copySubtree = useCallback(async (nodeId) => {
    const subtree = collectSubtree(nodeId, nodes);
    try {
      await navigator.clipboard.writeText(JSON.stringify({ mmCopy: true, nodes: subtree }));
      showToast(`${subtree.length}ノードをコピーしました`);
    } catch { showToast("クリップボードの許可が必要です"); }
  }, [nodes]);

  const pasteSubtree = useCallback(async (parentId) => {
    let text;
    try { text = await navigator.clipboard.readText(); } catch { showToast("クリップボードの許可が必要です"); return; }
    let payload;
    try { payload = JSON.parse(text); } catch { return; }
    if (!payload?.mmCopy || !Array.isArray(payload.nodes)) return;
    const idMap = {}, newNodes = [];
    for (let i = 0; i < payload.nodes.length; i++) {
      const { content, parentIdx, bold, italic, strikethrough, text_color, node_color } = payload.nodes[i];
      const actualParentId = parentIdx === -1 ? parentId : idMap[parentIdx];
      const current  = [...nodes, ...newNodes];
      const siblings = current.filter(n => n.parent_id === actualParentId);
      const newOrder = siblings.length > 0 ? Math.max(...siblings.map(n => n.order_index)) + 1024 : 1024;
      const newNode  = await createNode(uid, mapId, actualParentId, newOrder, content, { bold, italic, strikethrough, text_color, node_color });
      if (!newNode) continue;
      idMap[i] = newNode.id; newNodes.push(newNode);
    }
    onNodesChange([...nodes, ...newNodes]); onSaved();
    if (newNodes.length > 0) { setSelectedId(newNodes[0].id); showToast(`${newNodes.length}ノードをペーストしました`); }
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (document.activeElement?.tagName === "INPUT") return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod   = isMac ? e.metaKey : e.ctrlKey;
      if (selectedId) {
        if (e.key === "c" && mod && !e.shiftKey) { e.preventDefault(); copySubtree(selectedId); return; }
        if (e.key === "v" && mod && !e.shiftKey) { e.preventDefault(); pasteSubtree(selectedId); return; }
        if (e.key === "b" && mod) { e.preventDefault(); toggleFormat(selectedId, "bold");   return; }
        if (e.key === "i" && mod) { e.preventDefault(); toggleFormat(selectedId, "italic"); return; }
        if (e.key === "Enter" && !mod && !e.shiftKey) { e.preventDefault(); addSibling(selectedId, "after");  return; }
        if (e.key === "Enter" && mod  && !e.shiftKey) { e.preventDefault(); addSibling(selectedId, "before"); return; }
        if (e.key === "Tab"   && !e.shiftKey)         { e.preventDefault(); addChild(selectedId);             return; }
        if (e.key === "/" && mod)                      { e.preventDefault(); toggleCollapse(selectedId);       return; }
        if ((e.key === "Delete" || e.key === "Backspace") && !mod) { e.preventDefault(); removeNode(selectedId); return; }
        if (e.key === "F2")         { e.preventDefault(); setForceEditId(selectedId); return; }
        if (e.key === "Escape")     { setSelectedId(null); return; }
        if (e.key === "ArrowUp")    { e.preventDefault(); moveSelection(selectedId, "up");    return; }
        if (e.key === "ArrowDown")  { e.preventDefault(); moveSelection(selectedId, "down");  return; }
        if (e.key === "ArrowLeft")  { e.preventDefault(); moveSelection(selectedId, "left");  return; }
        if (e.key === "ArrowRight") { e.preventDefault(); moveSelection(selectedId, "right"); return; }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, addSibling, addChild, toggleCollapse, removeNode, moveSelection, copySubtree, pasteSubtree, toggleFormat]);

  // layoutMode が変わったら fitView をトリガーするため、key として使う
  useEffect(() => {
    const positions = calcLayout(nodes, layoutMode);
    const hiddenIds  = getHiddenIds(nodes);
    const rootIds    = new Set(nodes.filter(n => !n.parent_id).map(n => n.id));

    setRfNodes(nodes.map(n => ({
      id: n.id, position: positions[n.id] ?? { x: 0, y: 0 },
      type: "mmNode", hidden: hiddenIds.has(n.id), selected: n.id === selectedId,
      data: {
        label: n.content ?? "", collapsed: n.collapsed,
        hasChildren: nodes.some(c => c.parent_id === n.id),
        isRoot: rootIds.has(n.id), forceEdit: n.id === forceEditId,
        bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
        textColor: n.text_color, nodeColor: n.node_color,
        onContentChange:       (v) => handleContentChange(n.id, v),
        onToggleCollapse:      ()  => toggleCollapse(n.id),
        onAddChild:            ()  => addChild(n.id),
        onAddSiblingAbove:     ()  => addSibling(n.id, "before"),
        onAddSiblingBelow:     ()  => addSibling(n.id, "after"),
        onToggleBold:          ()  => toggleFormat(n.id, "bold"),
        onToggleItalic:        ()  => toggleFormat(n.id, "italic"),
        onToggleStrikethrough: ()  => toggleFormat(n.id, "strikethrough"),
        onTextColorChange:     (c) => setColor(n.id, "text_color", c),
        onNodeColorChange:     (c) => setColor(n.id, "node_color", c),
        onEditStart: () => { setEditingId(n.id); setForceEditId(null); },
        onEditEnd:   () => setEditingId(null),
      },
    })));

    setRfEdges(nodes.filter(n => n.parent_id).map(n => ({
      id: `e-${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id,
      type: "smoothstep", style: EDGE_STYLE, hidden: hiddenIds.has(n.id),
    })));
  }, [nodes, selectedId, forceEditId, layoutMode, handleContentChange, toggleCollapse, addChild, addSibling, toggleFormat, setColor]);

  const handleNodeDragStop = useCallback(async (event, node, allRfNodes) => {
    const target = findDropTarget(node, allRfNodes);
    if (target) {
      const descendants = getDescendantIds(node.id, nodes);
      if (descendants.includes(target.id) || target.id === node.id) {
        const pos = calcLayout(nodes, layoutMode);
        setRfNodes(prev => prev.map(n => ({ ...n, position: pos[n.id] ?? n.position }))); return;
      }
      const newSiblings = nodes.filter(n => n.parent_id === target.id);
      const newOrder    = newSiblings.length > 0 ? Math.max(...newSiblings.map(n => n.order_index)) + 1024 : 1024;
      await updateNode(node.id, { parent_id: target.id, order_index: newOrder, x: null, y: null });
      onNodesChange(nodes.map(n => n.id === node.id ? { ...n, parent_id: target.id, order_index: newOrder, x: null, y: null } : n));
      onSaved();
    } else {
      const pos = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: pos[n.id] ?? n.position })));
    }
  }, [nodes, layoutMode, onNodesChange, onSaved, setRfNodes]);

  const handleNodeClick  = useCallback((e, node) => { setSelectedId(node.id); setForceEditId(null); }, []);
  const handlePaneClick  = useCallback(() => { if (!editingId) { setSelectedId(null); setForceEditId(null); } }, [editingId]);

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px)", position: "relative" }}>
      {/* layoutMode が変わったら ReactFlow を再マウントして fitView を確実に適用 */}
      <ReactFlow
        key={layoutMode}
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        onNodeDragStop={handleNodeDragStop} onNodeClick={handleNodeClick} onPaneClick={handlePaneClick}
        nodesDraggable={true} nodesConnectable={false} elementsSelectable={true}
        deleteKeyCode={null} selectionKeyCode={null}
        panOnScroll={true} panOnDrag={false}
        fitView fitViewOptions={{ padding: 0.35 }} minZoom={0.2} maxZoom={2}
        style={{ background: "#eef0f6" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#c7cade" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {toastMsg && (
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "rgba(30,30,40,0.85)", color: "#fff",
          borderRadius: 8, padding: "8px 18px", fontSize: 13, pointerEvents: "none",
        }}>{toastMsg}</div>
      )}

      <div style={{
        position: "absolute", bottom: 16, right: 16,
        background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0",
        borderRadius: 8, padding: "8px 12px",
        fontSize: 11, color: "#94a3b8", lineHeight: 1.9, pointerEvents: "none",
      }}>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟追加 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加</div>
        <div><b style={{color:"#6b7280"}}>⌘B</b> 太字 ・ <b style={{color:"#6b7280"}}>⌘I</b> 斜体</div>
        <div><b style={{color:"#6b7280"}}>⌘C/V</b> サブツリーコピペ ・ <b style={{color:"#6b7280"}}>Del</b> 削除</div>
        <div>スクロールでパン ・ ダブルクリックで編集</div>
      </div>
    </div>
  );
}
