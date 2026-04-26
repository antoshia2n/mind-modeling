/**
 * POST /api/internal/delete-template
 * Body: { template_id, user_id }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { template_id, user_id } = body;
  if (!template_id || !user_id) return json({ error: "template_id and user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  const res = await fetch(`${supaUrl}/rest/v1/mm_templates?id=eq.${template_id}&user_id=eq.${user_id}`, { method: "DELETE", headers: h });
  if (!res.ok) return json({ error: "DB error" }, 500);
  return json({ ok: true }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
