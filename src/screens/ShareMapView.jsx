import { useState, useEffect, useMemo } from "react";
import { ReactFlow, Background, Controls, BackgroundVariant } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { T } from "shia2n-core";
import { Handle, Position } from "@xyflow/react";
import { calcLayout } from "../lib/layout.js";

const PURPLE    = "#a855f7";
const EDGE_STYLE = { stroke: PURPLE, strokeWidth: 2.5 };

// ─── 読み取り専用ノード（編集UI・ホバーアクション・書式ツールバー 全てなし）

function ShareNode({ data }) {
  const [collapsed, setCollapsed] = useState(data.collapsed);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    data.onToggleLocal?.(data.id, next);
  }

  const textStyle = {
    fontWeight:     data.bold         ? 700     : undefined,
    fontStyle:      data.italic       ? "italic" : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none",
    color:          data.textColor    || undefined,
  };

  if (data.isRoot) {
    return (
      <div style={{
        background: data.nodeColor || "#ffffff",
        border: "1.5px solid #e2e8f0", borderRadius: 10,
        padding: "10px 18px", minWidth: 80, maxWidth: 320,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        position: "relative", userSelect: "none",
      }}>
        <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle type="source" position={Position.Right}
          style={data.hasChildren ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, right: -5, opacity: 1, pointerEvents: "none" }
            : { opacity: 0, pointerEvents: "none" }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: "#374151", lineHeight: 1.5, display: "block", ...textStyle }}>
          {data.label || <span style={{ color: "#9ca3af", fontWeight: 400 }}>（空）</span>}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      position: "relative", display: "inline-flex", alignItems: "center",
      padding: data.nodeColor ? "4px 8px" : "2px 4px",
      borderRadius: 6,
      background: data.nodeColor || "transparent",
      userSelect: "none", maxWidth: 240,
    }}>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle type="source" position={Position.Right}
        style={data.hasChildren ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, right: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />

      {/* 折りたたみは許可（閲覧 UX のため） */}
      {data.hasChildren && (
        <button onClick={toggleCollapse}
          style={{
            position: "absolute", right: -26, top: "50%", transform: "translateY(-50%)",
            background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%",
            width: 18, height: 18, fontSize: 7, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, color: PURPLE,
          }}
        >{collapsed ? "▶" : "◀"}</button>
      )}

      <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5, whiteSpace: "nowrap",
        color: T.fg ?? "#374151",
        fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
        ...textStyle }}>
        {data.label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>（空）</span>}
      </span>
    </div>
  );
}

const nodeTypes = { shareNode: ShareNode };

export default function ShareMapView({ nodes }) {
  // ローカル折りたたみ状態（DB 書き込みなし）
  const [localCollapsed, setLocalCollapsed] = useState({});

  function handleToggleLocal(nodeId, value) {
    setLocalCollapsed(prev => ({ ...prev, [nodeId]: value }));
  }

  const mergedNodes = useMemo(
    () => nodes.map(n => ({ ...n, collapsed: localCollapsed[n.id] ?? n.collapsed })),
    [nodes, localCollapsed]
  );

  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = calcLayout(mergedNodes);
    const hiddenIds = new Set();

    for (const n of mergedNodes) {
      if (n.collapsed) {
        function collectDescendants(id) {
          for (const c of mergedNodes) {
            if (c.parent_id === id) { hiddenIds.add(c.id); collectDescendants(c.id); }
          }
        }
        collectDescendants(n.id);
      }
    }

    const rootIds = new Set(mergedNodes.filter(n => !n.parent_id).map(n => n.id));

    const rfNodes = mergedNodes.map(n => ({
      id: n.id,
      position: positions[n.id] ?? { x: 0, y: 0 },
      type: "shareNode",
      hidden: hiddenIds.has(n.id),
      data: {
        id: n.id,
        label:         n.content ?? "",
        collapsed:     n.collapsed,
        hasChildren:   mergedNodes.some(c => c.parent_id === n.id),
        isRoot:        rootIds.has(n.id),
        bold:          n.bold, italic: n.italic, strikethrough: n.strikethrough,
        textColor:     n.text_color, nodeColor: n.node_color,
        onToggleLocal: handleToggleLocal,
      },
    }));

    const rfEdges = mergedNodes
      .filter(n => n.parent_id)
      .map(n => ({
        id: `e-${n.parent_id}-${n.id}`,
        source: n.parent_id, target: n.id,
        type: "smoothstep", style: EDGE_STYLE,
        hidden: hiddenIds.has(n.id),
      }));

    return { rfNodes, rfEdges };
  }, [mergedNodes]);

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px - 37px)" }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        nodesDraggable={false} nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={true} panOnDrag={false}
        deleteKeyCode={null} selectionKeyCode={null}
        fitView fitViewOptions={{ padding: 0.35 }}
        minZoom={0.2} maxZoom={2}
        style={{ background: "#eef0f6" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#c7cade" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
