/**
 * POST /api/internal/push-to-zeus-proxy
 * MM フロントから受け取り、サーバー側で Zeus API に転送する（CORS回避）
 *
 * Body: { title, content, source_url, map_id, node_count, zeus_item_id? }
 * Response: { item_id }
 *
 * 環境変数（サーバー側・VITE_なし）:
 *   ZEUS_API_URL          : Zeus の本番 URL（例: https://zeus.shia2n.jp）
 *   ZEUS_EXTERNAL_SECRET  : Zeus 外部 API の認証 Secret
 *   MM_INTERNAL_SECRET    : MM の内部 API 認証
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // MM 内部認証
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { title, content, source_url, map_id, node_count, zeus_item_id } = body;
  if (!title || !content || !source_url) {
    return json({ error: "title, content, source_url are required" }, 400);
  }

  const zeusUrl    = env.ZEUS_API_URL;
  const zeusSecret = env.ZEUS_EXTERNAL_SECRET;

  if (!zeusUrl || !zeusSecret) {
    return json({ error: "Zeus 環境変数が未設定です（ZEUS_API_URL・ZEUS_EXTERNAL_SECRET）" }, 500);
  }

  // Zeus へサーバー側から push（CORS なし）
  const res = await fetch(`${zeusUrl}/api/external/push-to-zeus`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${zeusSecret}`,
    },
    body: JSON.stringify({
      source_app: "mind-modeling",
      title,
      content,
      source_url,
      item_type: "text",
      metadata: {
        map_id,
        node_count,
        last_synced_at: new Date().toISOString(),
      },
      ...(zeus_item_id && { item_id: zeus_item_id }),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return json({ error: `Zeus API エラー（HTTP ${res.status}）`, detail: err }, 502);
  }

  const data = await res.json();
  return json({ item_id: data.item_id }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
