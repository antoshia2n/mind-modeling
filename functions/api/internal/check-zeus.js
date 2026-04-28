/**
 * GET /api/internal/check-zeus
 * Zeus への接続・認証・疎通を確認する診断エンドポイント
 */
export async function onRequestGet(context) {
  const { env } = context;

  const zeusUrl    = env.ZEUS_API_URL;
  const zeusSecret = env.ZEUS_EXTERNAL_SECRET;

  const result = {
    zeus_url_set:    !!zeusUrl,
    zeus_secret_set: !!zeusSecret,
    zeus_url:        zeusUrl ?? "(未設定)",
    zeus_test:       null,
    zeus_status:     null,
    zeus_body:       null,
  };

  if (!zeusUrl || !zeusSecret) {
    return json({ ...result, error: "環境変数未設定" }, 200);
  }

  // Zeus の list-projects を GET で叩いて認証・疎通を確認
  try {
    const res = await fetch(`${zeusUrl}/api/external/list-projects`, {
      headers: { "Authorization": `Bearer ${zeusSecret}` },
    });
    result.zeus_status = res.status;
    result.zeus_body   = await res.text().catch(() => "(読み取り失敗)");
    result.zeus_test   = res.ok ? "OK" : "FAIL";
  } catch (e) {
    result.zeus_test = "NETWORK_ERROR";
    result.zeus_body = String(e);
  }

  return json(result, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
