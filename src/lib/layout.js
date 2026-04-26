/**
 * mm_nodes から react-flow 用の位置（x, y）を計算する。
 * 左→右ツリーレイアウト。
 *
 * x 軸：親ノードのテキスト幅を推定し、その分だけ右に子を配置する。
 *       これにより、長い親ノードと子ノードが重ならない。
 *
 * y 軸：サブツリーの高さに応じて均等に配置する。
 */

const NODE_HEIGHT   = 50;  // 葉ノード1つが縦方向に占める高さ（px）
const CHILD_GAP     = 48;  // 親の右端から子の左端までの余白（px）
const MIN_NODE_W    = 80;  // ノードの最小幅（px）
const MAX_NODE_W    = 240; // ノードの最大幅（px）
const CHAR_W_JP     = 14;  // 日本語1文字の推定幅（px、14px font）
const CHAR_W_ASCII  = 8;   // ASCII 1文字の推定幅（px）
const NODE_PADDING  = 32;  // 左右パディング合計（px）

/**
 * テキストからノードの推定幅を計算する。
 * 日本語（charCode > 127）は広め、ASCII は狭めで計算。
 *
 * @param {string} text
 * @returns {number} 推定幅（px）
 */
function estimateNodeWidth(text) {
  if (!text) return MIN_NODE_W;
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 127 ? CHAR_W_JP : CHAR_W_ASCII;
  }
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w + NODE_PADDING));
}

/**
 * mm_nodes のフラット配列から react-flow 用の位置を計算する。
 *
 * @param {Array} nodes - mm_nodes の配列（id, parent_id, order_index, content を持つ）
 * @returns {Object} { [nodeId]: { x, y } }
 */
export function calcLayout(nodes) {
  if (!nodes || nodes.length === 0) return {};

  const byParent = {};
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(n);
  }
  for (const key in byParent) {
    byParent[key].sort((a, b) => a.order_index - b.order_index);
  }

  const positions = {};

  /** nodeId のサブツリー全体が縦に占める高さ（px） */
  function subtreeHeight(nodeId) {
    const children = byParent[nodeId] || [];
    if (children.length === 0) return NODE_HEIGHT;
    return children.reduce((sum, c) => sum + subtreeHeight(c.id), 0);
  }

  /**
   * nodeId を (x, yStart) に配置する。
   * x は親ノードの右端 + CHILD_GAP として渡される（最初のルートは 0）。
   * 返り値：このサブツリーの終端 y（次の兄弟の yStart になる）
   */
  function place(nodeId, x, yStart) {
    const node = nodes.find(n => n.id === nodeId);
    const h    = subtreeHeight(nodeId);

    // 自分の y はサブツリーの中央
    positions[nodeId] = { x, y: yStart + h / 2 - NODE_HEIGHT / 2 };

    // 子の x = 自分の右端 + CHILD_GAP
    const myWidth  = estimateNodeWidth(node?.content ?? "");
    const childX   = x + myWidth + CHILD_GAP;

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

/**
 * getPositions: 互換性のためのエイリアス（常に calcLayout を使う）
 */
export function getPositions(nodes) {
  return calcLayout(nodes);
}
