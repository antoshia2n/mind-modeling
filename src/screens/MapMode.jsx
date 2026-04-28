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

// ─── S字ベジェエッジ ──────────────────────────────────────────

function WmEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, style }) {
  const isVert = sourcePosition === Position.Bottom || sourcePosition === Position.Top;
  let d;
  if (isVert) {
    const dy = Math.abs(targetY - sourceY);
    const cp = Math.max(24, dy * 0.5);
    d = `M ${sourceX},${sourceY} C ${sourceX},${sourceY+cp} ${targetX},${targetY-cp} ${targetX},${targetY}`;
  } else {
    const isLeft = sourcePosition === Position.Left;
    const dx = Math.abs(targetX - sourceX);
    const cp = Math.max(20, dx * 0.5);
    d = isLeft
      ? `M ${sourceX},${sourceY} C ${sourceX-cp},${sourceY} ${targetX+cp},${targetY} ${targetX},${targetY}`
      : `M ${sourceX},${sourceY} C ${sourceX+cp},${sourceY} ${targetX-cp},${targetY} ${targetX},${targetY}`;
  }
  return <BaseEdge id={id} path={d} style={style} />;
}

// ─── ドラッグ Ghost（カーソルに追従するコピー）────────────────
// position:fixed で画面座標のまま表示。座標変換不要。

function DragGhost({ ghost }) {
  if (!ghost) return null;
  return (
    <div style={{
      position: "fixed", left: ghost.x, top: ghost.y, pointerEvents: "none", zIndex: 9999,
      background: "white", border: "1.5px solid #a855f7", borderRadius: 6,
      padding: "2px 10px", fontSize: 13, fontWeight: 500, color: "#374151",
      opacity: 0.85, boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
      whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
      fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
    }}>
      {ghost.label || "(空のノード)"}
    </div>
  );
}

// ─── 挿入ライン（position:fixed・画面座標）───────────────────
// ●──── で挿入位置を示す。座標変換なし。

function InsertionLine({ hint }) {
  if (!hint) return null;
  const DOT = 8;
  return (
    <div style={{
      position: "fixed", left: hint.lineX, top: hint.lineY,
      transform: "translateY(-50%)",
      display: "flex", alignItems: "center",
      pointerEvents: "none", zIndex: 9998,
    }}>
      <div style={{ width: DOT, height: DOT, borderRadius: "50%", background: "#a855f7", flexShrink: 0 }} />
      <div style={{ width: hint.lineW, height: 2, background: "#a855f7", borderRadius: "0 1px 1px 0" }} />
      {hint.type === "firstChild" && (
        <div style={{ width: DOT, height: DOT, borderRadius: "50%", background: "#a855f7", opacity: 0.4, marginLeft: -1 }} />
      )}
    </div>
  );
}

// ─── 定数・ユーティリティ ─────────────────────────────────────

const nodeTypes  = { mmNode: MmNode };
const edgeTypes  = { wmEdge: WmEdge };
const EDGE_STYLE  = { stroke: "#a855f7", strokeWidth: 1.5, fill: "none" };
const DEBOUNCE_MS = 800;
const FOCUS_EVENT = "mm-focus-node";
const PDF_MAX_MB  = 20;
const MAX_HISTORY = 40;

function fireNodeFocus(id) {
  setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { nodeId: id } })), 80);
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

// ─── undo 用スナップショット適用 ─────────────────────────────

const SNAP_FIELDS = ['content','parent_id','order_index','collapsed','bold','italic','strikethrough','text_color','node_color','linked_map_id','pdf_url','pdf_filename','link_url'];

async function applySnapshot(targetNodes, currentNodes) {
  const curMap = new Map(currentNodes.map(n => [n.id, n]));
  const tgtMap = new Map(targetNodes.map(n => [n.id, n]));
  for (const n of currentNodes) { if (!tgtMap.has(n.id)) await deleteNode(n.id).catch(() => {}); }
  const toRestore = targetNodes.filter(n => !curMap.has(n.id));
  const depth = (id, v = new Set()) => { if (v.has(id)) return 0; v.add(id); const nd = tgtMap.get(id); return nd?.parent_id ? 1 + depth(nd.parent_id, v) : 0; };
  toRestore.sort((a, b) => depth(a.id) - depth(b.id));
  for (const n of toRestore) await restoreNode(n).catch(() => {});
  for (const tgt of targetNodes) {
    const cur = curMap.get(tgt.id); if (!cur) continue;
    const upd = {};
    for (const f of SNAP_FIELDS) { if (tgt[f] !== cur[f]) upd[f] = tgt[f]; }
    if (Object.keys(upd).length) await updateNode(tgt.id, upd).catch(() => {});
  }
}

// ─── 挿入ゾーン検出（screen座標ベース）──────────────────────
// getBoundingClientRect() と MouseEvent.clientX/Y は同じ座標系。
// viewport変換不要で確実に動く。

function detectInsertZone(mouseX, mouseY, draggingId, nodes) {
  const elements = document.querySelectorAll("[data-nodeid]");
  const descIds  = new Set(getDescendantIds(draggingId, nodes));
  let best = null, bestDist = 48;

  for (const el of elements) {
    const id = el.dataset.nodeid;
    if (!id || id === draggingId || descIds.has(id)) continue;

    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width / 2;

    // 子挿入ゾーン：ノード右端から80px以内・縦がノードと重なる
    if (mouseX > rect.right - 8 && mouseX < rect.right + 80 &&
        mouseY > rect.top - 10 && mouseY < rect.bottom + 10) {
      const dist = Math.max(0, mouseX - rect.right);
      if (dist < bestDist) {
        bestDist = dist;
        best = { type: "firstChild", targetId: id, lineX: rect.right + 4, lineY: rect.top + rect.height / 2, lineW: 32 };
      }
      continue;
    }

    // 兄弟・前（ノード上端付近）
    const topDist = Math.abs(mouseY - rect.top);
    if (topDist < bestDist && Math.abs(mouseX - cx) < rect.width / 2 + 24) {
      bestDist = topDist;
      best = { type: "before", targetId: id, lineX: rect.left - 4, lineY: rect.top - 1, lineW: rect.width + 8 };
    }

    // 兄弟・後（ノード下端付近）
    const botDist = Math.abs(mouseY - rect.bottom);
    if (botDist < bestDist && Math.abs(mouseX - cx) < rect.width / 2 + 24) {
      bestDist = botDist;
      best = { type: "after", targetId: id, lineX: rect.left - 4, lineY: rect.bottom + 1, lineW: rect.width + 8 };
    }
  }

  return best;
}

// ─── MapMode ─────────────────────────────────────────────────

export default function MapMode({ uid, mapId, nodes, layoutMode = "bi", onNodesChange, onSaved, onRequestTemplateInsert, onRequestMapLink, onRootLabelChange }) {
  const { fitView } = useReactFlow();
  const saveTimers   = useRef({});
  const fileInputRef = useRef(null);
  const uploadNodeId = useRef(null);

  // nodesRef：全コールバックを stable にするため nodes を ref で保持
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // 2パスレイアウト補正
  const layoutCorrected = useRef(false);
  const layoutStructKey = useRef("");

  // undo/redo
  const historyRef    = useRef([]);
  const historyIdxRef = useRef(-1);
  const isUndoingRef  = useRef(false);

  function saveHistory() {
    if (isUndoingRef.current) return;
    const snap = nodesRef.current.map(n => ({ ...n })); // nodesRef を使うため常に最新
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
  const [ghost,       setGhost]       = useState(null);  // DragGhost用
  const [insertHint,  setInsertHint]  = useState(null);  // InsertionLine用
  const [toastMsg,    setToastMsg]    = useState(null);
  const [toastType,   setToastType]   = useState("info");

  function showToast(msg, type = "info") {
    setToastMsg(msg); setToastType(type);
    setTimeout(() => setToastMsg(null), 2500);
  }

  // ─── Undo / Redo ────────────────────────────────────────────

  const undo = useCallback(async () => {
    if (historyIdxRef.current <= 0) { showToast("これ以上取り消せません"); return; }
    isUndoingRef.current = true;
    const snap = historyRef.current[historyIdxRef.current - 1];
    showToast("取り消し中...");
    await applySnapshot(snap, nodesRef.current);
    historyIdxRef.current--;
    onNodesChange(snap); onSaved();
    isUndoingRef.current = false;
    showToast("取り消しました");
  }, [onNodesChange, onSaved]);

  const redo = useCallback(async () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) { showToast("これ以上やり直せません"); return; }
    isUndoingRef.current = true;
    const snap = historyRef.current[historyIdxRef.current + 1];
    showToast("やり直し中...");
    await applySnapshot(snap, nodesRef.current);
    historyIdxRef.current++;
    onNodesChange(snap); onSaved();
    isUndoingRef.current = false;
    showToast("やり直しました");
  }, [onNodesChange, onSaved]);

  // ─── PDF操作 ─────────────────────────────────────────────────

  const handleUploadPdfClick = useCallback((nodeId) => {
    uploadNodeId.current = nodeId;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0]; e.target.value = "";
    const nodeId = uploadNodeId.current; if (!file || !nodeId) return;
    if (file.type !== "application/pdf") { showToast("PDFファイルのみアップロードできます", "error"); return; }
    if (file.size > PDF_MAX_MB * 1024 * 1024) { showToast(`${PDF_MAX_MB}MB以内のファイルのみ`, "error"); return; }
    showToast("PDF アップロード中...");
    const existing = nodesRef.current.find(n => n.id === nodeId);
    if (existing?.pdf_url) await deletePdf(existing.pdf_url).catch(() => {});
    const path = await uploadPdf(uid, nodeId, file);
    if (!path) { showToast("アップロードに失敗しました", "error"); return; }
    saveHistory();
    await updateNode(nodeId, { pdf_url: path, pdf_filename: file.name });
    onNodesChange(nodesRef.current.map(n => n.id === nodeId ? { ...n, pdf_url: path, pdf_filename: file.name } : n));
    onSaved(); showToast(`PDF を添付しました（${file.name}）`);
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

  // ─── ノード操作（全て nodesRef ベース）──────────────────────

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

  const deleteSelected = useCallback(async () => {
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

  const moveSelection = useCallback((nodeId, dir) => {
    const ns = nodesRef.current;
    const node = ns.find(n => n.id === nodeId); if (!node) return;
    const hidden = getHiddenIds(ns);
    if (dir === "right") {
      const ch = ns.filter(n => n.parent_id === nodeId && !hidden.has(n.id)).sort((a, b) => a.order_index - b.order_index);
      if (ch.length) { setSelectedId(ch[0].id); setSelectedIds(new Set([ch[0].id])); }
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
      result.push({ content: node.content ?? "", parentIdx: pi, bold: node.bold, italic: node.italic, strikethrough: node.strikethrough, text_color: node.text_color, node_color: node.node_color });
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
      if (!aId) continue;
      const cur = [...nodesRef.current, ...newNodes], sib = cur.filter(n => n.parent_id === aId);
      const newOrder = sib.length > 0 ? Math.max(...sib.map(n => n.order_index)) + 1024 : 1024;
      const nn = await createNode(uid, mapId, aId, newOrder, content, { bold, italic, strikethrough, text_color, node_color });
      if (!nn) continue;
      idMap[i] = nn.id; newNodes.push(nn);
    }
    onNodesChange([...nodesRef.current, ...newNodes]); onSaved();
    if (newNodes.length > 0) { setSelectedId(newNodes[0].id); setSelectedIds(new Set([newNodes[0].id])); showToast(`${newNodes.length}ノードをペーストしました`); }
  }, [uid, mapId, onNodesChange, onSaved]);

  // ─── カスタムドラッグ（screen座標ベース）────────────────────
  // react-flow の nodesDraggable={false} にし、全ドラッグをここで管理。
  // Ghost と InsertionLine は position:fixed で画面座標のまま描画。
  // getBoundingClientRect() と MouseEvent.clientX/Y は同座標系なので変換不要。

  const dragRef = useRef({ active: false, nodeId: null, label: "", startX: 0, startY: 0, offsetX: 0, offsetY: 0 });
  const insertHintRef = useRef(null);

  const handleNodeDragStart = useCallback((nodeId, label, e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const el = document.querySelector(`[data-nodeid="${nodeId}"]`);
    const rect = el?.getBoundingClientRect() ?? { left: e.clientX, top: e.clientY };

    dragRef.current = {
      active: false,   // 5px動いたら true（クリックとドラッグを区別）
      nodeId, label,
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };

    function onMouseMove(mv) {
      const dr = dragRef.current;
      if (!dr.active) {
        if (Math.abs(mv.clientX - dr.startX) < 5 && Math.abs(mv.clientY - dr.startY) < 5) return;
        dr.active = true;
        saveHistory();
      }
      setGhost({ x: mv.clientX - dr.offsetX, y: mv.clientY - dr.offsetY, label: dr.label });
      const hint = detectInsertZone(mv.clientX, mv.clientY, dr.nodeId, nodesRef.current);
      insertHintRef.current = hint;
      setInsertHint(hint);
    }

    async function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup",   onMouseUp);
      setGhost(null);
      setInsertHint(null);

      if (!dragRef.current.active) return;
      dragRef.current.active = false;

      const hint = insertHintRef.current;
      insertHintRef.current = null;
      if (!hint) return;

      const ns = nodesRef.current;
      const draggingId = dragRef.current.nodeId;
      const targetNode = ns.find(n => n.id === hint.targetId);
      if (!targetNode) return;

      if (hint.type === "firstChild") {
        // ターゲットの最初の子として挿入
        const children = ns.filter(n => n.parent_id === targetNode.id).sort((a, b) => a.order_index - b.order_index);
        const newOrder  = children.length > 0 ? Math.max(1, children[0].order_index - 512) : 1024;
        await updateNode(draggingId, { parent_id: targetNode.id, order_index: newOrder });
        onNodesChange(nodesRef.current.map(n => n.id === draggingId ? { ...n, parent_id: targetNode.id, order_index: newOrder } : n));
      } else {
        // 兄弟として挿入（before / after）
        const parentId = targetNode.parent_id;
        const siblings  = ns.filter(n => n.parent_id === parentId && n.id !== draggingId).sort((a, b) => a.order_index - b.order_index);
        const ti        = siblings.findIndex(n => n.id === targetNode.id);
        let newOrder;
        if (hint.type === "before") {
          newOrder = ti <= 0
            ? Math.max(1, (siblings[0]?.order_index ?? 1024) - 512)
            : siblings[ti-1].order_index + Math.max(1, Math.floor((siblings[ti].order_index - siblings[ti-1].order_index) / 2));
        } else {
          newOrder = ti >= siblings.length - 1
            ? (siblings[ti]?.order_index ?? 0) + 1024
            : siblings[ti].order_index + Math.max(1, Math.floor((siblings[ti+1].order_index - siblings[ti].order_index) / 2));
        }
        await updateNode(draggingId, { parent_id: parentId, order_index: newOrder });
        onNodesChange(nodesRef.current.map(n => n.id === draggingId ? { ...n, parent_id: parentId, order_index: newOrder } : n));
      }
      onSaved();
      showToast("移動しました");
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);
  }, [onNodesChange, onSaved]);

  // ─── rfNodes / rfEdges 同期（1パス目：推定幅で仮配置）────────

  useEffect(() => {
    const structKey = nodes.map(n => n.id + n.parent_id).join(",") + layoutMode;
    if (layoutStructKey.current !== structKey) { layoutStructKey.current = structKey; layoutCorrected.current = false; }

    const { positions, directions } = calcLayout(nodes, layoutMode);
    const hiddenIds = getHiddenIds(nodes);
    const rootIds   = new Set(nodes.filter(n => !n.parent_id).map(n => n.id));
    const isTb      = layoutMode === "tb";

    setRfNodes(nodes.map(n => {
      const dir    = directions[n.id] ?? "right";
      const isLeft = dir === "left";
      const isRoot = rootIds.has(n.id);
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
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          linkedMapId: n.linked_map_id ?? null,
          linkUrl:     n.link_url       ?? null,
          pdfUrl: n.pdf_url ?? null, pdfFilename: n.pdf_filename ?? null,
          onDragStart:           (nodeId, label, e) => handleNodeDragStart(nodeId, label, e),
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
            const cur = nodesRef.current.find(nd => nd.id === n.id)?.link_url ?? "";
            const raw = window.prompt("URLを入力（空白で削除）:", cur);
            if (raw === null) return;
            const cleaned = raw.trim();
            const url = cleaned === "" ? null : (cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
            updateNode(n.id, { link_url: url });
            onNodesChange(nodesRef.current.map(nd => nd.id === n.id ? { ...nd, link_url: url } : nd));
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
      const src = isTb ? "sb" : (isLeft ? "sl" : "sr");
      const tgt = isTb ? "tt" : (isLeft ? "tr" : "tl");
      return { id: `e-${n.parent_id}-${n.id}`, source: n.parent_id, target: n.id, sourceHandle: src, targetHandle: tgt, type: "wmEdge", style: EDGE_STYLE, hidden: hiddenIds.has(n.id) };
    }));
  // deps は nodes と layoutMode のみ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, layoutMode]);

  // 軽量：選択状態のみ更新
  useEffect(() => {
    setRfNodes(prev => prev.map(n => ({
      ...n, selected: selectedIds.has(n.id),
      data: { ...n.data, isSelected: selectedIds.has(n.id) },
    })));
  }, [selectedIds]);

  // 2パス目：実測幅で再配置（重なり解消）
  useEffect(() => {
    if (layoutCorrected.current || rfNodes.length === 0) return;
    if (!rfNodes.every(n => n.measured?.width && n.measured?.height)) return;
    layoutCorrected.current = true;
    const widths = Object.fromEntries(rfNodes.map(n => [n.id, n.measured.width]));
    const { positions } = calcLayout(nodes, layoutMode, widths);
    setRfNodes(prev => prev.map(n => ({ ...n, position: positions[n.id] ?? n.position })));
    setTimeout(() => fitView({ padding: 0.35, duration: 200 }), 80);
  }, [rfNodes]);

  // ─── キーボードショートカット ─────────────────────────────────

  useEffect(() => {
    async function onKeyDown(e) {
      const active = document.activeElement;
      const isInput = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA";

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); await undo(); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); await redo(); return; }
      if (isInput) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); await deleteSelected(); }
      if (e.key === "Enter" && selectedId) { e.preventDefault(); await addSibling(selectedId, "after"); }
      if (e.key === "Tab" && selectedId) { e.preventDefault(); await addChild(selectedId); }
      if (selectedId) {
        if (e.key === "ArrowRight") { e.preventDefault(); moveSelection(selectedId, "right"); }
        if (e.key === "ArrowLeft")  { e.preventDefault(); moveSelection(selectedId, "left"); }
        if (e.key === "ArrowUp")    { e.preventDefault(); moveSelection(selectedId, "up"); }
        if (e.key === "ArrowDown")  { e.preventDefault(); moveSelection(selectedId, "down"); }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, undo, redo, deleteSelected, addSibling, addChild, moveSelection]);

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

      <ReactFlow
        key={layoutMode}
        nodes={rfNodes} edges={rfEdges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        onNodeClick={handleNodeClick}
        onSelectionChange={handleSelectionChange}
        onPaneClick={handlePaneClick}
        nodesDraggable={false}           /* react-flow のドラッグを完全無効化 */
        nodesConnectable={false}
        elementsSelectable={true}
        multiSelectionKeyCode="Shift"
        selectionOnDrag={false}
        deleteKeyCode={null}
        panOnScroll={true}
        panOnDrag={true}                 /* 背景ドラッグでパン */
        panActivationKeyCode="Space"     /* Space+ドラッグでもパン */
        fitView fitViewOptions={{ padding: 0.35 }}
        minZoom={0.15} maxZoom={2.5}
        style={{ background: "#f8fafc" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#d4d8e1" gap={24} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* カスタムドラッグのオーバーレイ（position:fixed、座標変換不要）*/}
      <DragGhost ghost={ghost} />
      <InsertionLine hint={insertHint} />

      {toastMsg && (
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: toastType === "error" ? "rgba(220,38,38,0.9)" : "rgba(30,30,40,0.85)", color: "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 1000 }}>{toastMsg}</div>
      )}
      <div style={{ position: "absolute", bottom: 16, right: 16, background: "rgba(255,255,255,0.92)", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#94a3b8", lineHeight: 1.9, pointerEvents: "none" }}>
        <div><b style={{color:"#6b7280"}}>ドラッグ</b> ノードを移動 ・ <b style={{color:"#6b7280"}}>Space+ドラッグ</b> パン</div>
        <div><b style={{color:"#6b7280"}}>⌘Z</b> 取り消し ・ <b style={{color:"#6b7280"}}>⌘⇧Z</b> やり直し</div>
        <div><b style={{color:"#6b7280"}}>Enter</b> 兄弟追加 ・ <b style={{color:"#6b7280"}}>Tab</b> 子追加</div>
      </div>
    </div>
  );
}
