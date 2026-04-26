import { useState, useEffect, useCallback } from "react";
import {
  ReactFlow, Background, Controls, BackgroundVariant, Position,
  useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { T } from "shia2n-core";
import { Handle } from "@xyflow/react";
import { calcLayout } from "../lib/layout.js";

const PURPLE     = "#a855f7";
const EDGE_STYLE = { stroke: PURPLE, strokeWidth: 2.5 };

function ShareNode({ data }) {
  const dir    = data.direction ?? "right";
  const isLeft = dir === "left";

  const textStyle = {
    fontWeight:     data.bold          ? 700       : undefined,
    fontStyle:      data.italic        ? "italic"  : "normal",
    textDecoration: data.strikethrough ? "line-through" : "none",
    color:          data.textColor     || undefined,
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
        <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
        <Handle id="sl" type="source" position={Position.Left}
          style={data.hasLeftChildren
            ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, left: -5, opacity: 1, pointerEvents: "none" }
            : { opacity: 0, pointerEvents: "none" }} />
        <Handle id="sr" type="source" position={Position.Right}
          style={data.hasRightChildren
            ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 10, height: 10, right: -5, opacity: 1, pointerEvents: "none" }
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
      <Handle id="tl" type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="tr" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: "none" }} />
      <Handle id="sr" type="source" position={Position.Right}
        style={!isLeft && data.hasChildren
          ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, right: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />
      <Handle id="sl" type="source" position={Position.Left}
        style={isLeft && data.hasChildren
          ? { background: "#fff", border: `2px solid ${PURPLE}`, width: 9, height: 9, left: -4.5, opacity: 1, pointerEvents: "none" }
          : { opacity: 0, pointerEvents: "none" }} />

      {/* 折りたたみボタン */}
      {data.hasChildren && (
        <button
          onClick={e => { e.stopPropagation(); data.onToggle?.(); }}
          style={{
            position: "absolute",
            ...(isLeft ? { left: -26 } : { right: -26 }),
            top: "50%", transform: "translateY(-50%)",
            background: "white", border: `1.5px solid ${PURPLE}`, borderRadius: "50%",
            width: 18, height: 18, fontSize: 7, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0, color: PURPLE,
          }}
        >
          {data.collapsed ? (isLeft ? "◀" : "▶") : (isLeft ? "▶" : "◀")}
        </button>
      )}

      <span style={{
        fontSize: 14, fontWeight: 500, lineHeight: 1.5, whiteSpace: "nowrap",
        color: T.fg ?? "#374151",
        fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
        ...textStyle,
      }}>
        {data.label || <span style={{ color: "#9ca3af", fontStyle: "italic", fontWeight: 400 }}>（空）</span>}
      </span>
    </div>
  );
}

const nodeTypes = { shareNode: ShareNode };

export default function ShareMapView({ nodes }) {
  const [localCollapsed, setLocalCollapsed] = useState(() => {
    const init = {};
    for (const n of nodes) if (n.collapsed) init[n.id] = true;
    return init;
  });

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState([]);

  const handleToggle = useCallback((nodeId) => {
    setLocalCollapsed(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  }, []);

  useEffect(() => {
    const merged = nodes.map(n => ({ ...n, collapsed: localCollapsed[n.id] ?? false }));

    const hiddenIds = new Set();
    function collectDescendants(parentId) {
      for (const n of merged) {
        if (n.parent_id === parentId) { hiddenIds.add(n.id); collectDescendants(n.id); }
      }
    }
    for (const n of merged) { if (n.collapsed) collectDescendants(n.id); }

    const { positions, directions } = calcLayout(merged, "bi");
    const rootIds = new Set(merged.filter(n => !n.parent_id).map(n => n.id));

    setRfNodes(merged.map(n => {
      const dir    = directions[n.id] ?? "right";
      const isLeft = dir === "left";
      const isRoot = rootIds.has(n.id);
      return {
        id: n.id, position: positions[n.id] ?? { x: 0, y: 0 },
        type: "shareNode", hidden: hiddenIds.has(n.id),
        sourcePosition: isLeft ? Position.Left  : Position.Right,
        targetPosition: isLeft ? Position.Right : Position.Left,
        data: {
          label: n.content ?? "", collapsed: n.collapsed,
          hasChildren:      merged.some(c => c.parent_id === n.id),
          hasRightChildren: isRoot && merged.some(c => c.parent_id === n.id && directions[c.id] === "right"),
          hasLeftChildren:  isRoot && merged.some(c => c.parent_id === n.id && directions[c.id] === "left"),
          isRoot, direction: dir,
          bold: n.bold, italic: n.italic, strikethrough: n.strikethrough,
          textColor: n.text_color, nodeColor: n.node_color,
          onToggle: () => handleToggle(n.id),
        },
      };
    }));

    setRfEdges(merged.filter(n => n.parent_id).map(n => {
      const isLeft = (directions[n.id] ?? "right") === "left";
      return {
        id: `e-${n.parent_id}-${n.id}`,
        source: n.parent_id, target: n.id,
        sourceHandle: isLeft ? "sl" : "sr",
        targetHandle: isLeft ? "tr" : "tl",
        type: "smoothstep", style: EDGE_STYLE,
        hidden: hiddenIds.has(n.id),
      };
    }));
  }, [nodes, localCollapsed, handleToggle]);

  return (
    <div style={{ width: "100%", height: "calc(100vh - 53px - 37px)" }}>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onNodesChange={onRfNodesChange} onEdgesChange={onRfEdgesChange}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnScroll={true} panOnDrag={false}
        deleteKeyCode={null} selectionKeyCode={null}
        fitView fitViewOptions={{ padding: 0.35 }} minZoom={0.2} maxZoom={2}
        style={{ background: "#eef0f6" }}
      >
        <Background variant={BackgroundVariant.Dots} color="#c7cade" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
