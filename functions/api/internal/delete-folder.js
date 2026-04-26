/**
 * POST /api/internal/delete-folder
 * Body: { folder_id, user_id, mode? }
 *   mode = "move_to_root"（デフォルト）: 配下フォルダ・マップをルートへ
 *   mode = "move_to_parent"           : 配下フォルダ・マップを親フォルダへ
 *
 * カスケード削除は絶対にサポートしない（データ消失防止）
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { folder_id, user_id, mode = "move_to_root" } = body;
  if (!folder_id || !user_id) return json({ error: "folder_id and user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "Content-Type": "application/json", "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  // 削除対象フォルダの情報を取得（parent_id が必要）
  const fRes = await fetch(`${supaUrl}/rest/v1/mm_folders?id=eq.${folder_id}&user_id=eq.${user_id}&limit=1`, { headers: h });
  const [folder] = await fRes.json();
  if (!folder) return json({ error: "folder_not_found" }, 404);

  const new_parent_id = mode === "move_to_parent" ? (folder.parent_id ?? null) : null;
  let affected_count = 0;

  // 直下の子フォルダを移動
  const childFolderRes = await fetch(`${supaUrl}/rest/v1/mm_folders?parent_id=eq.${folder_id}&user_id=eq.${user_id}`, { headers: h });
  const childFolders = await childFolderRes.json();
  if (childFolders.length > 0) {
    await fetch(`${supaUrl}/rest/v1/mm_folders?parent_id=eq.${folder_id}&user_id=eq.${user_id}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ parent_id: new_parent_id, updated_at: new Date().toISOString() }),
    });
    affected_count += childFolders.length;
  }

  // 直下のマップを移動
  const childMapRes = await fetch(`${supaUrl}/rest/v1/mm_maps?folder_id=eq.${folder_id}&user_id=eq.${user_id}`, { headers: h });
  const childMaps = await childMapRes.json();
  if (childMaps.length > 0) {
    await fetch(`${supaUrl}/rest/v1/mm_maps?folder_id=eq.${folder_id}&user_id=eq.${user_id}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ folder_id: new_parent_id }),
    });
    affected_count += childMaps.length;
  }

  // フォルダ本体を削除
  const delRes = await fetch(`${supaUrl}/rest/v1/mm_folders?id=eq.${folder_id}&user_id=eq.${user_id}`, {
    method: "DELETE", headers: h,
  });
  if (!delRes.ok) return json({ error: "DB error" }, 500);

  return json({ ok: true, affected_count }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
