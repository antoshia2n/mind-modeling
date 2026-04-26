/**
 * GET /api/internal/list-share-links?map_id=xxx&active=true
 * 共有リンク一覧を返す内部 API
 */
export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: corsHeaders(),
    });
  }

  const url      = new URL(request.url);
  const map_id   = url.searchParams.get("map_id");
  const activeQs = url.searchParams.get("active");  // "true" | "false" | null(全件)

  let query = `${env.VITE_SUPABASE_URL}/rest/v1/mm_share_links?order=created_at.desc`;
  if (map_id)   query += `&map_id=eq.${map_id}`;
  if (activeQs !== null) query += `&active=eq.${activeQs}`;

  const res = await fetch(query, {
    headers: {
      "apikey":        env.VITE_SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "DB error" }), {
      status: 500, headers: corsHeaders(),
    });
  }

  const rows = await res.json();
  const base_url = env.APP_BASE_URL ?? "https://mm.shia2n.jp";

  // share_url を追加して返す
  const enriched = rows.map(row => ({
    ...row,
    share_url: `${base_url}/share/${row.share_token}`,
  }));

  return new Response(JSON.stringify(enriched), {
    status: 200, headers: corsHeaders(),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
