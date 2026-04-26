/**
 * POST /api/internal/update-node-link
 * ノードのマップリンクを更新する（NULL でリンク解除）
 *
 * Body: { node_id, linked_map_id, user_id }
 *   linked_map_id = null → リンク解除
 * Response: { ok, node }
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { node_id, linked_map_id, user_id } = body;
  if (!node_id || !user_id) return json({ error: "node_id and user_id are required" }, 400);

  // 自己ループ防止はフロント側で行う（linked_map_id が現在のマップと同じかチェックは不要、
  // フロントで現在マップを除外している）

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}`, "Content-Type": "application/json", "Prefer": "return=representation" };

  const res = await fetch(`${supaUrl}/rest/v1/mm_nodes?id=eq.${node_id}&user_id=eq.${user_id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ linked_map_id: linked_map_id ?? null, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) { const e = await res.text(); return json({ error: "update_failed", detail: e }, 500); }
  const [node] = await res.json();

  return json({ ok: true, node }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
