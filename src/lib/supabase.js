/**
 * Mind-Modeling 専用 Supabase CRUD
 * shia2n-core の汎用 CRUD（fetchAll/insertOne 等）では
 * map_id フィルタや parent_id のツリー操作が難しいため独自実装する。
 */
import { supabase } from "shia2n-core";

// ─────────────────────────────────────────────
// mm_maps
// ─────────────────────────────────────────────

/** ユーザーのマップ一覧（更新日時の新しい順） */
export async function getMaps(uid) {
  const { data, error } = await supabase
    .from("mm_maps")
    .select("*")
    .eq("user_id", uid)
    .eq("archived", false)
    .order("updated_at", { ascending: false });
  if (error) console.error("[mm] getMaps:", error);
  return data || [];
}

/** マップを新規作成して返す */
export async function createMap(uid, title = "Untitled") {
  const { data, error } = await supabase
    .from("mm_maps")
    .insert([{ user_id: uid, title }])
    .select()
    .single();
  if (error) console.error("[mm] createMap:", error);
  return data;
}

/** 単一マップを取得 */
export async function getMap(mapId) {
  const { data, error } = await supabase
    .from("mm_maps")
    .select("*")
    .eq("id", mapId)
    .single();
  if (error) console.error("[mm] getMap:", error);
  return data;
}

/** マップを更新（updated_at を自動更新） */
export async function updateMap(mapId, updates) {
  const { error } = await supabase
    .from("mm_maps")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  if (error) console.error("[mm] updateMap:", error);
}

/** マップを削除（mm_nodes は ON DELETE CASCADE で自動削除） */
export async function deleteMap(mapId) {
  const { error } = await supabase
    .from("mm_maps")
    .delete()
    .eq("id", mapId);
  if (error) console.error("[mm] deleteMap:", error);
}

// ─────────────────────────────────────────────
// mm_nodes
// ─────────────────────────────────────────────

/** マップのノードを全件取得（order_index 昇順） */
export async function getNodes(mapId) {
  const { data, error } = await supabase
    .from("mm_nodes")
    .select("*")
    .eq("map_id", mapId)
    .order("order_index", { ascending: true });
  if (error) console.error("[mm] getNodes:", error);
  return data || [];
}

/** ノードを新規作成して返す */
export async function createNode(uid, mapId, parentId, orderIndex, content = "") {
  const { data, error } = await supabase
    .from("mm_nodes")
    .insert([{
      user_id: uid,
      map_id: mapId,
      parent_id: parentId ?? null,   // undefined → null に正規化
      order_index: orderIndex,
      content,
    }])
    .select()
    .single();
  if (error) console.error("[mm] createNode:", error);
  return data;
}

/** ノードを更新（updated_at を自動更新） */
export async function updateNode(nodeId, updates) {
  const { error } = await supabase
    .from("mm_nodes")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", nodeId);
  if (error) console.error("[mm] updateNode:", error);
}

/**
 * ノードを削除
 * ON DELETE CASCADE により子孫ノードも自動削除される
 */
export async function deleteNode(nodeId) {
  const { error } = await supabase
    .from("mm_nodes")
    .delete()
    .eq("id", nodeId);
  if (error) console.error("[mm] deleteNode:", error);
}

/**
 * 複数ノードの order_index / parent_id を一括更新
 * 並び替え時の再採番で使用
 * @param {Array<{id: string, order_index: number, parent_id: string|null}>} updates
 */
export async function updateNodesBatch(updates) {
  for (const u of updates) {
    const { error } = await supabase
      .from("mm_nodes")
      .update({
        order_index: u.order_index,
        parent_id: u.parent_id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", u.id);
    if (error) console.error("[mm] updateNodesBatch:", error, u);
  }
}
