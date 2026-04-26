/**
 * GET /api/internal/get-share-content?token=xxx
 * 公開ビュー用：token からマップ + ノードを返す（認証不要）
 *
 * - active=false または expires_at 経過済み → 404
 * - view_count と last_viewed_at をベストエフォートで更新
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const url   = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ error: "token is required" }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const headers = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  // share_link を取得（active なものだけ）
  const linkRes = await fetch(
    `${supaUrl}/rest/v1/mm_share_links?share_token=eq.${token}&active=eq.true&limit=1`,
    { headers }
  );
  const links = await linkRes.json();
  const link  = links[0];

  if (!link) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404, headers: corsHeaders(),
    });
  }

  // 期限チェック
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "expired" }), {
      status: 410, headers: corsHeaders(),
    });
  }

  // マップ取得
  const mapRes = await fetch(
    `${supaUrl}/rest/v1/mm_maps?id=eq.${link.map_id}&limit=1`,
    { headers }
  );
  const maps = await mapRes.json();
  const map  = maps[0];

  if (!map) {
    return new Response(JSON.stringify({ error: "map_not_found" }), {
      status: 404, headers: corsHeaders(),
    });
  }

  // ノード取得
  const nodesRes = await fetch(
    `${supaUrl}/rest/v1/mm_nodes?map_id=eq.${link.map_id}&order=order_index.asc`,
    { headers }
  );
  const nodes = await nodesRes.json();

  // view_count・last_viewed_at をベストエフォート更新（失敗してもレスポンスは返す）
  fetch(
    `${supaUrl}/rest/v1/mm_share_links?id=eq.${link.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        supaKey,
        "Authorization": `Bearer ${supaKey}`,
      },
      body: JSON.stringify({
        view_count:     (link.view_count ?? 0) + 1,
        last_viewed_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {});  // 失敗は無視

  return new Response(JSON.stringify({
    map,
    nodes,
    share: {
      view_count_before: link.view_count,
      expires_at: link.expires_at,
    },
  }), { status: 200, headers: corsHeaders() });
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
