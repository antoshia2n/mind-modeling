/**
 * POST /api/internal/insert-template-as-subtree
 * 既存マップのノードの子として、テンプレートのサブツリーを挿入する
 *
 * Body: { template_id, target_map_id, parent_node_id, user_id }
 * Response: { inserted_count, root_node_id }
 *
 * パターンP対策：深さ単位バッチINSERT
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { template_id, target_map_id, parent_node_id, user_id } = body;
  if (!template_id || !target_map_id || !user_id)
    return json({ error: "template_id, target_map_id, user_id are required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}`, "Content-Type": "application/json", "Prefer": "return=representation" };

  // テンプレートを取得
  const tRes = await fetch(`${supaUrl}/rest/v1/mm_templates?id=eq.${template_id}&user_id=eq.${user_id}&limit=1`, { headers: h });
  if (!tRes.ok) return json({ error: "template_not_found" }, 404);
  const [tmpl] = await tRes.json();
  if (!tmpl) return json({ error: "template_not_found" }, 404);

  const structure = tmpl.structure;
  if (!structure?.nodes?.length) return json({ error: "empty_template" }, 400);

  // パターンP：深さ単位バッチINSERT
  const result = await insertStructureByDepth(
    structure, target_map_id, parent_node_id ?? null, user_id, supaUrl, h
  );
  if (!result.ok) return json({ error: "node_insert_failed", detail: result.error }, 500);

  // use_count と last_used_at を更新（ベストエフォート）
  await fetch(`${supaUrl}/rest/v1/mm_templates?id=eq.${template_id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ use_count: (tmpl.use_count ?? 0) + 1, last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  return json({ inserted_count: result.insertedCount, root_node_id: result.rootNodeId }, 200);
}

async function insertStructureByDepth(structure, mapId, parentNodeId, userId, supaUrl, h) {
  const nodes    = structure.nodes ?? [];
  if (nodes.length === 0) return { ok: true, insertedCount: 0, rootNodeId: null };

  const maxDepth = Math.max(...nodes.map(n => n.depth ?? 0));
  const tempIdToRealId = {};
  let insertedCount = 0;
  let rootNodeId = null;

  for (let depth = 0; depth <= maxDepth; depth++) {
    const batch = nodes.filter(n => (n.depth ?? 0) === depth);
    if (batch.length === 0) continue;

    const siblingCounters = {};
    const rows = batch.map(n => {
      const ptid = n.parent_temp_id ?? "__root__";
      siblingCounters[ptid] = (siblingCounters[ptid] ?? 0) + 1;

      const parent_id = depth === 0
        ? (parentNodeId ?? null)
        : (tempIdToRealId[n.parent_temp_id] ?? null);

      return {
        user_id,
        map_id:      mapId,
        parent_id,
        content:     n.text ?? "",
        order_index: n.order_index ?? (siblingCounters[ptid] * 1024),
        bold:          n.bold          ?? false,
        italic:        n.italic        ?? false,
        strikethrough: n.strikethrough ?? false,
        text_color:    n.text_color    ?? null,
        node_color:    n.node_color    ?? null,
      };
    });

    const res = await fetch(`${supaUrl}/rest/v1/mm_nodes`, {
      method: "POST", headers: h,
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const e = await res.text();
      return { ok: false, insertedCount, rootNodeId, error: e };
    }
    const inserted = await res.json();

    batch.forEach((n, i) => {
      tempIdToRealId[n.temp_id] = inserted[i]?.id;
      if (depth === 0 && i === 0) rootNodeId = inserted[i]?.id;
    });
    insertedCount += inserted.length;
  }

  return { ok: true, insertedCount, rootNodeId };
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
