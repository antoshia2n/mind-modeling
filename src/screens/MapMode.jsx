import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState, Position, useReactFlow,
  BaseEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, deleteNode, uploadPdf, deletePdf } from "../lib/supabase.js";
import { calcLayout } from "../lib/layout.js";
import { navigate } from "../lib/navigate.js";
import MmNode from "./MmNode.jsx";

// ─── Whimsical 風カスタムエッジ ──────────────────────────────

function WmEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style }) {
  const dx     = Math.abs(targetX - sourceX);
  const cpDist = Math.max(60, dx * 0.45);
  const isLeft = sourcePosition === Position.Left;
  const cp1x = isLeft ? sourceX - cpDist : sourceX + cpDist;
  const cp1y = sourceY;
  const cp2x = isLeft ? targetX + cpDist : targetX - cpDist;
  const cp2y = targetY;
  const d = `M ${sourceX},${sourceY} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${targetX},${targetY}`;
  return <BaseEdge id={id} path={d} style={style} />;
}

const nodeTypes = { mmNode: MmNode };
const edgeTypes = { wmEdge: WmEdge };
const EDGE_STYLE  = { stroke: "#a855f7", strokeWidth: 2, fill: "none" };
const DEBOUNCE_MS = 800;
const FOCUS_EVENT = "mm-focus-node";
const PDF_MAX_MB  = 20;

function fireNodeFocus(nodeId) {
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { nodeId } }));
  }, 80);
}

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
  const { getNodes } = useReactFlow();
  const saveTimers   = useRef({});
  const fileInputRef = useRef(null);
  const uploadNodeId = useRef(null); // アップロード対象のノードID

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);
  const [selectedId,   setSelectedId]   = useState(null);
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const [editingId,    setEditingId]    = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [toastMsg,     setToastMsg]     = useState(null);
  const [toastType,    setToastType]    = useState("info");

  function showToast(msg, type = "info") {
    setToastMsg(msg); setToastType(type);
    setTimeout(() => setToastMsg(null), 2500);
  }

  // ─── PDF アップロード ──────────────────────────────────────

  function handleUploadPdfClick(nodeId) {
    uploadNodeId.current = nodeId;
    fileInputRef.current?.click();
  }

  async function handleFileChange(e) {
    const file   = e.target.files?.[0];
    const nodeId = uploadNodeId.current;
    e.target.value = ""; // リセット（同じファイルを再選択できるよう）
    if (!file || !nodeId) return;

    if (file.type !== "application/pdf") { showToast("PDF ファイルのみアップロードできます", "error"); return; }
    if (file.size > PDF_MAX_MB * 1024 * 1024) { showToast(`ファイルサイズは ${PDF_MAX_MB}MB 以内にしてください`, "error"); return; }

    showToast("📄 アップロード中...", "info");

    // 既存の PDF があれば先に削除
    const existingNode = nodes.find(n => n.id === nodeId);
    if (existingNode?.pdf_url) await deletePdf(existingNode.pdf_url).catch(() => {});

    const storagePath = await uploadPdf(uid, nodeId, file);
    if (!storagePath) { showToast("アップロードに失敗しました", "error"); return; }

    await updateNode(nodeId, { pdf_url: storagePath, pdf_filename: file.name });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, pdf_url: storagePath, pdf_filename: file.name } : n));
    onSaved();
    showToast(`✓ PDF を添付しました（${file.name}）`);
  }

  async function handleDeletePdf(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node?.pdf_url) return;
    if (!window.confirm("添付された PDF を削除しますか？")) return;
    await deletePdf(node.pdf_url).catch(() => {});
    await updateNode(nodeId, { pdf_url: null, pdf_filename: null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, pdf_url: null, pdf_filename: null } : n));
    onSaved();
    showToast("PDF を削除しました");
  }

  function handleOpenSlideshow(nodeId) {
    window.open(`/slideshow/${nodeId}`, "_blank");
  }

  // ─── ノード操作 ───────────────────────────────────────────

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
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const children = nodes.filter(n => n.parent_id === nodeId);
    const newOrder = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    const newNode  = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const removeNode = useCallback(async (nodeId) => {
    if (nodes.length <= 1) return;
    await deleteNode(nodeId);
    onNodesChange(nodes.filter(n => ![nodeId, ...getDescendantIds(nodeId, nodes)].includes(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
  }, [nodes, onNodesChange, onSaved]);

  const removeSelectedNodes = useCallback(async () => {
    const idsToRemove = selectedIds.size > 0 ? [...selectedIds] : (selectedId ? [selectedId] : []);
    if (idsToRemove.length === 0 || nodes.length <= idsToRemove.length) return;
    const allToRemove = new Set(idsToRemove);
    for (const id of idsToRemove) for (const did of getDescendantIds(id, nodes)) allToRemove.add(did);
    for (const id of idsToRemove) await deleteNode(id).catch(() => {});
    onNodesChange(nodes.filter(n => !allToRemove.has(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
    if (idsToRemove.length > 1) showToast(`${idsToRemove.length}ノードを削除しました`);
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

  const reorderSibling = useCallback(async (nodeId, direction) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    const ti = ci + direction;
    if (ti < 0 || ti >= siblings.length) return;
    const t = siblings[ti];
    await Promise.all([updateNode(nodeId, { order_index: t.order_index }), updateNode(t.id, { order_index: node.order_index })]);
    onNodesChange(nodes.map(n => {
      if (n.id === nodeId) return { ...n, order_index: t.order_index };
      if (n.id === t.id)   return { ...n, order_index: node.order_index };
      return n;
    })); onSaved(); showToast("順序を変更しました");
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
    const result = [];
    function dfs(id, parentIdx) {
      const node = nodes.find(n => n.id === id); if (!node) return;
      const myIdx = result.length;
      result.push({ content: node.content ?? "", parentIdx, bold: node.bold ?? false, italic: node.italic ?? false, strikethrough: node.strikethrough ?? false, text_color: node.text_color ?? null, node_color: node.node_color ?? null });
      nodes.filter(n => n.parent_id === id).sort((a, b) => a.order_index - b.order_index).forEach(c => dfs(c.id, myIdx));
    }
    dfs(nodeId, -1);
    try { await navigator.clipboard.writeText(JSON.stringify({ mmCopy: true, nodes: result })); showToast(`${result.length}ノードをコピーしました`); }
    catch { showToast("クリップボードの許可が必要です", "error"); }
  }, [nodes]);

  const pasteSubtree = useCallback(async (parentId) => {
    let text; try { text = await navigator.clipboard.readText(); } catch { showToast("クリップボードの許可が必要です", "error"); return; }
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

  // ─── キーボード ──────────────────────────────────────────

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
        if (e.key === "/" && mod)                     { e.preventDefault(); toggleCollapse(sid);        return; }
        if (e.key === "ArrowUp"   && mod) { e.preventDefault(); reorderSibling(sid, -1); return; }
        if (e.key === "ArrowDown" && mod) { e.preventDefault(); reorderSibling(sid,  1); return; }
        if (e.key === "F2")          { e.preventDefault(); fireNodeFocus(sid); return; }
        if (e.key === "Escape")      { setSelectedId(null); setSelectedIds(new Set()); return; }
        if (e.key === "ArrowUp"    && !mod) { e.preventDefault(); moveSelection(sid, "up");    return; }
        if (e.key === "ArrowDown"  && !mod) { e.preventDefault(); moveSelection(sid, "down");  return; }
        if (e.key === "ArrowLeft"  && !mod) { e.preventDefault(); moveSelection(sid, "left");  return; }
        if (e.key === "ArrowRight" && !mod) { e.preventDefault(); moveSelection(sid, "right"); return; }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !mod && (sid || selectedIds.size > 0)) {
        e.preventDefault(); removeSelectedNodes(); return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, selectedIds, addSibling, addChild, toggleCollapse, removeSelectedNodes, moveSelection, copySubtree, pasteSubtree, toggleFormat, reorderSibling]);

  // ─── rfNodes / rfEdges 同期 ──────────────────────────────

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
          nodeId: n.id,
          label: n.content ?? "", collapsed: n.collapsed,
          hasChildren:      nodes.some(c => c.parent_id === n.id),
          hasRightChildren: isRoot && nodes.some(c => c.parent_id === n.id && directions[c.id] === "right"),
          hasLeftChildren:  isRoot && nodes.some(c => c.parent_id === n.id && directions[c.id] === "left"),
          isRoot, direction: dir,
          isDropTarget: n.id === dropTargetId,
          isSelected:   selectedIds.has(n.id),
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          linkedMapId: n.linked_map_id ?? null,
          // PDF
          pdfUrl:      n.pdf_url      ?? null,
          pdfFilename: n.pdf_filename ?? null,
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
          // PDF 操作
          onUploadPdf:      ()  => handleUploadPdfClick(n.id),
          onDeletePdf:      ()  => handleDeletePdf(n.id),
          onOpenSlideshow:  ()  => handleOpenSlideshow(n.id),
          onEditStart: () => setEditingId(n.id),
          onEditEnd:   () => setEditingId(null),
        },
      };
    }));

    setRfEdges(nodes.filter(n => n.parent_id).map(n => {
      const isLeft = (directions[n.id] ?? "right") === "left";
      return { id: `e-${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id, sourceHandle: isLeft ? "sl" : "sr", targetHandle: isLeft ? "tr" : "tl", type: "wmEdge", style: EDGE_STYLE, hidden: hiddenIds.has(n.id) };
    }));
  }, [nodes, selectedIds, dropTargetId, layoutMode, handleContentChange, toggleCollapse, addChild, addSibling, toggleFormat, setColor, onRequestTemplateInsert, onRequestMapLink]);

  // ─── ドラッグ & ドロップ ─────────────────────────────────

  const handleNodeDrag = useCallback((event, draggedNode) => {
    const allRfNodes = getNodes();
    const draggingIds = selectedIds.size > 1 ? selectedIds : new Set([draggedNode.id]);
    const target = findDropTarget(draggedNode, allRfNodes, draggingIds);
    const descendants = new Set(getDescendantIds(draggedNode.id, nodes));
    const validTarget = target && !descendants.has(target.id) ? target.id : null;
    if (validTarget !== dropTargetId) setDropTargetId(validTarget);
  }, [getNodes, selectedIds, nodes, dropTargetId]);

  const handleNodeDragStop = useCallback(async (event, draggedNode) => {
    setDropTargetId(null);
    const allRfNodes  = getNodes();
    const draggingIds = selectedIds.size > 1 ? selectedIds : new Set([draggedNode.id]);
    const target      = findDropTarget(draggedNode, allRfNodes, draggingIds);
    if (!target) {
      const { positions } = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position }))); return;
    }
    const allDescendants = new Set();
    for (const id of draggingIds) for (const d of getDescendantIds(id, nodes)) allDescendants.add(d);
    if (allDescendants.has(target.id)) {
      showToast("子孫ノードには移動できません", "error");
      const { positions } = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position }))); return;
    }
    const toMove = [...draggingIds].filter(id => {
      const node = nodes.find(n => n.id === id); if (!node) return false;
      let cur = node;
      while (cur.parent_id) { if (draggingIds.has(cur.parent_id)) return false; cur = nodes.find(n => n.id === cur.parent_id) ?? { parent_id: null }; }
      return true;
    });
    let updatedNodes = [...nodes];
    for (const nodeId of toMove) {
      const existingSiblings = updatedNodes.filter(n => n.parent_id === target.id);
      const newOrder = existingSiblings.length > 0 ? Math.max(...existingSiblings.map(n => n.order_index)) + 1024 : 1024;
      await updateNode(nodeId, { parent_id: target.id, order_index: newOrder });
      updatedNodes = updatedNodes.map(n => n.id === nodeId ? { ...n, parent_id: target.id, order_index: newOrder } : n);
    }
    onNodesChange(updatedNodes); onSaved();
    if (toMove.length > 0) showToast(`${toMove.length}ノードを移動しました`);
  }, [getNodes, selectedIds, nodes, layoutMode, onNodesChange, onSaved, setRfNodes]);

  const handleNodeClick = useCallback((e, node) => {
    if (e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
      setSelectedId(node.id);
    } else { setSelectedId(node.id); setSelectedIds(new Set([node.id])); }
  }, []);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    if (selectedNodes.length > 1) {
      const ids = new Set(selectedNodes.map(n => n.id));
      setSelectedIds(ids);
      if (!ids.has(selectedId)) setSelectedId(selectedNodes[0]?.id ?? null);
    }
  }, [selectedId]);

  const handlePaneClick = useCallback(() => {
    if (!editingId) { setSelectedId(null); setSelectedIds(new Set()); }
  }, [editingId]);

  const toastBg = toastType === "error" ? "rgba(220,38,38,0.9)" : "rgba(30,30,40,0.85)";

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px)", position: "relative" }}>
      {/* 非表示ファイルインプット（PDF アップロード用） */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <ReactFlow
        key={layoutMode}
        nodes={rfNodes} edges={rfEdges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        onNodeDrag={handleNodeDrag} onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick} onSelectionChange={handleSelectionChange} onPaneClick={handlePaneClick}
        nodesDraggable={true} nodesConnectable={false} elementsSelectable={true}
        multiSelectionKeyCode="Shift" selectionOnDrag={true}
        deleteKeyCode={null} panOnScroll={true} panOnDrag={false}
        fitView fitViewOptions={{ padding: 0.35 }} minZoom={0.2} maxZoom={2}
        style={{ background: "#eef0f6" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#c7cade" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selectedIds.size > 1 && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(168,85,247,0.9)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, pointerEvents: "none" }}>
          {selectedIds.size}ノード選択中 — ドラッグで一括移動、Del で削除
        </div>
      )}
      {toastMsg && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: toastBg, color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, pointerEvents: "none", whiteSpace: "nowrap" }}>{toastMsg}</div>
      )}
      <div style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#94a3b8", lineHeight: 1.9, pointerEvents: "none" }}>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟追加 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加 ・ <b style={{color:"#6b7280"}}>📎</b> PDF添付</div>
        <div><b style={{color:"#6b7280"}}>Shift+クリック</b> or <b style={{color:"#6b7280"}}>ドラッグ</b> 範囲選択</div>
        <div>ダブルクリック or 追加で即編集 ・ 📄でスライドショー起動</div>
      </div>
    </div>
  );
}
