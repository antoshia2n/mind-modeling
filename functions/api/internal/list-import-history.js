/**
 * GET /api/internal/list-import-history?user_id=xxx&limit=50&search=xxx
 * インポート履歴一覧を返す内部 API
 *
 * Headers:
 *   Authorization: Bearer {MM_INTERNAL_SECRET}
 *
 * Response:
 *   { items: [{ id, map_id, map_title, node_count, source_note, imported_at }], total }
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url     = new URL(request.url);
  const user_id = url.searchParams.get("user_id");
  const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const search  = url.searchParams.get("search")?.trim() ?? "";

  if (!user_id) return json({ error: "user_id is required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const headers = {
    "apikey":        supaKey,
    "Authorization": `Bearer ${supaKey}`,
  };

  // mm_import_log を取得（mm_maps を JOIN して map_title も取得）
  // Supabase REST では ?select=*,mm_maps(title) で外部キー結合できる
  let query = `${supaUrl}/rest/v1/mm_import_log`
    + `?select=id,map_id,source_note,node_count,imported_at,mm_maps(title)`
    + `&user_id=eq.${user_id}`
    + `&order=imported_at.desc`
    + `&limit=${limit}`;

  const res = await fetch(query, { headers });
  if (!res.ok) return json({ error: "DB error" }, 500);

  let rows = await res.json();

  // 検索フィルタ（source_note または map_title に一致）
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r => {
      const note  = (r.source_note ?? "").toLowerCase();
      const title = (r.mm_maps?.title ?? "").toLowerCase();
      return note.includes(q) || title.includes(q);
    });
  }

  const items = rows.map(r => ({
    id:          r.id,
    map_id:      r.map_id,
    map_title:   r.mm_maps?.title ?? "(削除済み)",
    node_count:  r.node_count,
    source_note: r.source_note,
    imported_at: r.imported_at,
  }));

  return json({ items, total: items.length }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
