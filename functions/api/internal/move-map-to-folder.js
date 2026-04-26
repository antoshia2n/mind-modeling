/**
 * POST /api/internal/move-map-to-folder
 * Body: { map_id, user_id, folder_id? }  -- folder_id null でルートへ
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { map_id, user_id, folder_id } = body;
  if (!map_id || !user_id) return json({ error: "map_id and user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "Content-Type": "application/json", "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  const res = await fetch(`${supaUrl}/rest/v1/mm_maps?id=eq.${map_id}&user_id=eq.${user_id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ folder_id: folder_id ?? null }),
  });
  if (!res.ok) return json({ error: "DB error" }, 500);
  return json({ ok: true }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
