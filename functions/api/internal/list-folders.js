/**
 * GET /api/internal/list-folders?user_id=xxx&parent_id=xxx
 * parent_id 未指定 → 全フォルダを返す
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const user_id   = url.searchParams.get("user_id");
  const parent_id = url.searchParams.get("parent_id"); // null or uuid
  if (!user_id) return json({ error: "user_id is required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  let query = `${supaUrl}/rest/v1/mm_folders?user_id=eq.${user_id}&order=order_index.asc`;
  if (parent_id === "null" || parent_id === "") query += `&parent_id=is.null`;
  else if (parent_id) query += `&parent_id=eq.${parent_id}`;

  const res = await fetch(query, { headers: h });
  if (!res.ok) return json({ error: "DB error" }, 500);
  return json({ items: await res.json() }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
