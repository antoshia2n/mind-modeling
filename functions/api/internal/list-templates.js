/**
 * GET /api/internal/list-templates?user_id=xxx&search=xxx&limit=50
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  const url     = new URL(request.url);
  const user_id = url.searchParams.get("user_id");
  const search  = url.searchParams.get("search")?.trim() ?? "";
  const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
  if (!user_id) return json({ error: "user_id is required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  let query = `${supaUrl}/rest/v1/mm_templates?select=id,name,description,node_count,use_count,last_used_at,created_at`
    + `&user_id=eq.${user_id}&order=created_at.desc&limit=${limit}`;

  const res = await fetch(query, { headers: h });
  if (!res.ok) return json({ error: "DB error" }, 500);
  let items = await res.json();

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(t => (t.name ?? "").toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
  }

  return json({ items, total: items.length }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
