/**
 * Mind-Modeling 専用 Supabase CRUD
 */
import { supabase } from "shia2n-core";

// ─────────────────────────────────────────────
// mm_maps
// ─────────────────────────────────────────────

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

export async function createMap(uid, title = "Untitled") {
  const { data, error } = await supabase
    .from("mm_maps")
    .insert([{ user_id: uid, title }])
    .select()
    .single();
  if (error) console.error("[mm] createMap:", error);
  return data;
}

export async function getMap(mapId) {
  const { data, error } = await supabase
    .from("mm_maps")
    .select("*")
    .eq("id", mapId)
    .single();
  if (error) console.error("[mm] getMap:", error);
  return data;
}

export async function updateMap(mapId, updates) {
  const { error } = await supabase
    .from("mm_maps")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", mapId);
  if (error) console.error("[mm] updateMap:", error);
}

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

export async function getNodes(mapId) {
  const { data, error } = await supabase
    .from("mm_nodes")
    .select("*")
    .eq("map_id", mapId)
    .order("order_index", { ascending: true });
  if (error) console.error("[mm] getNodes:", error);
  return data || [];
}

/**
 * ノードを新規作成して返す
 *
 * @param {string} uid
 * @param {string} mapId
 * @param {string|null} parentId
 * @param {number} orderIndex
 * @param {string} content
 * @param {object} format - 書式設定（コピペ時に引き継ぐ）
 *   { bold, italic, strikethrough, text_color, node_color }
 */
export async function createNode(uid, mapId, parentId, orderIndex, content = "", format = {}) {
  const { data, error } = await supabase
    .from("mm_nodes")
    .insert([{
      user_id:     uid,
      map_id:      mapId,
      parent_id:   parentId ?? null,
      order_index: orderIndex,
      content,
      // 書式フィールド（未指定は DB デフォルト値が入る）
      ...(format.bold          !== undefined && { bold:          format.bold }),
      ...(format.italic        !== undefined && { italic:        format.italic }),
      ...(format.strikethrough !== undefined && { strikethrough: format.strikethrough }),
      ...(format.text_color    !== undefined && { text_color:    format.text_color }),
      ...(format.node_color    !== undefined && { node_color:    format.node_color }),
    }])
    .select()
    .single();
  if (error) console.error("[mm] createNode:", error);
  return data;
}

export async function updateNode(nodeId, updates) {
  const { error } = await supabase
    .from("mm_nodes")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", nodeId);
  if (error) console.error("[mm] updateNode:", error);
}

export async function deleteNode(nodeId) {
  const { error } = await supabase
    .from("mm_nodes")
    .delete()
    .eq("id", nodeId);
  if (error) console.error("[mm] deleteNode:", error);
}

export async function updateNodesBatch(updates) {
  for (const u of updates) {
    const { error } = await supabase
      .from("mm_nodes")
      .update({
        order_index: u.order_index,
        parent_id:   u.parent_id ?? null,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", u.id);
    if (error) console.error("[mm] updateNodesBatch:", error, u);
  }
}
