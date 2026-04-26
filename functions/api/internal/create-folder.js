/**
 * POST /api/internal/create-folder
 * Body: { user_id, name, parent_id? }
 * Response: { folder_id }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { user_id, name, parent_id } = body;
  if (!user_id || !name?.trim()) return json({ error: "user_id and name are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "Content-Type": "application/json", "apikey": supaKey, "Authorization": `Bearer ${supaKey}`, "Prefer": "return=representation" };

  const res = await fetch(`${supaUrl}/rest/v1/mm_folders`, {
    method: "POST", headers: h,
    body: JSON.stringify({ user_id, name: name.trim(), parent_id: parent_id ?? null, order_index: Math.floor(Date.now() / 1000) }),
  });
  if (!res.ok) return json({ error: "DB error", detail: await res.text() }, 500);
  const [row] = await res.json();
  return json({ folder_id: row.id }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
