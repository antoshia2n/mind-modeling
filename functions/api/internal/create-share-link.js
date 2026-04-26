/**
 * POST /api/internal/create-share-link
 * 共有リンクを新規作成する内部 API
 *
 * Headers:
 *   Authorization: Bearer {MM_INTERNAL_SECRET}
 *   Content-Type: application/json
 *
 * Body:
 *   { map_id: string, expires_at?: string (ISO), note?: string }
 *
 * Response:
 *   { share_token, share_url, expires_at }
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // 認証チェック
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: corsHeaders(),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: corsHeaders(),
    });
  }

  const { map_id, expires_at, note } = body;
  if (!map_id) {
    return new Response(JSON.stringify({ error: "map_id is required" }), {
      status: 400, headers: corsHeaders(),
    });
  }

  // token 生成（UUID v4 相当の推測困難なトークン）
  const share_token = crypto.randomUUID();
  const base_url    = env.APP_BASE_URL ?? "https://mm.shia2n.jp";
  const share_url   = `${base_url}/share/${share_token}`;

  // Supabase に挿入
  const res = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/mm_share_links`,
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
        "Prefer":        "return=representation",
      },
      body: JSON.stringify({
        map_id,
        share_token,
        user_id:    body.user_id ?? "system",
        expires_at: expires_at ?? null,
        note:       note ?? null,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: "DB error", detail: err }), {
      status: 500, headers: corsHeaders(),
    });
  }

  const [row] = await res.json();

  return new Response(JSON.stringify({
    share_token:  row.share_token,
    share_url,
    expires_at:   row.expires_at,
    id:           row.id,
  }), { status: 200, headers: corsHeaders() });
}

// OPTIONS プリフライト対応
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
