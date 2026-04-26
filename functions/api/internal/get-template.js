/**
 * GET /api/internal/get-template?template_id=xxx&user_id=xxx
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  const url         = new URL(request.url);
  const template_id = url.searchParams.get("template_id");
  const user_id     = url.searchParams.get("user_id");
  if (!template_id || !user_id) return json({ error: "template_id and user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  const res = await fetch(`${supaUrl}/rest/v1/mm_templates?id=eq.${template_id}&user_id=eq.${user_id}&limit=1`, { headers: h });
  if (!res.ok) return json({ error: "DB error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ error: "not_found" }, 404);

  return json(rows[0], 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
