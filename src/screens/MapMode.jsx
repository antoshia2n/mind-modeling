import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState, Position, useReactFlow, BaseEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, deleteNode, restoreNode, uploadPdf, deletePdf } from "../lib/supabase.js";
import { calcLayout, NODE_HEIGHT } from "../lib/layout.js";
import { navigate } from "../lib/navigate.js";
import MmNode from "./MmNode.jsx";

// ─── Whimsical 風カスタムエッジ ─────────────────────────────

/**
 * Whimsical 正解エッジ：S字ベジェ
 * - 両端が水平接線になる Cubic Bezier
 * - 制御点距離 = 水平距離の50%
 * - これが Whimsical のエッジ公式
 */
function WmEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, style }) {
  const isVertical = sourcePosition === Position.Bottom || sourcePosition === Position.Top;
  let d;

  if (isVertical) {
    // 上下モード：垂直S字ベジェ
    const dy = Math.abs(targetY - sourceY);
    const cp = Math.max(24, dy * 0.5);
    d = `M ${sourceX},${sourceY} C ${sourceX},${sourceY + cp} ${targetX},${targetY - cp} ${targetX},${targetY}`;
  } else {
    // 左右モード：水平S字ベジェ（Whimsical正解）
    const isLeft = sourcePosition === Position.Left;
    const dx     = Math.abs(targetX - sourceX);
    const cp     = Math.max(20, dx * 0.5);
    if (isLeft) {
      d = `M ${sourceX},${sourceY} C ${sourceX - cp},${sourceY} ${targetX + cp},${targetY} ${targetX},${targetY}`;
    } else {
      d = `M ${sourceX},${sourceY} C ${sourceX + cp},${sourceY} ${targetX - cp},${targetY} ${targetX},${targetY}`;
    }
  }
  return <BaseEdge id={id} path={d} style={style} />;
}

const nodeTypes = { mmNode: MmNode };
const edgeTypes = { wmEdge: WmEdge };
const EDGE_STYLE  = { stroke: "#a855f7", strokeWidth: 1.5, fill: "none" };
const DEBOUNCE_MS = 800;
const FOCUS_EVENT = "mm-focus-node";
const PDF_MAX_MB  = 20;
const MAX_HISTORY = 40;

function fireNodeFocus(nodeId) {
  setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { nodeId } })), 80);
}

function getDescendantIds(nodeId, nodes) {
  const r = [];
  for (const n of nodes) { if (n.parent_id === nodeId) { r.push(n.id); r.push(...getDescendantIds(n.id, nodes)); } }
  return r;
}
function getHiddenIds(nodes) {
  const h = new Set();
  for (const n of nodes) { if (n.collapsed) for (const id of getDescendantIds(n.id, nodes)) h.add(id); }
  return h;
}
function findDropTarget(dragged, allRfNodes, excludeIds) {
  const dw = dragged.measured?.width ?? 140, dh = dragged.measured?.height ?? 36;
  const cx = dragged.position.x + dw / 2, cy = dragged.position.y + dh / 2;
  let best = null, bestArea = 0;
  for (const n of allRfNodes) {
    if (excludeIds.has(n.id) || n.hidden) continue;
    const nw = n.measured?.width ?? 140, nh = n.measured?.height ?? 36;
    if (cx >= n.position.x && cx <= n.position.x + nw && cy >= n.position.y && cy <= n.position.y + nh) {
      const a = nw * nh; if (a > bestArea) { best = n; bestArea = a; }
    }
  }
  return best;
}

/**
 * undo 用：スナップショットの差分を Supabase に適用する
 * - 削除されたノード → restoreNode（depth 順）
 * - 追加されたノード → deleteNode
 * - 変更されたノード → updateNode
 */
async function applySnapshot(targetNodes, currentNodes) {
  const FIELDS = ['content','parent_id','order_index','collapsed','bold','italic','strikethrough','text_color','node_color','linked_map_id','pdf_url','pdf_filename'];
  const curMap = new Map(currentNodes.map(n => [n.id, n]));
  const tgtMap = new Map(targetNodes.map(n => [n.id, n]));

  // 追加されたノードを削除（undo で取り消す）
  for (const n of currentNodes) { if (!tgtMap.has(n.id)) await deleteNode(n.id).catch(() => {}); }

  // 削除されたノードを復元（depth 順で insert）
  const toRestore = targetNodes.filter(n => !curMap.has(n.id));
  const depth = (id, visited = new Set()) => {
    if (visited.has(id)) return 0; visited.add(id);
    const nd = tgtMap.get(id);
    return nd?.parent_id ? 1 + depth(nd.parent_id, visited) : 0;
  };
  toRestore.sort((a, b) => depth(a.id) - depth(b.id));
  for (const n of toRestore) await restoreNode(n).catch(() => {});

  // 変更されたノードを更新
  for (const tgt of targetNodes) {
    const cur = curMap.get(tgt.id);
    if (!cur) continue;
    const updates = {};
    for (const f of FIELDS) { if (tgt[f] !== cur[f]) updates[f] = tgt[f]; }
    if (Object.keys(updates).length) await updateNode(tgt.id, updates).catch(() => {});
  }
}

export default function MapMode({ uid, mapId, nodes, layoutMode = "bi", onNodesChange, onSaved, onRequestTemplateInsert, onRequestMapLink, onRootLabelChange }) {
  const { getNodes, fitView } = useReactFlow();
  const saveTimers   = useRef({});
  const fileInputRef = useRef(null);
  const uploadNodeId = useRef(null);

  // ─── 2パスレイアウト補正 ──────────────────────────────────
  // 1パス目：推定幅で仮配置 → react-flow が実際の幅を計測
  // 2パス目：実測幅で再配置 → 重なり解消
  const layoutCorrected = useRef(false);
  const layoutStructKey = useRef("");

  // ─── Undo/Redo 履歴 ────────────────────────────────────────
  const historyRef   = useRef([]);   // スナップショットの配列
  const historyIdxRef = useRef(-1);  // 現在位置
  const isUndoingRef = useRef(false);

  function saveHistory() {
    if (isUndoingRef.current) return;
    const snap = nodes.map(n => ({ ...n }));
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
  }

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

  // ─── Undo / Redo ──────────────────────────────────────────

  const undo = useCallback(async () => {
    if (historyIdxRef.current <= 0) { showToast("これ以上取り消せません"); return; }
    isUndoingRef.current = true;
    const targetSnap = historyRef.current[historyIdxRef.current - 1];
    showToast("⏪ 取り消し中...");
    await applySnapshot(targetSnap, nodes);
    historyIdxRef.current--;
    onNodesChange(targetSnap);
    onSaved();
    isUndoingRef.current = false;
    showToast("⏪ 取り消しました");
  }, [nodes, onNodesChange, onSaved]);

  const redo = useCallback(async () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) { showToast("これ以上やり直せません"); return; }
    isUndoingRef.current = true;
    const targetSnap = historyRef.current[historyIdxRef.current + 1];
    showToast("⏩ やり直し中...");
    await applySnapshot(targetSnap, nodes);
    historyIdxRef.current++;
    onNodesChange(targetSnap);
    onSaved();
    isUndoingRef.current = false;
    showToast("⏩ やり直しました");
  }, [nodes, onNodesChange, onSaved]);

  // ─── PDF 操作 ─────────────────────────────────────────────

  const handleUploadPdfClick = useCallback((nodeId) => {
    uploadNodeId.current = nodeId;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]; const nodeId = uploadNodeId.current;
    e.target.value = "";
    if (!file || !nodeId) return;
    if (file.type !== "application/pdf") { showToast("PDF ファイルのみアップロードできます", "error"); return; }
    if (file.size > PDF_MAX_MB * 1024 * 1024) { showToast(`ファイルサイズは ${PDF_MAX_MB}MB 以内にしてください`, "error"); return; }
    showToast("📄 アップロード中...");
    const existingNode = nodes.find(n => n.id === nodeId);
    if (existingNode?.pdf_url) await deletePdf(existingNode.pdf_url).catch(() => {});
    const path = await uploadPdf(uid, nodeId, file);
    if (!path) { showToast("アップロードに失敗しました", "error"); return; }
    saveHistory();
    await updateNode(nodeId, { pdf_url: path, pdf_filename: file.name });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, pdf_url: path, pdf_filename: file.name } : n));
    onSaved(); showToast(`✓ PDF を添付しました（${file.name}）`);
  }, [nodes, uid, onNodesChange, onSaved]);

  const handleDeletePdf = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node?.pdf_url) return;
    if (!window.confirm("添付された PDF を削除しますか？")) return;
    saveHistory();
    await deletePdf(node.pdf_url).catch(() => {});
    await updateNode(nodeId, { pdf_url: null, pdf_filename: null });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, pdf_url: null, pdf_filename: null } : n));
    onSaved(); showToast("PDF を削除しました");
  }, [nodes, onNodesChange, onSaved]);

  const handleOpenSlideshow = useCallback((nodeId) => window.open(`/slideshow/${nodeId}`, "_blank"), []);

  // ─── ノード操作 ───────────────────────────────────────────

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, content: value } : n));
    // ルートノードの場合、タイトルも同期
    const node = nodes.find(n => n.id === nodeId);
    if (node && !node.parent_id) onRootLabelChange?.(value);
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => { await updateNode(nodeId, { content: value }); onSaved(); }, DEBOUNCE_MS);
  }, [nodes, onNodesChange, onSaved, onRootLabelChange]);

  const addSibling = useCallback(async (nodeId, pos = "after") => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    let newOrder;
    if (pos === "after") {
      newOrder = ci === siblings.length - 1 ? (siblings[ci]?.order_index ?? 0) + 1024
        : siblings[ci].order_index + Math.max(1, Math.floor((siblings[ci+1].order_index - siblings[ci].order_index) / 2));
    } else {
      newOrder = ci === 0 ? Math.max(1, siblings[0].order_index - 512)
        : siblings[ci-1].order_index + Math.max(1, Math.floor((siblings[ci].order_index - siblings[ci-1].order_index) / 2));
    }
    saveHistory();
    const newNode = await createNode(uid, mapId, node.parent_id, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const children = nodes.filter(n => n.parent_id === nodeId);
    const newOrder = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    saveHistory();
    const newNode = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const removeSelectedNodes = useCallback(async () => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : (selectedId ? [selectedId] : []);
    if (!ids.length || nodes.length <= ids.length) return;
    const all = new Set(ids);
    for (const id of ids) for (const d of getDescendantIds(id, nodes)) all.add(d);
    saveHistory();
    for (const id of ids) await deleteNode(id).catch(() => {});
    onNodesChange(nodes.filter(n => !all.has(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
    if (ids.length > 1) showToast(`${ids.length}ノードを削除しました`);
  }, [nodes, selectedId, selectedIds, onNodesChange, onSaved]);

  const toggleCollapse = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const v = !node.collapsed;
    saveHistory();
    await updateNode(nodeId, { collapsed: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, collapsed: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const toggleFormat = useCallback(async (nodeId, field) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const v = !node[field];
    saveHistory();
    await updateNode(nodeId, { [field]: v });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, [field]: v } : n)); onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const setColor = useCallback(async (nodeId, field, value) => {
    saveHistory();
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
    saveHistory();
    await Promise.all([updateNode(nodeId, { order_index: t.order_index }), updateNode(t.id, { order_index: node.order_index })]);
    onNodesChange(nodes.map(n => {
      if (n.id === nodeId) return { ...n, order_index: t.order_index };
      if (n.id === t.id)   return { ...n, order_index: node.order_index };
      return n;
    })); onSaved(); showToast("順序を変更しました");
  }, [nodes, onNodesChange, onSaved]);

  const moveSelection = useCallback((nodeId, dir) => {
    const node = nodes.find(n => n.id === nodeId); if (!node) return;
    const hidden = getHiddenIds(nodes);
    if (dir === "right") {
      const ch = nodes.filter(n => n.parent_id === nodeId && !hidden.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      if (ch.length > 0) { setSelectedId(ch[0].id); setSelectedIds(new Set([ch[0].id])); }
    } else if (dir === "left") {
      if (node.parent_id) { setSelectedId(node.parent_id); setSelectedIds(new Set([node.parent_id])); }
    } else {
      const siblings = nodes.filter(n => n.parent_id === node.parent_id && !hidden.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      const ci = siblings.findIndex(n => n.id === nodeId);
      let next = null;
      if (dir === "up"   && ci > 0)                   next = siblings[ci-1].id;
      if (dir === "down" && ci < siblings.length - 1) next = siblings[ci+1].id;
      if (next) { setSelectedId(next); setSelectedIds(new Set([next])); }
    }
  }, [nodes]);

  const copySubtree = useCallback(async (nodeId) => {
    const result = [];
    function dfs(id, pi) {
      const node = nodes.find(n => n.id === id); if (!node) return;
      const mi = result.length;
      result.push({ content: node.content ?? "", parentIdx: pi, bold: node.bold ?? false, italic: node.italic ?? false, strikethrough: node.strikethrough ?? false, text_color: node.text_color ?? null, node_color: node.node_color ?? null });
      nodes.filter(n => n.parent_id === id).sort((a, b) => a.order_index - b.order_index).forEach(c => dfs(c.id, mi));
    }
    dfs(nodeId, -1);
    try { await navigator.clipboard.writeText(JSON.stringify({ mmCopy: true, nodes: result })); showToast(`${result.length}ノードをコピーしました`); }
    catch { showToast("クリップボードの許可が必要です", "error"); }
  }, [nodes]);

  const pasteSubtree = useCallback(async (parentId) => {
    let text; try { text = await navigator.clipboard.readText(); } catch { showToast("クリップボードの許可が必要です", "error"); return; }
    let payload; try { payload = JSON.parse(text); } catch { return; }
    if (!payload?.mmCopy || !Array.isArray(payload.nodes)) return;
    saveHistory();
    const idMap = {}, newNodes = [];
    for (let i = 0; i < payload.nodes.length; i++) {
      const { content, parentIdx, bold, italic, strikethrough, text_color, node_color } = payload.nodes[i];
      const aId = parentIdx === -1 ? parentId : idMap[parentIdx];
      const cur = [...nodes, ...newNodes], sib = cur.filter(n => n.parent_id === aId);
      const newOrder = sib.length > 0 ? Math.max(...sib.map(n => n.order_index)) + 1024 : 1024;
      const nn = await createNode(uid, mapId, aId, newOrder, content, { bold, italic, strikethrough, text_color, node_color });
      if (!nn) continue;
      idMap[i] = nn.id; newNodes.push(nn);
    }
    onNodesChange([...nodes, ...newNodes]); onSaved();
    if (newNodes.length > 0) { setSelectedId(newNodes[0].id); setSelectedIds(new Set([newNodes[0].id])); showToast(`${newNodes.length}ノードをペーストしました`); }
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  // ─── キーボードショートカット ────────────────────────────

  useEffect(() => {
    function handleKeyDown(e) {
      if (document.activeElement?.tagName === "INPUT") return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod   = isMac ? e.metaKey : e.ctrlKey;
      // Undo / Redo（最優先）
      if (e.key === "z" && mod && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((e.key === "z" && mod && e.shiftKey) || (e.key === "y" && mod)) { e.preventDefault(); redo(); return; }

      const sid = selectedId;
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
  }, [selectedId, selectedIds, undo, redo, addSibling, addChild, toggleCollapse, removeSelectedNodes, moveSelection, copySubtree, pasteSubtree, toggleFormat, reorderSibling]);

  // ─── rfNodes / rfEdges 同期（1パス目：推定幅で配置）──────

  useEffect(() => {
    // 構造キーが変わったら補正フラグをリセット
    const structKey = nodes.map(n => n.id + n.parent_id).join(',') + layoutMode;
    if (layoutStructKey.current !== structKey) {
      layoutStructKey.current = structKey;
      layoutCorrected.current = false;
    }

    const { positions, directions } = calcLayout(nodes, layoutMode);
    const hiddenIds = getHiddenIds(nodes);
    const rootIds   = new Set(nodes.filter(n => !n.parent_id).map(n => n.id));
    const isTb      = layoutMode === "tb";

    setRfNodes(nodes.map(n => {
      const dir    = directions[n.id] ?? "right";
      const isLeft = dir === "left";
      const isRoot = rootIds.has(n.id);
      // 上下モードの Handle 位置
      const srcPos = isTb ? Position.Bottom : (isLeft ? Position.Left  : Position.Right);
      const tgtPos = isTb ? Position.Top    : (isLeft ? Position.Right : Position.Left);
      return {
        id: n.id, position: positions[n.id] ?? { x: 0, y: 0 },
        type: "mmNode", hidden: hiddenIds.has(n.id),
        selected: selectedIds.has(n.id),
        sourcePosition: srcPos, targetPosition: tgtPos,
        data: {
          nodeId: n.id, label: n.content ?? "", collapsed: n.collapsed,
          hasChildren:      nodes.some(c => c.parent_id === n.id),
          hasRightChildren: isRoot && !isTb && nodes.some(c => c.parent_id === n.id && directions[c.id] === "right"),
          hasLeftChildren:  isRoot && !isTb && nodes.some(c => c.parent_id === n.id && directions[c.id] === "left"),
          isRoot, direction: dir, layoutMode,
          isDropTarget: n.id === dropTargetId,
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          linkedMapId: n.linked_map_id ?? null,
          pdfUrl: n.pdf_url ?? null, pdfFilename: n.pdf_filename ?? null,
          onContentChange:       (v)  => handleContentChange(n.id, v),
          onToggleCollapse:      ()   => toggleCollapse(n.id),
          onAddChild:            ()   => addChild(n.id),
          onAddSiblingAbove:     ()   => addSibling(n.id, "before"),
          onAddSiblingBelow:     ()   => addSibling(n.id, "after"),
          onToggleBold:          ()   => toggleFormat(n.id, "bold"),
          onToggleItalic:        ()   => toggleFormat(n.id, "italic"),
          onToggleStrikethrough: ()   => toggleFormat(n.id, "strikethrough"),
          onTextColorChange:     (c)  => setColor(n.id, "text_color", c),
          onNodeColorChange:     (c)  => setColor(n.id, "node_color", c),
          onInsertTemplate:      ()   => onRequestTemplateInsert?.(n.id),
          onMapLink:             ()   => onRequestMapLink?.(n.id, n.linked_map_id),
          onNavigateLink:        ()   => { if (n.linked_map_id) navigate(`/m/${n.linked_map_id}`); },
          onUploadPdf:           ()   => handleUploadPdfClick(n.id),
          onDeletePdf:           ()   => handleDeletePdf(n.id),
          onOpenSlideshow:       ()   => handleOpenSlideshow(n.id),
          onEditStart: () => setEditingId(n.id),
          onEditEnd:   () => setEditingId(null),
        },
      };
    }));

    setRfEdges(nodes.filter(n => n.parent_id).map(n => {
      const dir    = directions[n.id] ?? "right";
      const isLeft = dir === "left";
      const srcHandle = isTb ? "sb" : (isLeft ? "sl" : "sr");
      const tgtHandle = isTb ? "tt" : (isLeft ? "tr" : "tl");
      return { id: `e-${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id, sourceHandle: srcHandle, targetHandle: tgtHandle, type: "wmEdge", style: EDGE_STYLE, hidden: hiddenIds.has(n.id) };
    }));
  }, [nodes, selectedIds, dropTargetId, layoutMode, handleContentChange, toggleCollapse, addChild, addSibling, toggleFormat, setColor, onRequestTemplateInsert, onRequestMapLink, handleUploadPdfClick, handleDeletePdf, handleOpenSlideshow]);

  // ─── 2パス目：実測幅で再配置（重なり解消）─────────────────
  // react-flow がノードを描画・計測した後に rfNodes.measured.width が入る。
  // 全ノードの計測が完了したら実測幅で再計算し、精確な位置に更新する。

  useEffect(() => {
    if (layoutCorrected.current) return;
    if (rfNodes.length === 0) return;

    // 全ノードの計測が完了しているか確認
    const allMeasured = rfNodes.every(n => n.measured?.width && n.measured?.height);
    if (!allMeasured) return;

    layoutCorrected.current = true;

    // 実測幅のマップを作成
    const widths = {};
    for (const n of rfNodes) widths[n.id] = n.measured.width;

    // 実測幅で再計算
    const { positions } = calcLayout(nodes, layoutMode, widths);

    // 位置を更新（selection・data等は維持）
    setRfNodes(prev => prev.map(n => ({
      ...n,
      position: positions[n.id] ?? n.position,
    })));

    // ビューをフィット（位置更新後に少し待つ）
    setTimeout(() => fitView({ padding: 0.35, duration: 200 }), 80);
  }, [rfNodes]); // rfNodesが更新されるたびにチェック（measured.widthが入るまで）

  // ─── ドラッグ ────────────────────────────────────────────

  const handleNodeDrag = useCallback((event, draggedNode) => {
    const allRfNodes  = getNodes();
    const draggingIds = selectedIds.size > 1 ? selectedIds : new Set([draggedNode.id]);
    const target      = findDropTarget(draggedNode, allRfNodes, draggingIds);
    const descs       = new Set(getDescendantIds(draggedNode.id, nodes));
    const valid       = target && !descs.has(target.id) ? target.id : null;
    if (valid !== dropTargetId) setDropTargetId(valid);
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
    const allDescs = new Set();
    for (const id of draggingIds) for (const d of getDescendantIds(id, nodes)) allDescs.add(d);
    if (allDescs.has(target.id)) {
      showToast("子孫ノードには移動できません", "error");
      const { positions } = calcLayout(nodes, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position }))); return;
    }
    const toMove = [...draggingIds].filter(id => {
      const nd = nodes.find(n => n.id === id); if (!nd) return false;
      let cur = nd;
      while (cur.parent_id) { if (draggingIds.has(cur.parent_id)) return false; cur = nodes.find(n => n.id === cur.parent_id) ?? { parent_id: null }; }
      return true;
    });
    saveHistory();
    let updated = [...nodes];
    for (const nodeId of toMove) {
      const sib = updated.filter(n => n.parent_id === target.id);
      const newOrder = sib.length > 0 ? Math.max(...sib.map(n => n.order_index)) + 1024 : 1024;
      await updateNode(nodeId, { parent_id: target.id, order_index: newOrder });
      updated = updated.map(n => n.id === nodeId ? { ...n, parent_id: target.id, order_index: newOrder } : n);
    }
    onNodesChange(updated); onSaved();
    if (toMove.length > 0) showToast(`${toMove.length}ノードを移動しました`);
  }, [getNodes, selectedIds, nodes, layoutMode, onNodesChange, onSaved, setRfNodes]);

  const handleNodeClick = useCallback((e, node) => {
    if (e.shiftKey) {
      setSelectedIds(prev => { const next = new Set(prev); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; });
      setSelectedId(node.id);
    } else { setSelectedId(node.id); setSelectedIds(new Set([node.id])); }
  }, []);

  const handleSelectionChange = useCallback(({ nodes: sel }) => {
    if (sel.length > 1) {
      const ids = new Set(sel.map(n => n.id));
      setSelectedIds(ids);
      if (!ids.has(selectedId)) setSelectedId(sel[0]?.id ?? null);
    }
  }, [selectedId]);

  const handlePaneClick = useCallback(() => {
    if (!editingId) { setSelectedId(null); setSelectedIds(new Set()); }
  }, [editingId]);

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px)", position: "relative" }}>
      <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={handleFileChange} />

      <ReactFlow key={layoutMode} nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        onNodeDrag={handleNodeDrag} onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick} onSelectionChange={handleSelectionChange} onPaneClick={handlePaneClick}
        nodesDraggable={true} nodesConnectable={false} elementsSelectable={true}
        multiSelectionKeyCode="Shift" selectionOnDrag={true}
        deleteKeyCode={null} panOnScroll={true} panOnDrag={false}
        fitView fitViewOptions={{ padding: 0.35 }} minZoom={0.2} maxZoom={2}
        style={{ background: "#f8fafc" }}>
        <Background variant={BackgroundVariant.Dots} color="#d4d8e1" gap={24} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {selectedIds.size > 1 && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(168,85,247,0.9)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 600, pointerEvents: "none" }}>
          {selectedIds.size}ノード選択中 — ドラッグで移動・Del で削除
        </div>
      )}
      {toastMsg && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: toastType === "error" ? "rgba(220,38,38,0.9)" : "rgba(30,30,40,0.85)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, pointerEvents: "none", whiteSpace: "nowrap" }}>{toastMsg}</div>
      )}
      <div style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#94a3b8", lineHeight: 1.9, pointerEvents: "none" }}>
        <div><b style={{color:"#6b7280"}}>⌘Z</b> 取り消し ・ <b style={{color:"#6b7280"}}>⌘⇧Z</b> やり直し</div>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加 ・ <b style={{color:"#6b7280"}}>📎</b> PDF</div>
        <div>ダブルクリックで編集 ・ 📄でスライドショー</div>
      </div>
    </div>
  );
}
