/**
 * POST /api/internal/move-folder
 * Body: { folder_id, user_id, parent_id? }  -- parent_id null でルートへ
 *
 * 自己ループ防止：folder_id と parent_id が同じはNG
 * 循環参照防止：parent_id の祖先をたどって folder_id が含まれていないかチェック
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { folder_id, user_id, parent_id } = body;
  if (!folder_id || !user_id) return json({ error: "folder_id and user_id are required" }, 400);

  // 自己ループ防止
  if (folder_id === parent_id) return json({ error: "self_loop: フォルダを自分自身の中に移動できません" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "Content-Type": "application/json", "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  // 循環参照防止：parent_id の祖先チェーンに folder_id が含まれていないか確認
  if (parent_id) {
    const allRes = await fetch(`${supaUrl}/rest/v1/mm_folders?user_id=eq.${user_id}&select=id,parent_id`, { headers: h });
    const allFolders = await allRes.json();
    const folderMap = Object.fromEntries(allFolders.map(f => [f.id, f.parent_id]));

    let cur = parent_id;
    let depth = 0;
    while (cur && depth < 20) {
      if (cur === folder_id) return json({ error: "circular_ref: 循環参照が発生するため移動できません" }, 400);
      cur = folderMap[cur];
      depth++;
    }
  }

  const res = await fetch(`${supaUrl}/rest/v1/mm_folders?id=eq.${folder_id}&user_id=eq.${user_id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ parent_id: parent_id ?? null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return json({ error: "DB error" }, 500);
  return json({ ok: true }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
