/**
 * POST /api/internal/update-folder
 * Body: { folder_id, user_id, name?, parent_id?, order_index? }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { folder_id, user_id, name, parent_id, order_index } = body;
  if (!folder_id || !user_id) return json({ error: "folder_id and user_id are required" }, 400);

  const updates = { updated_at: new Date().toISOString() };
  if (name !== undefined)        updates.name        = name.trim();
  if (parent_id !== undefined)   updates.parent_id   = parent_id ?? null;
  if (order_index !== undefined) updates.order_index = order_index;

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "Content-Type": "application/json", "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  const res = await fetch(`${supaUrl}/rest/v1/mm_folders?id=eq.${folder_id}&user_id=eq.${user_id}`, {
    method: "PATCH", headers: h, body: JSON.stringify(updates),
  });
  if (!res.ok) return json({ error: "DB error" }, 500);
  return json({ ok: true }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
