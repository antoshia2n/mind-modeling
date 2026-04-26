import { T } from "shia2n-core";
import { flattenTree } from "../lib/tree.js";

const INDENT_PX = 24;

/**
 * 読み取り専用箇条書きビュー（編集UI なし・書式表示のみ）
 * flattenTree が collapsed ノードの子孫をスキップするため、
 * #9 dead condition（collapsed_by_ancestor）を削除した。
 */
export default function ShareListView({ nodes }) {
  const flatNodes = flattenTree(nodes);

  if (flatNodes.length === 0) {
    return <div style={{ padding: 32, color: T.muted, fontSize: 14 }}>ノードがありません。</div>;
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 800, margin: "0 auto" }}>
      {flatNodes.map(node => (
        <div
          key={node.id}
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            borderRadius: 6,
            background: node.node_color || "transparent",
            padding: `2px ${node.node_color ? 8 : 0}px 2px ${node.depth * INDENT_PX + (node.node_color ? 8 : 0)}px`,
            marginBottom: 4,
          }}
        >
          <span style={{ color: T.muted, fontSize: 18, lineHeight: "26px", flexShrink: 0, userSelect: "none" }}>•</span>
          <span style={{
            fontSize: 14, lineHeight: "26px",
            fontFamily: "'Hiragino Sans','Noto Sans JP','YuGothic',sans-serif",
            wordBreak: "break-word", whiteSpace: "pre-wrap",
            fontWeight:     node.bold         ? 700     : undefined,
            fontStyle:      node.italic       ? "italic" : "normal",
            textDecoration: node.strikethrough ? "line-through" : "none",
            color:          node.text_color   || T.fg,
          }}>
            {node.content || <span style={{ color: T.muted }}>（空）</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
