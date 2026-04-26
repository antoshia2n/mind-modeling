/**
 * POST /api/internal/create-map-from-template
 * テンプレートから新規マップを作成する
 *
 * Body: { template_id, title, user_id }
 * Response: { map_id, node_count }
 *
 * パターンP対策：深さ単位バッチINSERT
 * テンプレの depth=0 → INSERT → ID取得 → depth=1 → INSERT ... の順で
 * 親が必ず先にINSERTされるためFK制約を安全に通過する
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { template_id, title, user_id } = body;
  if (!template_id || !title || !user_id) return json({ error: "template_id, title, user_id are required" }, 400);

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

  // mm_maps INSERT
  const mapRes = await fetch(`${supaUrl}/rest/v1/mm_maps`, {
    method: "POST", headers: h,
    body: JSON.stringify({ user_id, title }),
  });
  if (!mapRes.ok) { const e = await mapRes.text(); return json({ error: "map_insert_failed", detail: e }, 500); }
  const [mapRow] = await mapRes.json();
  const map_id = mapRow.id;

  // パターンP：深さ単位バッチINSERT
  const result = await insertStructureByDepth(structure, map_id, null, user_id, supaUrl, h);
  if (!result.ok) {
    // ロールバック
    await fetch(`${supaUrl}/rest/v1/mm_maps?id=eq.${map_id}`, { method: "DELETE", headers: h }).catch(() => {});
    return json({ error: "node_insert_failed", detail: result.error }, 500);
  }

  // use_count と last_used_at を更新（ベストエフォート）
  await fetch(`${supaUrl}/rest/v1/mm_templates?id=eq.${template_id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ use_count: (tmpl.use_count ?? 0) + 1, last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  return json({ map_id, node_count: result.insertedCount }, 200);
}

/**
 * パターンP：テンプレート構造を深さ単位でバッチINSERT
 * @param {Object}      structure    - mm_templates.structure
 * @param {string}      mapId        - 挿入先マップID
 * @param {string|null} parentNodeId - サブツリー挿入時の親ノードID（新規マップ時は null）
 * @param {string}      userId
 * @param {string}      supaUrl
 * @param {Object}      h            - Supabase headers
 * @returns {{ ok: boolean, insertedCount: number, rootNodeId: string|null, error?: string }}
 */
async function insertStructureByDepth(structure, mapId, parentNodeId, userId, supaUrl, h) {
  const nodes    = structure.nodes ?? [];
  if (nodes.length === 0) return { ok: true, insertedCount: 0, rootNodeId: null };

  const maxDepth = Math.max(...nodes.map(n => n.depth ?? 0));
  const tempIdToRealId = {};  // temp_id → 実際の mm_nodes.id
  let insertedCount = 0;
  let rootNodeId = null;

  for (let depth = 0; depth <= maxDepth; depth++) {
    const batch = nodes.filter(n => (n.depth ?? 0) === depth);
    if (batch.length === 0) continue;

    // 兄弟内での order_index をカウント（同 parent_temp_id の何番目か）
    const siblingCounters = {};
    const rows = batch.map(n => {
      const ptid = n.parent_temp_id ?? "__root__";
      siblingCounters[ptid] = (siblingCounters[ptid] ?? 0) + 1;

      let parent_id;
      if (depth === 0) {
        // テンプレのルートノードを parentNodeId の子として挿入（null なら最上位）
        parent_id = parentNodeId ?? null;
      } else {
        parent_id = tempIdToRealId[n.parent_temp_id] ?? null;
      }

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

    // temp_id → 実 ID のマッピングを記録
    batch.forEach((n, i) => {
      tempIdToRealId[n.temp_id] = inserted[i]?.id;
      if (depth === 0 && i === 0) rootNodeId = inserted[i]?.id;
    });
    insertedCount += inserted.length;
  }

  return { ok: true, insertedCount, rootNodeId };
}

export { insertStructureByDepth };

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() {
  return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
}
