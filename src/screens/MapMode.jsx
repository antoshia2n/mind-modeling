import { useEffect, useRef, useCallback } from "react";
import {
  ReactFlow, Background, Controls,
  useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createNode, updateNode, updateNodePosition, deleteNode } from "../lib/supabase.js";
import { getPositions } from "../lib/layout.js";
import MmNode from "./MmNode.jsx";

const nodeTypes = { mmNode: MmNode };
const EDGE_STYLE  = { stroke: "#94a3b8", strokeWidth: 2 };
const DEBOUNCE_MS = 800;

// ─── ユーティリティ ──────────────────────────────────

/** nodeId の子孫 ID を全て取得 */
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

/**
 * collapsed=true のノードの子孫 ID セットを返す
 * これらのノードは react-flow 上で hidden になる
 */
function getHiddenIds(nodes) {
  const hidden = new Set();
  for (const n of nodes) {
    if (n.collapsed) {
      for (const id of getDescendantIds(n.id, nodes)) {
        hidden.add(id);
      }
    }
  }
  return hidden;
}

/**
 * ドラッグ終了位置で他のノードと重なっているか判定し、
 * 重なっているノードを返す（なければ null）
 */
function findDropTarget(dragged, allRfNodes) {
  const dw = dragged.measured?.width  ?? 160;
  const dh = dragged.measured?.height ?? 50;
  const cx = dragged.position.x + dw / 2;
  const cy = dragged.position.y + dh / 2;

  for (const n of allRfNodes) {
    if (n.id === dragged.id || n.hidden) continue;
    const nw = n.measured?.width  ?? 160;
    const nh = n.measured?.height ?? 50;
    if (
      cx >= n.position.x && cx <= n.position.x + nw &&
      cy >= n.position.y && cy <= n.position.y + nh
    ) {
      return n;
    }
  }
  return null;
}

// ─── MapMode コンポーネント ──────────────────────────

export default function MapMode({ uid, mapId, nodes, onNodesChange, onSaved }) {
  const saveTimers = useRef({});
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);

  // ─── 操作ハンドラ ──────────────────────────────────

  const handleContentChange = useCallback((nodeId, value) => {
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, content: value } : n));
    clearTimeout(saveTimers.current[nodeId]);
    saveTimers.current[nodeId] = setTimeout(async () => {
      await updateNode(nodeId, { content: value });
      onSaved();
    }, DEBOUNCE_MS);
  }, [nodes, onNodesChange, onSaved]);

  const handleAddChild = useCallback(async (parentId) => {
    const children = nodes.filter(n => n.parent_id === parentId);
    const newOrder  = children.length > 0
      ? Math.max(...children.map(n => n.order_index)) + 1024
      : 1024;
    const newNode = await createNode(uid, mapId, parentId, newOrder, "");
    if (!newNode) return;
    onNodesChange([...nodes, newNode]);
    onSaved();
  }, [nodes, uid, mapId, onNodesChange, onSaved]);

  const handleDelete = useCallback(async (nodeId) => {
    if (nodes.length <= 1) return;
    const hasChildren = nodes.some(n => n.parent_id === nodeId);
    const msg = hasChildren
      ? "このノードとその子ノードを全て削除しますか？"
      : "このノードを削除しますか？";
    if (!window.confirm(msg)) return;
    await deleteNode(nodeId);
    const removedIds = [nodeId, ...getDescendantIds(nodeId, nodes)];
    onNodesChange(nodes.filter(n => !removedIds.includes(n.id)));
    onSaved();
  }, [nodes, onNodesChange, onSaved]);

  const handleToggleCollapse = useCallback(async (nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newCollapsed = !node.collapsed;
    await updateNode(nodeId, { collapsed: newCollapsed });
    onNodesChange(nodes.map(n => n.id === nodeId ? { ...n, collapsed: newCollapsed } : n));
    onSaved();
  }, [nodes, onNodesChange, onSaved]);

  // ─── react-flow との同期 ────────────────────────────

  useEffect(() => {
    const positions = getPositions(nodes);
    const hiddenIds = getHiddenIds(nodes);

    setRfNodes(prev =>
      nodes.map(n => {
        // 保存済み x/y があればそれを使う。
        // なければ react-flow 内部の位置（ドラッグ途中）を保持。
        // それもなければ自動計算値。
        const existing = prev.find(p => p.id === n.id);
        const position =
          (n.x != null && n.y != null) ? { x: n.x, y: n.y } :
          existing?.position             ? existing.position :
          positions[n.id]               ?? { x: 0, y: 0 };

        return {
          id:       n.id,
          position,
          type:     "mmNode",
          hidden:   hiddenIds.has(n.id),
          data: {
            label:            n.content ?? "",
            collapsed:        n.collapsed,
            hasChildren:      nodes.some(c => c.parent_id === n.id),
            isRoot:           !n.parent_id,
            onContentChange:  (v) => handleContentChange(n.id, v),
            onAddChild:       ()  => handleAddChild(n.id),
            onDelete:         ()  => handleDelete(n.id),
            onToggleCollapse: ()  => handleToggleCollapse(n.id),
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
          // エッジ先のノードが hidden なら非表示
          hidden: hiddenIds.has(n.id),
        }))
    );
  }, [nodes, handleContentChange, handleAddChild, handleDelete, handleToggleCollapse]);

  // ─── ドラッグ終了処理 ──────────────────────────────

  const handleNodeDragStop = useCallback(async (event, node, allRfNodes) => {
    const target = findDropTarget(node, allRfNodes);

    if (target) {
      // ─ 別ノードの上にドロップ → 親子変更 ─
      const descendants = getDescendantIds(node.id, nodes);
      if (descendants.includes(target.id) || target.id === node.id) return; // 循環参照NG

      const newSiblings = nodes.filter(n => n.parent_id === target.id);
      const newOrder = newSiblings.length > 0
        ? Math.max(...newSiblings.map(n => n.order_index)) + 1024
        : 1024;

      // x/y を null にリセット（自動レイアウトで再配置）
      await updateNode(node.id, {
        parent_id: target.id,
        order_index: newOrder,
        x: null,
        y: null,
      });
      onNodesChange(
        nodes.map(n =>
          n.id === node.id
            ? { ...n, parent_id: target.id, order_index: newOrder, x: null, y: null }
            : n
        )
      );
      onSaved();
    } else {
      // ─ 空白にドロップ → 位置を保存 ─
      const { x, y } = node.position;
      await updateNodePosition(node.id, x, y);
      onNodesChange(nodes.map(n => n.id === node.id ? { ...n, x, y } : n));
      onSaved();
    }
  }, [nodes, onNodesChange, onSaved]);

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
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#e2e8f0" gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
