/**
 * mm_nodes から react-flow 用の位置と方向を計算する。
 *
 * layoutMode:
 *   "bi"    … 左右展開（デフォルト）
 *   "right" … 右のみ展開
 *   "tb"    … 上下展開（トップダウン）
 *
 * 返り値:
 *   positions:  { [nodeId]: { x, y } }
 *   directions: { [nodeId]: "right" | "left" | "down" }
 */

export const NODE_HEIGHT  = 28;
const CHILD_GAP_H  = 32;   // 水平：親端→子端の余白
const CHILD_GAP_V  = 72;   // 垂直：親端→子端の余白（tb モード）
const H_SIB_GAP    = 16;   // 上下モードの兄弟間水平余白
const MIN_NODE_W   = 60;
const MAX_NODE_W   = 220;
const CHAR_W_JP    = 13;
const CHAR_W_ASCII = 7;
const NODE_PADDING = 20;

export function estimateNodeWidth(text) {
  if (!text) return MIN_NODE_W;
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 127 ? CHAR_W_JP : CHAR_W_ASCII;
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w + NODE_PADDING));
}

/**
 * @param {Array}  nodes
 * @param {string} layoutMode - "bi" | "right" | "tb"
 * @returns {{ positions: Object, directions: Object }}
 */
export function calcLayout(nodes, layoutMode = "bi") {
  if (!nodes || nodes.length === 0) return { positions: {}, directions: {} };

  const byParent = {};
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(n);
  }
  for (const key in byParent) byParent[key].sort((a, b) => a.order_index - b.order_index);

  const roots = byParent["__root__"] ?? [];

  if (layoutMode === "tb") return calcTopBottom(nodes, roots, byParent);
  if (layoutMode === "bi" && roots.length === 1) return calcBidirectional(nodes, roots[0], byParent);
  return calcUnidirectional(nodes, byParent); // "right" mode
}

// ─── 左右展開 (bi) ─────────────────────────────────────────

function calcBidirectional(nodes, root, byParent) {
  const positions = {}, directions = {};

  function subtreeHeight(nodeId) {
    const ch = byParent[nodeId] || [];
    if (ch.length === 0) return NODE_HEIGHT;
    return ch.reduce((s, c) => s + subtreeHeight(c.id), 0);
  }

  function place(nodeId, xAnchor, yStart, dir) {
    directions[nodeId] = dir;
    const node  = nodes.find(n => n.id === nodeId);
    const myW   = estimateNodeWidth(node?.content ?? "");
    const h     = subtreeHeight(nodeId);
    const nodeX = dir === "right" ? xAnchor : xAnchor - myW;
    positions[nodeId] = { x: nodeX, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    const childAnchor = dir === "right" ? nodeX + myW + CHILD_GAP_H : nodeX - CHILD_GAP_H;
    let childY = yStart;
    for (const child of byParent[nodeId] || []) childY = place(child.id, childAnchor, childY, dir);
    return yStart + h;
  }

  const rootChildren = byParent[root.id] || [];
  const right = [], left = [];
  let rightH = 0, leftH = 0;
  for (const child of rootChildren) {
    const h = subtreeHeight(child.id);
    if (rightH <= leftH) { right.push(child); rightH += h; }
    else                  { left.push(child);  leftH  += h; }
  }

  const totalH = Math.max(NODE_HEIGHT, rightH + leftH);
  const rootW  = estimateNodeWidth(root.content ?? "");

  directions[root.id] = "right";
  positions[root.id]  = { x: 0, y: totalH / 2 - NODE_HEIGHT / 2 };

  let ry = totalH / 2 - rightH / 2;
  for (const child of right) ry = place(child.id, rootW + CHILD_GAP_H, ry, "right");

  let ly = totalH / 2 - leftH / 2;
  for (const child of left) ly = place(child.id, -CHILD_GAP_H, ly, "left");

  return { positions, directions };
}

// ─── 右のみ展開 (right) ────────────────────────────────────

function calcUnidirectional(nodes, byParent) {
  const positions = {}, directions = {};

  function subtreeHeight(nodeId) {
    const ch = byParent[nodeId] || [];
    if (ch.length === 0) return NODE_HEIGHT;
    return ch.reduce((s, c) => s + subtreeHeight(c.id), 0);
  }

  function place(nodeId, x, yStart) {
    directions[nodeId] = "right";
    const node  = nodes.find(n => n.id === nodeId);
    const myW   = estimateNodeWidth(node?.content ?? "");
    const h     = subtreeHeight(nodeId);
    positions[nodeId] = { x, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    const childX = x + myW + CHILD_GAP_H;
    let childY = yStart;
    for (const child of byParent[nodeId] || []) childY = place(child.id, childX, childY);
    return yStart + h;
  }

  let yOffset = 0;
  for (const root of byParent["__root__"] || []) yOffset = place(root.id, 0, yOffset);
  return { positions, directions };
}

// ─── 上下展開 (tb) ─────────────────────────────────────────

function calcTopBottom(nodes, roots, byParent) {
  const positions = {}, directions = {};

  function subtreeWidth(nodeId) {
    const ch = byParent[nodeId] || [];
    const nodeW = estimateNodeWidth(nodes.find(n => n.id === nodeId)?.content ?? "");
    if (ch.length === 0) return nodeW;
    const childrenW = ch.reduce((s, c, i) => s + subtreeWidth(c.id) + (i > 0 ? H_SIB_GAP : 0), 0);
    return Math.max(nodeW, childrenW);
  }

  function place(nodeId, x, y, allocWidth) {
    directions[nodeId] = "down";
    const node  = nodes.find(n => n.id === nodeId);
    const nodeW = estimateNodeWidth(node?.content ?? "");
    // ノードを割り当て幅の中央に配置
    positions[nodeId] = { x: x + allocWidth / 2 - nodeW / 2, y };

    const children = byParent[nodeId] || [];
    if (children.length === 0) return;

    const totalChildW = children.reduce((s, c, i) => s + subtreeWidth(c.id) + (i > 0 ? H_SIB_GAP : 0), 0);
    // 親ノードの中央を基準に子を配置
    let childX = x + allocWidth / 2 - totalChildW / 2;
    const childY = y + NODE_HEIGHT + CHILD_GAP_V;

    for (const child of children) {
      const cw = subtreeWidth(child.id);
      place(child.id, childX, childY, cw);
      childX += cw + H_SIB_GAP;
    }
  }

  let x = 0;
  for (const root of roots) {
    const w = subtreeWidth(root.id);
    place(root.id, x, 0, w);
    x += w + H_SIB_GAP * 4;
  }

  return { positions, directions };
}

/** 後方互換 */
export function getPositions(nodes, layoutMode = "bi") {
  return calcLayout(nodes, layoutMode).positions;
}
