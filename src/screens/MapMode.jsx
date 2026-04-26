import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState, Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, deleteNode } from "../lib/supabase.js";
import { calcLayout } from "../lib/layout.js";
import { navigate } from "../lib/navigate.js";
import MmNode from "./MmNode.jsx";

const nodeTypes = { mmNode: MmNode };
const EDGE_STYLE = { stroke: "#a855f7", strokeWidth: 2.5 };
const DEBOUNCE_MS = 800;

function getDescendantIds(nodeId, nodes) {
  const result = [];
  for (const n of nodes) { if (n.parent_id === nodeId) { result.push(n.id); result.push(...getDescendantIds(n.id, nodes)); } }
  return result;
}
function getHiddenIds(nodes) {
  const hidden = new Set();
  for (const n of nodes) { if (n.collapsed) for (const id of getDescendantIds(n.id, nodes)) hidden.add(id); }
  return hidden;
}

// ドラッグしたノードの下にあるノードを探す（ドロップ先候補）
function findDropTarget(dragged, allRfNodes, excludeIds) {
  const dw = dragged.measured?.width ?? 140, dh = dragged.measured?.height ?? 36;
  const cx = dragged.position.x + dw / 2, cy = dragged.position.y + dh / 2;
  let best = null, bestArea = 0;
  for (const n of allRfNodes) {
    if (excludeIds.has(n.id) || n.hidden) continue;
    const nw = n.measured?.width ?? 140, nh = n.measured?.height ?? 36;
    if (cx >= n.position.x && cx <= n.position.x + nw && cy >= n.position.y && cy <= n.position.y + nh) {
      const area = nw * nh;
      if (area > bestArea) { best = n; bestArea = area; }
    }
  }
  return best;
}

function collectSubtree(nodeId, nodes) {
  const result = [];
  function dfs(id, parentIdx) {
    const node = nodes.find(n => n.id === id); if (!node) return;
    const myIdx = result.length;
    result.push({ content: node.content ?? "", parentIdx, bold: node.bold ?? false, italic: node.italic ?? false, strikethrough: node.strikethrough ?? false, text_color: node.text_color ?? null, node_color: node.node_color ?? null });
    nodes.filter(n => n.parent_id === id).sort((a, b) => a.order_index - b.order_index).forEach(c => dfs(c.id, myIdx));
  }
  dfs(nodeId, -1); return result;
}

export default function MapMode({ uid, mapId, nodes, layoutMode = "bi", onNodesChange, onSaved, onRequestTemplateInsert, onRequestMapLink }) {
  const saveTimers = useRef({});
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);

  // 選択状態（単一フォーカス + 複数選択セット）
  const [selectedId,  setSelectedId]  = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingId,   setEditingId]   = useState(null);
  const [forceEditId, setForceEditId] = useState(null);

  // ドラッグ状態
  const [dropTargetId, setDropTargetId] = useState(null);

  const [toastMsg, setToastMsg] = useState(null);
  function showToast(msg) { setToastMsg(msg); setTimeout(() => setToastMsg(null), 2200); }

  // ─── ノード操作 ────────────────────────────────────────────

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, content: value } : n));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => { await updateNode(nodeId, { content: value }); onSaved(); }, DEBOUNCE_MS);
  }, [nodes, onNodesChange, onSaved]);

  const addSibling = useCallback(async (nodeId, position = "after") => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
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
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id])); setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const children = nodes.filter(n => n.parent_id === nodeId);
    const newOrder  = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    const newNode = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id])); setForceEditId(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const removeNode = useCallback(async (nodeId) => {
    if (nodes.length <= 1) return;
    await deleteNode(nodeId);
    onNodesChange(nodes.filter(n => ![nodeId, ...getDescendantIds(nodeId, nodes)].includes(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
  }, [nodes, onNodesChange, onSaved]);

  // 選択中のノードを全て削除（マルチセレクト対応）
  const removeSelectedNodes = useCallback(async () => {
    const idsToRemove = selectedIds.size > 0 ? [...selectedIds] : (selectedId ? [selectedId] : []);
    if (idsToRemove.length === 0 || nodes.length <= idsToRemove.length) return;
    // 子孫も含めて削除対象を収集
    const allToRemove = new Set(idsToRemove);
    for (const id of idsToRemove) for (const did of getDescendantIds(id, nodes)) allToRemove.add(did);
    for (const id of [...allToRemove].filter(id => !getDescendantIds(id, nodes).some(d => allToRemove.has(d)))) {
      await deleteNode(id).catch(() => {});
    }
    // ルートだけ削除すれば CASCADE で子も消える
    for (const id of idsToRemove) await deleteNode(id).catch(() => {});
    onNodesChange(nodes.filter(n => !allToRemove.has(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
    showToast(`${idsToRemove.length}ノードを削除しました`);
  }, [nodes, selectedId, selectedIds, onNodesChange, onSaved]);

  const toggleCollapse = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const v = !node.collapsed;
    await updateNode(nodeId, { collapsed: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, collapsed: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const toggleFormat = useCallback(async (nodeId, field) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const v = !node[field];
    await updateNode(nodeId, { [field]: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const setColor = useCallback(async (nodeId, field, value) => {
    await updateNode(nodeId, { [field]: value ?? null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: value ?? null } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  // Cmd+↑/↓ で兄弟の並び順を変更
  const reorderSibling = useCallback(async (nodeId, direction) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    const targetIdx = ci + direction;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;
    const targetNode = siblings[targetIdx];
    // order_index を交換
    await Promise.all([
      updateNode(nodeId, { order_index: targetNode.order_index }),
      updateNode(targetNode.id, { order_index: node.order_index }),
    ]);
    onNodesChange(nodes.map(n => {
      if (n.id === nodeId)         return { ...n, order_index: targetNode.order_index };
      if (n.id === targetNode.id)  return { ...n, order_index: node.order_index };
      return n;
    }));
    onSaved();
    showToast("順序を変更しました");
  }, [nodes, onNodesChange, onSaved]);

  const moveSelection = useCallback((nodeId, direction) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const hiddenIds = getHiddenIds(nodes);
    if (direction === "right") {
      const ch = nodes.filter(n => n.parent_id === nodeId && !hiddenIds.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      if (ch.length > 0) { setSelectedId(ch[0].id); setSelectedIds(new Set([ch[0].id])); }
    } else if (direction === "left") {
      if (node.parent_id) { setSelectedId(node.parent_id); setSelectedIds(new Set([node.parent_id])); }
    } else {
      const siblings = nodes.filter(n => n.parent_id === node.parent_id && !hiddenIds.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      const ci = siblings.findIndex(n => n.id === nodeId);
      let nextId = null;
      if (direction === "up"   && ci > 0)                   nextId = siblings[ci - 1].id;
      if (direction === "down" && ci < siblings.length - 1) nextId = siblings[ci + 1].id;
      if (nextId) { setSelectedId(nextId); setSelectedIds(new Set([nextId])); }
    }
  }, [nodes]);

  const copySubtree = useCallback(async (nodeId) => {
    const subtree = collectSubtree(nodeId, nodes);
    try { await navigator.clipboard.writeText(JSON.stringify({ mmCopy: true, nodes: subtree })); showToast(`${subtree.length}ノードをコピーしました`); }
    catch { showToast("クリップボードの許可が必要です"); }
  }, [nodes]);

  const pasteSubtree = useCallback(async (parentId) => {
    let text;
    try { text = await navigator.clipboard.readText(); } catch { showToast("クリップボードの許可が必要です"); return; }
    let payload; try { payload = JSON.parse(text); } catch { return; }
    if (!payload?.mmCopy || !Array.isArray(payload.nodes)) return;
    const idMap = {}, newNodes = [];
    for (let i = 0; i < payload.nodes.length; i++) {
      const { content, parentIdx, bold, italic, strikethrough, text_color, node_color } = payload.nodes[i];
      const actualParentId = parentIdx === -1 ? parentId : idMap[parentIdx];
      const current = [...nodes, ...newNodes];
      const siblings = current.filter(n => n.parent_id === actualParentId);
      const newOrder = siblings.length > 0 ? Math.max(...siblings.map(n => n.order_index)) + 1024 : 1024;
      const newNode  = await createNode(uid, mapId, actualParentId, newOrder, content, { bold, italic, strikethrough, text_color, node_color });
      if (!newNode) continue;
      idMap[i] = newNode.id; newNodes.push(newNode);
    }
    onNodesChange([...nodes, ...newNodes]); onSaved();
    if (newNodes.length > 0) { setSelectedId(newNodes[0].id); setSelectedIds(new Set([newNodes[0].id])); showToast(`${newNodes.length}ノードをペーストしました`); }
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  // ─── キーボードショートカット ─────────────────────────────

  useEffect(() => {
    function handleKeyDown(e) {
      if (document.activeElement?.tagName === "INPUT") return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod   = isMac ? e.metaKey : e.ctrlKey;
      const sid   = selectedId;
      if (sid) {
        if (e.key === "c" && mod && !e.shiftKey) { e.preventDefault(); copySubtree(sid); return; }
        if (e.key === "v" && mod && !e.shiftKey) { e.preventDefault(); pasteSubtree(sid); return; }
        if (e.key === "b" && mod) { e.preventDefault(); toggleFormat(sid, "bold");   return; }
        if (e.key === "i" && mod) { e.preventDefault(); toggleFormat(sid, "italic"); return; }
        if (e.key === "Enter" && !mod && !e.shiftKey) { e.preventDefault(); addSibling(sid, "after");  return; }
        if (e.key === "Enter" && mod  && !e.shiftKey) { e.preventDefault(); addSibling(sid, "before"); return; }
        if (e.key === "Tab"   && !e.shiftKey)         { e.preventDefault(); addChild(sid);             return; }
        if (e.key === "/" && mod)                      { e.preventDefault(); toggleCollapse(sid);       return; }
        // Cmd+↑/↓ で兄弟並び替え
        if (e.key === "ArrowUp"   && mod) { e.preventDefault(); reorderSibling(sid, -1); return; }
        if (e.key === "ArrowDown" && mod) { e.preventDefault(); reorderSibling(sid,  1); return; }
        if (e.key === "F2") { e.preventDefault(); setForceEditId(sid); return; }
        if (e.key === "Escape") { setSelectedId(null); setSelectedIds(new Set()); return; }
        if (e.key === "ArrowUp"   && !mod) { e.preventDefault(); moveSelection(sid, "up");    return; }
        if (e.key === "ArrowDown" && !mod) { e.preventDefault(); moveSelection(sid, "down");  return; }
        if (e.key === "ArrowLeft" && !mod) { e.preventDefault(); moveSelection(sid, "left");  return; }
        if (e.key === "ArrowRight"&& !mod) { e.preventDefault(); moveSelection(sid, "right"); return; }
      }
      // Delete / Backspace：選択ノードを削除
      if ((e.key === "Delete" || e.key === "Backspace") && !mod && (sid || selectedIds.size > 0)) {
        e.preventDefault(); removeSelectedNodes(); return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, selectedIds, addSibling, addChild, toggleCollapse, removeSelectedNodes, moveSelection, copySubtree, pasteSubtree, toggleFormat, reorderSibling]);

  // ─── rfNodes / rfEdges 同期 ────────────────────────────────

  useEffect(() => {
    const { positions, directions } = calcLayout(nodes, layoutMode);
    const hiddenIds = getHiddenIds(nodes);
    const rootIds   = new Set(nodes.filter(n => !n.parent_id).map(n => n.id));

    setRfNodes(nodes.map(n => {
      const dir    = directions[n.id] ?? "right";
      const isLeft = dir === "left";
      const isRoot = rootIds.has(n.id);
      return {
        id: n.id, position: positions[n.id] ?? { x: 0, y: 0 },
        type: "mmNode", hidden: hiddenIds.has(n.id),
        selected: selectedIds.has(n.id),
        sourcePosition: isLeft ? Position.Left  : Position.Right,
        targetPosition: isLeft ? Position.Right : Position.Left,
        data: {
          label: n.content ?? "", collapsed: n.collapsed,
          hasChildren:      nodes.some(c => c.parent_id === n.id),
          hasRightChildren: isRoot && nodes.some(c => c.parent_id === n.id && directions[c.id] === "right"),
          hasLeftChildren:  isRoot && nodes.some(c => c.parent_id === n.id && directions[c.id] === "left"),
          isRoot, direction: dir, forceEdit: n.id === forceEditId,
          // ドロップ先ハイライト
          isDropTarget: n.id === dropTargetId,
          // 選択状態
          isSelected:   selectedIds.has(n.id),
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          linkedMapId: n.linked_map_id ?? null,
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
          onInsertTemplate:      ()  => onRequestTemplateInsert?.(n.id),
          onMapLink:             ()  => onRequestMapLink?.(n.id, n.linked_map_id),
          onNavigateLink:        ()  => { if (n.linked_map_id) navigate(`/m/${n.linked_map_id}`); },
          onEditStart: () => { setEditingId(n.id); setForceEditId(null); },
          onEditEnd:   () => setEditingId(null),
        },
      };
    }));

    setRfEdges(nodes.filter(n => n.parent_id).map(n => {
      const isLeft = (directions[n.id] ?? "right") === "left";
      return { id: `e-${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id, sourceHandle: isLeft ? "sl" : "sr", targetHandle: isLeft ? "tr" : "tl", type: "smoothstep", style: EDGE_STYLE, hidden: hiddenIds.has(n.id) };
    }));
  }, [nodes, selectedIds, forceEditId, dropTargetId, layoutMode, handleContentChange, toggleCollapse, addChild, addSibling, toggleFormat, setColor, onRequestTemplateInsert, onRequestMapLink]);

  // ─── ドラッグ中：ドロップ先候補をハイライト ─────────────────

  const handleNodeDrag = useCallback((event, draggedNode, allRfNodes) => {
    // ドラッグ中のノード群（マルチセレクトを含む）
    const draggingIds = selectedIds.size > 1 ? selectedIds : new Set([draggedNode.id]);
    const target = findDropTarget(draggedNode, allRfNodes, draggingIds);
    // 自分の子孫はドロップ先にできない
    const descendants = new Set(getDescendantIds(draggedNode.id, nodes));
    const validTarget = target && !descendants.has(target.id) ? target.id : null;
    if (validTarget !== dropTargetId) setDropTargetId(validTarget);
  }, [selectedIds, nodes, dropTargetId]);

  // ─── ドラッグ終了：ドロップ先に移動 ──────────────────────────

  const handleNodeDragStop = useCallback(async (event, draggedNode, allRfNodes) => {
    setDropTargetId(null);

    // ドラッグした全ノードのセット
    const draggingIds = selectedIds.size > 1 ? selectedIds : new Set([draggedNode.id]);
    const target = findDropTarget(draggedNode, allRfNodes, draggingIds);

    if (!target) {
      // ドロップ先なし → スナップバック
      const { positions } = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position })));
      return;
    }

    // ドロップ先の子孫に自分を移動させようとしていないかチェック
    const allDescendants = new Set();
    for (const id of draggingIds) for (const d of getDescendantIds(id, nodes)) allDescendants.add(d);
    if (allDescendants.has(target.id)) {
      showToast("子孫ノードには移動できません");
      const { positions } = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position })));
      return;
    }

    // 実際にドロップ先の直接の親に変更すべきノードだけに絞る
    // （既に選択済みノードの親・祖先にあたるノードも選択されている場合、
    //   子だけを移動すれば十分なので、「最上位」のノードだけを移動する）
    const toMove = [...draggingIds].filter(id => {
      const node = nodes.find(n => n.id === id);
      if (!node) return false;
      // 自分の祖先が draggingIds に含まれていれば、自分は除外
      let cur = node;
      while (cur.parent_id) {
        if (draggingIds.has(cur.parent_id)) return false;
        cur = nodes.find(n => n.id === cur.parent_id) ?? { parent_id: null };
      }
      return true;
    });

    // 各ノードを target の子として移動
    let updatedNodes = [...nodes];
    for (const nodeId of toMove) {
      const existingSiblings = updatedNodes.filter(n => n.parent_id === target.id);
      const newOrder = existingSiblings.length > 0 ? Math.max(...existingSiblings.map(n => n.order_index)) + 1024 : 1024;
      await updateNode(nodeId, { parent_id: target.id, order_index: newOrder });
      updatedNodes = updatedNodes.map(n => n.id === nodeId ? { ...n, parent_id: target.id, order_index: newOrder } : n);
    }

    onNodesChange(updatedNodes); onSaved();
    if (toMove.length > 0) showToast(`${toMove.length}ノードを移動しました`);
  }, [selectedIds, nodes, layoutMode, onNodesChange, onSaved, setRfNodes]);

  // ─── クリック / 選択変更 ─────────────────────────────────────

  const handleNodeClick = useCallback((e, node) => {
    if (e.shiftKey) {
      // Shift+クリック：マルチセレクトに追加/除外
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      setSelectedId(node.id);
    } else {
      setSelectedId(node.id);
      setSelectedIds(new Set([node.id]));
    }
    setForceEditId(null);
  }, []);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    // キャンバスドラッグによる範囲選択（react-flow 内部）
    if (selectedNodes.length > 1) {
      const ids = new Set(selectedNodes.map(n => n.id));
      setSelectedIds(ids);
      // キーボード操作用に最初のノードを selectedId に
      if (!ids.has(selectedId)) setSelectedId(selectedNodes[0]?.id ?? null);
    }
  }, [selectedId]);

  const handlePaneClick = useCallback(() => {
    if (!editingId) { setSelectedId(null); setSelectedIds(new Set()); setForceEditId(null); }
  }, [editingId]);

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px)", position: "relative" }}>
      <ReactFlow
        key={layoutMode}
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        // Shift+クリックでマルチセレクト
        multiSelectionKeyCode="Shift"
        // キャンバスドラッグで選択ボックス（空白エリアのドラッグ）
        selectionOnDrag={true}
        deleteKeyCode={null}
        panOnScroll={true}
        panOnDrag={false}
        fitView fitViewOptions={{ padding: 0.35 }}
        minZoom={0.2} maxZoom={2}
        style={{ background: "#eef0f6" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#c7cade" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* 選択中ノード数の表示 */}
      {selectedIds.size > 1 && (
        <div style={{
          position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)",
          background: "rgba(168,85,247,0.9)", color: "#fff",
          borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600,
          pointerEvents: "none",
        }}>
          {selectedIds.size}ノード選択中 — ドラッグで一括移動、Del で削除
        </div>
      )}

      {toastMsg && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(30,30,40,0.85)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, pointerEvents: "none" }}>{toastMsg}</div>
      )}

      <div style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#94a3b8", lineHeight: 1.9, pointerEvents: "none" }}>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟追加 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加</div>
        <div><b style={{color:"#6b7280"}}>⌘↑/↓</b> 並び順変更 ・ <b style={{color:"#6b7280"}}>Del</b> 削除</div>
        <div><b style={{color:"#6b7280"}}>Shift+クリック</b> or <b style={{color:"#6b7280"}}>ドラッグ</b> 範囲選択</div>
        <div>選択後ドラッグで一括移動</div>
      </div>
    </div>
  );
}
