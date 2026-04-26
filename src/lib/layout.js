/**
 * mm_nodes から react-flow 用の位置（x, y）を計算する。
 *
 * layoutMode:
 *   "lr"  … 左→右の一方向ツリー（複数ルートがある場合の自動フォールバックも）
 *   "bi"  … ルートを中心に左右展開（Whimsical 風、デフォルト）
 */

const NODE_HEIGHT  = 50;   // 葉ノード1つが縦方向に占める高さ（px）
const CHILD_GAP    = 48;   // 親右端 → 子左端 の余白（px）
const MIN_NODE_W   = 80;
const MAX_NODE_W   = 240;
const CHAR_W_JP    = 14;
const CHAR_W_ASCII = 8;
const NODE_PADDING = 32;

function estimateNodeWidth(text) {
  if (!text) return MIN_NODE_W;
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 127 ? CHAR_W_JP : CHAR_W_ASCII;
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w + NODE_PADDING));
}

/**
 * @param {Array}  nodes
 * @param {string} layoutMode - "bi"（デフォルト）または "lr"
 * @returns {Object} { [nodeId]: { x, y } }
 */
export function calcLayout(nodes, layoutMode = "bi") {
  if (!nodes || nodes.length === 0) return {};

  // parent_id でグループ化
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

  // ルートが1つ・モードが "bi" なら双方向レイアウト
  if (layoutMode === "bi" && roots.length === 1) {
    return calcBidirectional(nodes, roots[0], byParent);
  }
  // それ以外は左→右一方向
  return calcUnidirectional(byParent, nodes);
}

// ─── 双方向レイアウト ──────────────────────────────────────

function calcBidirectional(nodes, root, byParent) {
  const positions = {};

  function subtreeHeight(nodeId) {
    const children = byParent[nodeId] || [];
    if (children.length === 0) return NODE_HEIGHT;
    return children.reduce((sum, c) => sum + subtreeHeight(c.id), 0);
  }

  /**
   * @param nodeId  - 配置するノード
   * @param xAnchor - 「このノードの接続側の端」のx座標
   * @param yStart  - サブツリーの上端y
   * @param dir     - 1=右展開, -1=左展開
   */
  function place(nodeId, xAnchor, yStart, dir) {
    const node    = nodes.find(n => n.id === nodeId);
    const myW     = estimateNodeWidth(node?.content ?? "");
    const h       = subtreeHeight(nodeId);

    // ノードの x（左端）: 右展開なら anchor から右、左展開なら anchor から左
    const nodeX = dir === 1 ? xAnchor : xAnchor - myW;
    positions[nodeId] = { x: nodeX, y: yStart + h / 2 - NODE_HEIGHT / 2 };

    // 子の anchor: 右展開なら右端+GAP、左展開なら左端-GAP
    const childAnchor = dir === 1 ? nodeX + myW + CHILD_GAP : nodeX - CHILD_GAP;

    let childY = yStart;
    for (const child of byParent[nodeId] || []) {
      childY = place(child.id, childAnchor, childY, dir);
    }
    return yStart + h;
  }

  // ルートの直接の子を右グループ・左グループに分割
  const rootChildren = byParent[root.id] || [];
  const half    = Math.ceil(rootChildren.length / 2);
  const right   = rootChildren.slice(0, half);
  const left    = rootChildren.slice(half);

  // 右サブツリーの合計高さ
  const rightH = right.reduce((s, c) => s + subtreeHeight(c.id), 0);
  // 左サブツリーの合計高さ
  const leftH  = left.reduce((s, c) => s + subtreeHeight(c.id), 0);

  // ルート自体の高さ: 右/左の大きい方に合わせる（中央揃え）
  const totalH = Math.max(NODE_HEIGHT, rightH, leftH);
  const rootW  = estimateNodeWidth(root.content ?? "");

  // ルートを中央に配置（x=0, y=中央）
  positions[root.id] = { x: 0, y: totalH / 2 - NODE_HEIGHT / 2 };

  // 右グループ: ルート右端 + GAP から右展開
  const rightAnchor = rootW + CHILD_GAP;
  const rightTopY   = totalH / 2 - rightH / 2;
  let ry = rightTopY;
  for (const child of right) {
    ry = place(child.id, rightAnchor, ry, 1);
  }

  // 左グループ: ルート左端 - GAP から左展開
  const leftAnchor = -CHILD_GAP;
  const leftTopY   = totalH / 2 - leftH / 2;
  let ly = leftTopY;
  for (const child of left) {
    ly = place(child.id, leftAnchor, ly, -1);
  }

  return positions;
}

// ─── 左→右一方向レイアウト ────────────────────────────────

function calcUnidirectional(byParent, nodes) {
  const positions = {};

  function subtreeHeight(nodeId) {
    const children = byParent[nodeId] || [];
    if (children.length === 0) return NODE_HEIGHT;
    return children.reduce((sum, c) => sum + subtreeHeight(c.id), 0);
  }

  function place(nodeId, x, yStart) {
    const node  = nodes.find(n => n.id === nodeId);
    const myW   = estimateNodeWidth(node?.content ?? "");
    const h     = subtreeHeight(nodeId);
    positions[nodeId] = { x, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    const childX = x + myW + CHILD_GAP;
    let childY = yStart;
    for (const child of byParent[nodeId] || []) {
      childY = place(child.id, childX, childY);
    }
    return yStart + h;
  }

  let yOffset = 0;
  for (const root of byParent["__root__"] || []) {
    yOffset = place(root.id, 0, yOffset);
  }
  return positions;
}

/** 後方互換エイリアス */
export function getPositions(nodes, layoutMode = "bi") {
  return calcLayout(nodes, layoutMode);
}
