/**
 * mm_nodes のフラット配列から react-flow 用の位置情報（x, y）を計算する。
 * 左→右のツリーレイアウト（親が左、子が右に展開）。
 *
 * @param {Array} nodes - mm_nodes の配列（id, parent_id, order_index を持つ）
 * @returns {Object} { [nodeId]: { x, y } }
 */
export function calcLayout(nodes) {
  if (!nodes || nodes.length === 0) return {};

  const NODE_HEIGHT = 100;  // 葉ノード1つが縦方向に占める高さ（余白込み）
  const X_SPACING   = 220;  // 親→子の水平距離（px）

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

/**
 * 保存済み x/y があればそれを使い、なければ calcLayout を使う。
 * （現在は常に自動整列なので呼ばれないが、互換性のために残す）
 */
export function getPositions(nodes) {
  return calcLayout(nodes);
}
