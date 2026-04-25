/**
 * mm_nodes から react-flow 用の位置を決定する。
 * n.x / n.y が保存済み（非 null）ならその値を使う。
 * null なら自動レイアウトで計算した値を使う。
 *
 * @param {Array} nodes
 * @returns {Object} { [nodeId]: { x, y } }
 */
export function getPositions(nodes) {
  const auto = calcLayout(nodes);
  const result = {};
  for (const n of nodes) {
    if (n.x != null && n.y != null) {
      result[n.id] = { x: n.x, y: n.y };
    } else {
      result[n.id] = auto[n.id] ?? { x: 0, y: 0 };
    }
  }
  return result;
}

/**
 * フラット配列から左→右ツリーレイアウトの位置を計算する。
 * x/y が null のノードのフォールバックとして使用。
 *
 * @param {Array} nodes
 * @returns {Object} { [nodeId]: { x, y } }
 */
export function calcLayout(nodes) {
  if (!nodes || nodes.length === 0) return {};

  const NODE_HEIGHT = 70;  // 1ノードが占める縦幅（余白込み）
  const X_SPACING   = 280; // 親→子の水平距離（px）

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

  function subtreeHeight(nodeId) {
    const children = byParent[nodeId] || [];
    if (children.length === 0) return NODE_HEIGHT;
    return children.reduce((sum, c) => sum + subtreeHeight(c.id), 0);
  }

  function place(nodeId, x, yStart) {
    const h = subtreeHeight(nodeId);
    positions[nodeId] = { x, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    let childY = yStart;
    for (const child of byParent[nodeId] || []) {
      childY = place(child.id, x + X_SPACING, childY);
    }
    return yStart + h;
  }

  let yOffset = 0;
  for (const root of byParent["__root__"] || []) {
    yOffset = place(root.id, 0, yOffset);
  }

  return positions;
}
