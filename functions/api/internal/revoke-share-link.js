/**
 * POST /api/internal/revoke-share-link
 * 共有リンクを無効化する内部 API
 *
 * Body: { share_link_id: string }
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: corsHeaders(),
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const { share_link_id } = body;
  if (!share_link_id) {
    return new Response(JSON.stringify({ error: "share_link_id is required" }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const res = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/mm_share_links?id=eq.${share_link_id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        active:     false,
        revoked_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "DB error" }), {
      status: 500, headers: corsHeaders(),
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
