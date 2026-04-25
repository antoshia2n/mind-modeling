/**
 * フラット配列（mm_nodes）を DFS 順のフラット配列に変換する
 *
 * 入力:  Supabase から取得したノードの配列（各ノードは id, parent_id, order_index を持つ）
 * 出力:  DFS（深さ優先）順に並んだノード配列。各ノードに depth（インデント深さ）を追加。
 *
 * @param {Array} nodes
 * @returns {Array} DFS 順ノード配列（各要素に depth が追加されている）
 */
export function flattenTree(nodes) {
  if (!nodes || nodes.length === 0) return [];

  // parent_id ごとにグループ化（null/undefined → "__root__"）
  const byParent = {};
  for (const node of nodes) {
    const key = node.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(node);
  }

  // 各グループを order_index 昇順でソート
  for (const key in byParent) {
    byParent[key].sort((a, b) => a.order_index - b.order_index);
  }

  const result = [];

  function dfs(parentId, depth) {
    const key = parentId ?? "__root__";
    const children = byParent[key] || [];
    for (const node of children) {
      result.push({ ...node, depth });
      // collapsed = true の場合は子孫を展開しない（Phase 2 以降で活用）
      if (!node.collapsed) {
        dfs(node.id, depth + 1);
      }
    }
  }

  dfs(null, 0);
  return result;
}
