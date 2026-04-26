/**
 * POST /api/internal/create-template-from-map
 * マップのノード構造を凍結してテンプレートとして保存する
 *
 * Body: { map_id, name, description?, user_id }
 * Response: { template_id, node_count }
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { map_id, name, user_id, description } = body;
  if (!map_id || !name || !user_id) return json({ error: "map_id, name, user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}`, "Content-Type": "application/json", "Prefer": "return=representation" };

  // ノードを全件取得
  const nodesRes = await fetch(`${supaUrl}/rest/v1/mm_nodes?map_id=eq.${map_id}&order=order_index.asc`, { headers: h });
  if (!nodesRes.ok) return json({ error: "Failed to fetch nodes" }, 500);
  const nodes = await nodesRes.json();

  if (nodes.length === 0) return json({ error: "Map has no nodes" }, 400);

  // temp_id を付与（実 id をそのまま使う）
  // linked_map_id は凍結データから除外する（仕様通り）
  const structureNodes = nodes.map((n, i) => ({
    temp_id:        n.id,
    parent_temp_id: n.parent_id ?? null,
    text:           n.content ?? "",
    bold:           n.bold ?? false,
    italic:         n.italic ?? false,
    strikethrough:  n.strikethrough ?? false,
    text_color:     n.text_color ?? null,
    node_color:     n.node_color ?? null,
    order_index:    n.order_index,
    depth:          computeDepth(n.id, nodes),
  }));

  const structure = { version: 1, nodes: structureNodes };

  // mm_templates に INSERT
  const tRes = await fetch(`${supaUrl}/rest/v1/mm_templates`, {
    method: "POST", headers: h,
    body: JSON.stringify({ user_id, name, description: description ?? null, source_map_id: map_id, structure, node_count: nodes.length }),
  });
  if (!tRes.ok) { const e = await tRes.text(); return json({ error: "template_insert_failed", detail: e }, 500); }
  const [tmpl] = await tRes.json();

  return json({ template_id: tmpl.id, node_count: nodes.length }, 200);
}

/** ノードの深さを計算（parent_id チェーンを辿る） */
function computeDepth(nodeId, nodes) {
  let depth = 0, current = nodes.find(n => n.id === nodeId);
  while (current && current.parent_id) {
    depth++;
    current = nodes.find(n => n.id === current.parent_id);
    if (depth > 50) break; // 循環参照ガード
  }
  return depth;
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
