import { supabase } from "shia2n-core";

const PDF_BUCKET = "mm-pdfs";
const PDF_MAX_MB = 20;

// ─── mm_maps ──────────────────────────────────────────────

export async function getMaps(uid) {
  const { data, error } = await supabase
    .from("mm_maps").select("*").eq("user_id", uid).eq("archived", false).order("updated_at", { ascending: false });
  if (error) console.error("[mm] getMaps:", error);
  return data || [];
}
export async function createMap(uid, title = "Untitled") {
  const { data, error } = await supabase.from("mm_maps").insert([{ user_id: uid, title }]).select().single();
  if (error) console.error("[mm] createMap:", error);
  return data;
}
export async function getMap(mapId) {
  const { data, error } = await supabase.from("mm_maps").select("*").eq("id", mapId).single();
  if (error) console.error("[mm] getMap:", error);
  return data;
}
export async function updateMap(mapId, updates) {
  const { error } = await supabase.from("mm_maps").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", mapId);
  if (error) console.error("[mm] updateMap:", error);
}
export async function deleteMap(mapId) {
  const { error } = await supabase.from("mm_maps").delete().eq("id", mapId);
  if (error) console.error("[mm] deleteMap:", error);
}

// ─── mm_nodes ─────────────────────────────────────────────

export async function getNodes(mapId) {
  const { data, error } = await supabase.from("mm_nodes").select("*").eq("map_id", mapId).order("order_index", { ascending: true });
  if (error) console.error("[mm] getNodes:", error);
  return data || [];
}
export async function createNode(uid, mapId, parentId, orderIndex, content = "", format = {}) {
  const { data, error } = await supabase.from("mm_nodes").insert([{
    user_id: uid, map_id: mapId, parent_id: parentId ?? null, order_index: orderIndex, content,
    ...(format.bold          !== undefined && { bold:          format.bold }),
    ...(format.italic        !== undefined && { italic:        format.italic }),
    ...(format.strikethrough !== undefined && { strikethrough: format.strikethrough }),
    ...(format.text_color    !== undefined && { text_color:    format.text_color }),
    ...(format.node_color    !== undefined && { node_color:    format.node_color }),
  }]).select().single();
  if (error) console.error("[mm] createNode:", error);
  return data;
}
export async function updateNode(nodeId, updates) {
  const { error } = await supabase.from("mm_nodes").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", nodeId);
  if (error) console.error("[mm] updateNode:", error);
}
export async function deleteNode(nodeId) {
  const { error } = await supabase.from("mm_nodes").delete().eq("id", nodeId);
  if (error) console.error("[mm] deleteNode:", error);
}

/**
 * Undo 用：削除されたノードを同じ UUID で復元する
 * parent が先に存在している必要がある（呼び出し側で深さ順に実行すること）
 */
export async function restoreNode(node) {
  const { error } = await supabase.from("mm_nodes").insert([{
    id:            node.id,
    user_id:       node.user_id,
    map_id:        node.map_id,
    parent_id:     node.parent_id,
    content:       node.content       ?? "",
    order_index:   node.order_index   ?? 0,
    collapsed:     node.collapsed     ?? false,
    bold:          node.bold          ?? false,
    italic:        node.italic        ?? false,
    strikethrough: node.strikethrough ?? false,
    text_color:    node.text_color    ?? null,
    node_color:    node.node_color    ?? null,
    linked_map_id: node.linked_map_id ?? null,
    pdf_url:       node.pdf_url       ?? null,
    pdf_filename:  node.pdf_filename  ?? null,
  }]);
  if (error) console.error("[mm] restoreNode:", error);
}

// ─── PDF Storage ──────────────────────────────────────────

export async function uploadPdf(uid, nodeId, file) {
  if (!file || file.type !== "application/pdf") return null;
  if (file.size > PDF_MAX_MB * 1024 * 1024) return null;
  const path = `${uid}/${nodeId}.pdf`;
  const { error } = await supabase.storage.from(PDF_BUCKET).upload(path, file, { upsert: true, contentType: "application/pdf" });
  if (error) { console.error("[mm] uploadPdf:", error); return null; }
  return path;
}
export async function getPdfSignedUrl(storagePath) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(storagePath, 14400);
  if (error) { console.error("[mm] getPdfSignedUrl:", error); return null; }
  return data.signedUrl;
}
export async function deletePdf(storagePath) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(PDF_BUCKET).remove([storagePath]);
  if (error) console.error("[mm] deletePdf:", error);
}
