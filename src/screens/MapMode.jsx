import { useEffect, useRef, useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant,
  useNodesState, useEdgesState, Position, useReactFlow, BaseEdge, useViewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, deleteNode, restoreNode, uploadPdf, deletePdf } from "../lib/supabase.js";
import { calcLayout, NODE_HEIGHT } from "../lib/layout.js";
import { navigate } from "../lib/navigate.js";
import MmNode from "./MmNode.jsx";

// ─── Whimsical 風カスタムエッジ ─────────────────────────────

function WmEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, style }) {
  const isVertical = sourcePosition === Position.Bottom || sourcePosition === Position.Top;
  let d;
  if (isVertical) {
    const dy = Math.abs(targetY - sourceY);
    const cp = Math.max(24, dy * 0.5);
    d = `M ${sourceX},${sourceY} C ${sourceX},${sourceY + cp} ${targetX},${targetY - cp} ${targetX},${targetY}`;
  } else {
    const isLeft = sourcePosition === Position.Left;
    const dx = Math.abs(targetX - sourceX);
    const cp = Math.max(20, dx * 0.5);
    d = isLeft
      ? `M ${sourceX},${sourceY} C ${sourceX - cp},${sourceY} ${targetX + cp},${targetY} ${targetX},${targetY}`
      : `M ${sourceX},${sourceY} C ${sourceX + cp},${sourceY} ${targetX - cp},${targetY} ${targetX},${targetY}`;
  }
  return <BaseEdge id={id} path={d} style={style} />;
}

// ─── 挿入ライン（Zone-based ドラッグ のビジュアルフィードバック）

function InsertionLineOverlay({ hint }) {
  const { x: vx, y: vy, zoom } = useViewport();
  if (!hint) return null;

  const sx  = hint.lineX * zoom + vx;
  const sy  = hint.lineY * zoom + vy;
  const sw  = Math.max(24, hint.lineW * zoom);
  const DOT = 8;

  const lineStyle = {
    position: "absolute", left: sx, top: sy,
    transform: "translateY(-50%)",
    display: "flex", alignItems: "center",
    pointerEvents: "none", zIndex: 200,
  };

  if (hint.type === "firstChild") {
    // 子挿入：L字インジケーター
    return (
      <div style={{ position: "absolute", left: sx, top: sy, pointerEvents: "none", zIndex: 200 }}>
        <div style={{ width: DOT, height: DOT, borderRadius: "50%", background: "#a855f7", position: "absolute", top: -DOT / 2, left: 0 }} />
        <div style={{ width: sw, height: 2, background: "#a855f7", borderRadius: 1 }} />
        <div style={{ position: "absolute", right: 0, top: -DOT / 2, width: DOT, height: DOT, borderRadius: "50%", background: "#a855f7", opacity: 0.5 }} />
      </div>
    );
  }

  // 兄弟挿入：水平ライン + 左端ドット
  return (
    <div style={lineStyle}>
      <div style={{ width: DOT, height: DOT, borderRadius: "50%", background: "#a855f7", flexShrink: 0 }} />
      <div style={{ width: sw, height: 2, background: "#a855f7", borderRadius: "0 1px 1px 0", marginLeft: -1 }} />
    </div>
  );
}

// ─── Zone-based ドラッグ: 挿入ゾーン検出 ─────────────────────
// ノードの上半・下半・右側に入ったとき、それぞれ
//   before / after / firstChild を返す

const CHILD_ZONE_W  = 80;   // ノード右端からの子挿入ゾーン幅
const DETECT_RADIUS = 80;   // 検出最大距離（canvas px）

function findInsertZone(dragged, allRfNodes, nodes) {
  const dw  = dragged.measured?.width  ?? 100;
  const dh  = dragged.measured?.height ?? 28;
  const dcx = dragged.position.x + dw / 2;
  const dcy = dragged.position.y + dh / 2;

  let best = null;
  let bestScore = DETECT_RADIUS;

  for (const rfn of allRfNodes) {
    if (rfn.id === dragged.id || rfn.hidden) continue;

    const nw = rfn.measured?.width  ?? 100;
    const nh = rfn.measured?.height ?? 28;
    const nx = rfn.position.x;
    const ny = rfn.position.y;
    const ncx = nx + nw / 2;

    // 水平方向が近いノードのみ対象
    if (Math.abs(dcx - ncx) > nw + CHILD_ZONE_W + 40) continue;

    // ─ 子挿入ゾーン（ノード右端から CHILD_ZONE_W 以内）
    const rightEdge = nx + nw;
    if (dragged.position.x > rightEdge - 20 && dragged.position.x < rightEdge + CHILD_ZONE_W) {
      const dist = Math.hypot(dragged.position.x - rightEdge, dcy - (ny + nh / 2));
      if (dist < bestScore) {
        bestScore = dist;
        best = { type: "firstChild", targetNodeId: rfn.id, lineX: rightEdge + 6, lineY: ny + nh / 2, lineW: 40 };
      }
    }

    // ─ 上ゾーン（ノードの上端付近 → before）
    const topDist = Math.abs(dcy - ny);
    if (topDist < bestScore && Math.abs(dcx - ncx) < nw + 30) {
      bestScore = topDist;
      best = { type: "before", targetNodeId: rfn.id, lineX: nx - 4, lineY: ny - 2, lineW: nw + 8 };
    }

    // ─ 下ゾーン（ノードの下端付近 → after）
    const botDist = Math.abs(dcy - (ny + nh));
    if (botDist < bestScore && Math.abs(dcx - ncx) < nw + 30) {
      bestScore = botDist;
      best = { type: "after", targetNodeId: rfn.id, lineX: nx - 4, lineY: ny + nh + 2, lineW: nw + 8 };
    }
  }

  return best;
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
  const FIELDS = ['content','parent_id','order_index','collapsed','bold','italic','strikethrough','text_color','node_color','linked_map_id','pdf_url','pdf_filename','link_url'];
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

  // ─── nodesRef：コールバックを安定化するためのRef ─────────────
  // nodes を ref に同期し、useCallback の deps から除外する。
  // これにより全コールバックが stable（再生成なし）になる。
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // ─── 2パスレイアウト補正 ──────────────────────────────────
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
  const [selectedId,  setSelectedId]  = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingId,   setEditingId]   = useState(null);
  const [insertHint,  setInsertHint]  = useState(null); // zone-based ドラッグの挿入ヒント
  const [toastMsg,    setToastMsg]    = useState(null);
  const [toastType,   setToastType]   = useState("info");

  function showToast(msg, type = "info") {
    setToastMsg(msg); setToastType(type);
    setTimeout(() => setToastMsg(null), 2500);
  }

  // ─── Undo / Redo ──────────────────────────────────────────

  const undo = useCallback(async () => {
    if (historyIdxRef.current <= 0) { showToast("これ以上取り消せません"); return; }
    isUndoingRef.current = true;
    const targetSnap = historyRef.current[historyIdxRef.current - 1];
    showToast("取り消し中...");
    await applySnapshot(targetSnap, nodesRef.current);
    historyIdxRef.current--;
    onNodesChange(targetSnap); onSaved();
    isUndoingRef.current = false;
    showToast("取り消しました");
  }, [onNodesChange, onSaved]);

  const redo = useCallback(async () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) { showToast("これ以上やり直せません"); return; }
    isUndoingRef.current = true;
    const targetSnap = historyRef.current[historyIdxRef.current + 1];
    showToast("やり直し中...");
    await applySnapshot(targetSnap, nodesRef.current);
    historyIdxRef.current++;
    onNodesChange(targetSnap); onSaved();
    isUndoingRef.current = false;
    showToast("やり直しました");
  }, [onNodesChange, onSaved]);

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
    showToast("PDF アップロード中...");
    const ns = nodesRef.current;
    const existingNode = ns.find(n => n.id === nodeId);
    if (existingNode?.pdf_url) await deletePdf(existingNode.pdf_url).catch(() => {});
    const path = await uploadPdf(uid, nodeId, file);
    if (!path) { showToast("アップロードに失敗しました", "error"); return; }
    saveHistory();
    await updateNode(nodeId, { pdf_url: path, pdf_filename: file.name });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, pdf_url: path, pdf_filename: file.name } : n));
    onSaved(); showToast(`✓ PDF を添付しました（${file.name}）`);
  }, [uid, onNodesChange, onSaved]);

  const handleDeletePdf = useCallback(async (nodeId) => {
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node?.pdf_url) return;
    if (!window.confirm("添付された PDF を削除しますか？")) return;
    saveHistory();
    await deletePdf(node.pdf_url).catch(() => {});
    await updateNode(nodeId, { pdf_url: null, pdf_filename: null });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, pdf_url: null, pdf_filename: null } : n));
    onSaved(); showToast("PDF を削除しました");
  }, [onNodesChange, onSaved]);

  const handleOpenSlideshow = useCallback((nodeId) => window.open(`/slideshow/${nodeId}`, "_blank"), []);

  // ─── ノード操作（全て nodesRef.current ベース→deps最小化）──

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, content: value } : n));
    const node = nodesRef.current.find(n => n.id === nodeId);
    if (node && !node.parent_id) onRootLabelChange?.(value);
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => { await updateNode(nodeId, { content: value }); onSaved(); }, DEBOUNCE_MS);
  }, [onNodesChange, onSaved, onRootLabelChange]);

  const addSibling = useCallback(async (nodeId, pos = "after") => {
    const ns = nodesRef.current;
    const node = ns.find(n => n.id === nodeId); if (!node) return;
    const siblings = ns.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
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
    onNodesChange([...nodesRef.current, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [uid, mapId, onNodesChange, onSaved]);

  const addChild = useCallback(async (nodeId) => {
    const ns = nodesRef.current;
    const children = ns.filter(n => n.parent_id === nodeId);
    const newOrder = children.length > 0 ? Math.max(...children.map(n => n.order_index)) + 1024 : 1024;
    saveHistory();
    const newNode = await createNode(uid, mapId, nodeId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodesRef.current, newNode]); onSaved();
    setSelectedId(newNode.id); setSelectedIds(new Set([newNode.id]));
    fireNodeFocus(newNode.id);
  }, [uid, mapId, onNodesChange, onSaved]);

  const removeSelectedNodes = useCallback(async () => {
    const ns = nodesRef.current;
    const ids = selectedIds.size > 0 ? [...selectedIds] : (selectedId ? [selectedId] : []);
    if (!ids.length || ns.length <= ids.length) return;
    const all = new Set(ids);
    for (const id of ids) for (const d of getDescendantIds(id, ns)) all.add(d);
    saveHistory();
    for (const id of ids) await deleteNode(id).catch(() => {});
    onNodesChange(nodesRef.current.filter(n => !all.has(n.id)));
    onSaved(); setSelectedId(null); setSelectedIds(new Set());
    if (ids.length > 1) showToast(`${ids.length}ノードを削除しました`);
  }, [selectedId, selectedIds, onNodesChange, onSaved]);

  const toggleCollapse = useCallback(async (nodeId) => {
    const node = nodesRef.current.find(n => n.id === nodeId); if (!node) return;
    const v = !node.collapsed;
    saveHistory();
    await updateNode(nodeId, { collapsed: v });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, collapsed: v } : n)); onSaved();
  }, [onNodesChange, onSaved]);

  const toggleFormat = useCallback(async (nodeId, field) => {
    const node = nodesRef.current.find(n => n.id === nodeId); if (!node) return;
    const v = !node[field];
    saveHistory();
    await updateNode(nodeId, { [field]: v });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, [field]: v } : n)); onSaved();
  }, [onNodesChange, onSaved]);

  const setColor = useCallback(async (nodeId, field, value) => {
    saveHistory();
    await updateNode(nodeId, { [field]: value ?? null });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, [field]: value ?? null } : n)); onSaved();
  }, [onNodesChange, onSaved]);

  const reorderSibling = useCallback(async (nodeId, direction) => {
    const ns = nodesRef.current;
    const node = ns.find(n => n.id === nodeId); if (!node) return;
    const siblings = ns.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const ci = siblings.findIndex(n => n.id === nodeId);
    const ti = ci + direction;
    if (ti < 0 || ti >= siblings.length) return;
    const t = siblings[ti];
    saveHistory();
    await Promise.all([updateNode(nodeId, { order_index: t.order_index }), updateNode(t.id, { order_index: node.order_index })]);
    onNodesChange(nodesRef.current.map(n => {
      if (n.id === nodeId) return { ...n, order_index: t.order_index };
      if (n.id === t.id)   return { ...n, order_index: node.order_index };
      return n;
    })); onSaved(); showToast("順序を変更しました");
  }, [onNodesChange, onSaved]);

  const moveSelection = useCallback((nodeId, dir) => {
    const ns = nodesRef.current;
    const node = ns.find(n => n.id === nodeId); if (!node) return;
    const hidden = getHiddenIds(ns);
    if (dir === "right") {
      const ch = ns.filter(n => n.parent_id === nodeId && !hidden.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      if (ch.length > 0) { setSelectedId(ch[0].id); setSelectedIds(new Set([ch[0].id])); }
    } else if (dir === "left") {
      if (node.parent_id) { setSelectedId(node.parent_id); setSelectedIds(new Set([node.parent_id])); }
    } else {
      const siblings = ns.filter(n => n.parent_id === node.parent_id && !hidden.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      const ci = siblings.findIndex(n => n.id === nodeId);
      let next = null;
      if (dir === "up"   && ci > 0)                   next = siblings[ci-1].id;
      if (dir === "down" && ci < siblings.length - 1) next = siblings[ci+1].id;
      if (next) { setSelectedId(next); setSelectedIds(new Set([next])); }
    }
  }, []);

  const copySubtree = useCallback(async (nodeId) => {
    const ns = nodesRef.current;
    const result = [];
    function dfs(id, pi) {
      const node = ns.find(n => n.id === id); if (!node) return;
      const mi = result.length;
      result.push({ content: node.content ?? "", parentIdx: pi, bold: node.bold ?? false, italic: node.italic ?? false, strikethrough: node.strikethrough ?? false, text_color: node.text_color ?? null, node_color: node.node_color ?? null });
      ns.filter(n => n.parent_id === id).sort((a, b) => a.order_index - b.order_index).forEach(c => dfs(c.id, mi));
    }
    dfs(nodeId, -1);
    try { await navigator.clipboard.writeText(JSON.stringify({ mmCopy: true, nodes: result })); showToast(`${result.length}ノードをコピーしました`); }
    catch { showToast("クリップボードの許可が必要です", "error"); }
  }, []);

  const pasteSubtree = useCallback(async (parentId) => {
    let text; try { text = await navigator.clipboard.readText(); } catch { showToast("クリップボードの許可が必要です", "error"); return; }
    let payload; try { payload = JSON.parse(text); } catch { return; }
    if (!payload?.mmCopy || !Array.isArray(payload.nodes)) return;
    saveHistory();
    const idMap = {}, newNodes = [];
    for (let i = 0; i < payload.nodes.length; i++) {
      const { content, parentIdx, bold, italic, strikethrough, text_color, node_color } = payload.nodes[i];
      const aId = parentIdx === -1 ? parentId : idMap[parentIdx];
      const cur = [...nodesRef.current, ...newNodes], sib = cur.filter(n => n.parent_id === aId);
      const newOrder = sib.length > 0 ? Math.max(...sib.map(n => n.order_index)) + 1024 : 1024;
      const nn = await createNode(uid, mapId, aId, newOrder, content, { bold, italic, strikethrough, text_color, node_color });
      if (!nn) continue;
      idMap[i] = nn.id; newNodes.push(nn);
    }
    onNodesChange([...nodesRef.current, ...newNodes]); onSaved();
    if (newNodes.length > 0) { setSelectedId(newNodes[0].id); setSelectedIds(new Set([newNodes[0].id])); showToast(`${newNodes.length}ノードをペーストしました`); }
  }, [uid, mapId, onNodesChange, onSaved]);

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
          isDropTarget: false, // zone-based に変更のため常に false
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          linkedMapId: n.linked_map_id ?? null,
          linkUrl:     n.link_url       ?? null,
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
          onSetLinkUrl: () => {
            const current = nodesRef.current.find(nd => nd.id === n.id)?.link_url ?? "";
            const raw = window.prompt("URLを入力（空白で削除）:", current);
            if (raw === null) return;
            const cleaned = raw.trim();
            const finalUrl = cleaned === "" ? null : (cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
            updateNode(n.id, { link_url: finalUrl });
            onNodesChange(nodesRef.current.map(nd => nd.id === n.id ? { ...nd, link_url: finalUrl } : nd));
            onSaved();
          },
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
  // deps は nodes と layoutMode のみ。insertHint は別途管理。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, layoutMode]);

  // ─── 軽量：選択状態の更新（クリックのたびに全再構築しない）─

  useEffect(() => {
    setRfNodes(prev => prev.map(n => ({
      ...n,
      selected: selectedIds.has(n.id),
      data: { ...n.data, isSelected: selectedIds.has(n.id) },
    })));
  }, [selectedIds]);

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

  // ─── Zone-based ドラッグ ─────────────────────────────────
  // ノードのハイライトではなく「空間ゾーン」で挿入位置を決定する。
  // 挿入ラインが視覚的フィードバック（InsertionLineOverlay）。

  const insertHintRef = useRef(null); // setInsertHint と同期して使う

  const handleNodeDrag = useCallback((event, draggedNode) => {
    const allRfNodes = getNodes();
    const hint = findInsertZone(draggedNode, allRfNodes, nodesRef.current);

    // 子孫ノードへの挿入は禁止
    if (hint) {
      const descs = new Set(getDescendantIds(draggedNode.id, nodesRef.current));
      if (descs.has(hint.targetNodeId)) {
        insertHintRef.current = null;
        setInsertHint(null);
        return;
      }
    }

    insertHintRef.current = hint;
    setInsertHint(hint);
  }, [getNodes]);

  const handleNodeDragStop = useCallback(async (event, draggedNode) => {
    const hint = insertHintRef.current;
    insertHintRef.current = null;
    setInsertHint(null);

    const ns = nodesRef.current;

    // ヒントなし → 元の位置にスナップ
    if (!hint) {
      const { positions } = calcLayout(ns, layoutMode);
      setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position })));
      return;
    }

    const targetNode  = ns.find(n => n.id === hint.targetNodeId);
    const draggedData = ns.find(n => n.id === draggedNode.id);
    if (!targetNode || !draggedData) return;

    saveHistory();

    if (hint.type === "firstChild") {
      // ─ 子として挿入（ターゲットの最初の子に）
      const children = ns
        .filter(n => n.parent_id === targetNode.id)
        .sort((a, b) => a.order_index - b.order_index);
      const newOrder = children.length > 0
        ? Math.max(1, children[0].order_index - 512)
        : 1024;
      await updateNode(draggedNode.id, { parent_id: targetNode.id, order_index: newOrder });
      onNodesChange(ns.map(n =>
        n.id === draggedNode.id ? { ...n, parent_id: targetNode.id, order_index: newOrder } : n
      ));

    } else {
      // ─ 兄弟として挿入（before / after）
      const parentId = targetNode.parent_id;

      // ドラッグノードを除外した兄弟リスト
      const siblings = ns
        .filter(n => n.parent_id === parentId && n.id !== draggedNode.id)
        .sort((a, b) => a.order_index - b.order_index);
      const targetIdx = siblings.findIndex(n => n.id === targetNode.id);

      let newOrder;
      if (hint.type === "before") {
        if (targetIdx <= 0) {
          newOrder = Math.max(1, (siblings[0]?.order_index ?? 1024) - 512);
        } else {
          const prev = siblings[targetIdx - 1].order_index;
          const cur  = siblings[targetIdx].order_index;
          newOrder   = prev + Math.max(1, Math.floor((cur - prev) / 2));
        }
      } else { // after
        if (targetIdx >= siblings.length - 1) {
          newOrder = (siblings[targetIdx]?.order_index ?? 0) + 1024;
        } else {
          const cur  = siblings[targetIdx].order_index;
          const next = siblings[targetIdx + 1].order_index;
          newOrder   = cur + Math.max(1, Math.floor((next - cur) / 2));
        }
      }

      await updateNode(draggedNode.id, { parent_id: parentId, order_index: newOrder });
      onNodesChange(ns.map(n =>
        n.id === draggedNode.id ? { ...n, parent_id: parentId, order_index: newOrder } : n
      ));
    }

    onSaved();
    showToast("移動しました");
  }, [layoutMode, onNodesChange, onSaved, setRfNodes]);

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
        deleteKeyCode={null} panOnScroll={true} panOnDrag={[1, 2]} panActivationKeyCode="Space"
        fitView fitViewOptions={{ padding: 0.35 }} minZoom={0.2} maxZoom={2}
        style={{ background: "#f8fafc" }}>
        <Background variant={BackgroundVariant.Dots} color="#d4d8e1" gap={24} size={1.5} />
        <Controls showInteractive={false} />
        {/* Zone-based ドラッグの挿入ラインオーバーレイ */}
        <InsertionLineOverlay hint={insertHint} />
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
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加 ・ + PDF</div>
        <div>ダブルクリックで編集 ・ PDF でスライドショー</div>
      </div>
    </div>
  );
}
