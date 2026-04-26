/**
 * mm_nodes から react-flow 用の位置と方向を計算する。
 *
 * calcLayout の戻り値:
 *   positions:  { [nodeId]: { x, y } }
 *   directions: { [nodeId]: "right" | "left" }
 *     - right: 親から右方向に展開するノード
 *     - left:  親から左方向に展開するノード
 *     - ルートノードは "right"（両方向の起点として扱う）
 *
 * layoutMode:
 *   "bi" … ルートを中心に左右展開（デフォルト）
 *   "lr" … 左→右の一方向ツリー
 */

const NODE_HEIGHT  = 50;
const CHILD_GAP    = 52;   // 親端 → 子端 の余白（px）
const MIN_NODE_W   = 80;
const MAX_NODE_W   = 240;
const CHAR_W_JP    = 14;
const CHAR_W_ASCII = 8;
const NODE_PADDING = 32;

export function estimateNodeWidth(text) {
  if (!text) return MIN_NODE_W;
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 127 ? CHAR_W_JP : CHAR_W_ASCII;
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w + NODE_PADDING));
}

/**
 * @param {Array}  nodes
 * @param {string} layoutMode
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
  for (const key in byParent) {
    byParent[key].sort((a, b) => a.order_index - b.order_index);
  }

  const roots = byParent["__root__"] ?? [];

  if (layoutMode === "bi" && roots.length === 1) {
    return calcBidirectional(nodes, roots[0], byParent);
  }
  return calcUnidirectional(nodes, byParent);
}

// ─── 双方向レイアウト ──────────────────────────────────────

function calcBidirectional(nodes, root, byParent) {
  const positions  = {};
  const directions = {};

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
    const childAnchor = dir === "right" ? nodeX + myW + CHILD_GAP : nodeX - CHILD_GAP;
    let childY = yStart;
    for (const child of byParent[nodeId] || []) {
      childY = place(child.id, childAnchor, childY, dir);
    }
    return yStart + h;
  }

  // 高さベースのグリーディ分割（重い枝が均等に振り分けられる）
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

  // ルートを中央に配置
  directions[root.id] = "right";
  positions[root.id]  = { x: 0, y: totalH / 2 - NODE_HEIGHT / 2 };

  // 右グループ
  let ry = totalH / 2 - rightH / 2;
  for (const child of right) ry = place(child.id, rootW + CHILD_GAP, ry, "right");

  // 左グループ
  let ly = totalH / 2 - leftH / 2;
  for (const child of left) ly = place(child.id, -CHILD_GAP, ly, "left");

  return { positions, directions };
}

// ─── 左→右一方向レイアウト ────────────────────────────────

function calcUnidirectional(nodes, byParent) {
  const positions  = {};
  const directions = {};

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
    const childX = x + myW + CHILD_GAP;
    let childY = yStart;
    for (const child of byParent[nodeId] || []) childY = place(child.id, childX, childY);
    return yStart + h;
  }

  let yOffset = 0;
  for (const root of byParent["__root__"] || []) yOffset = place(root.id, 0, yOffset);
  return { positions, directions };
}

/** 後方互換エイリアス */
export function getPositions(nodes, layoutMode = "bi") {
  return calcLayout(nodes, layoutMode).positions;
}
