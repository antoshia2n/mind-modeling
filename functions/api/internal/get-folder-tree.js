/**
 * GET /api/internal/get-folder-tree?user_id=xxx
 * フォルダ全件 + マップ全件を取得してツリーに組み立てる
 *
 * Response:
 * {
 *   root_maps: [{ id, title, updated_at, folder_id }],  // folder_id=null のマップ
 *   folders: [{ id, name, parent_id, children: [...], maps: [...] }, ...]  // 全フォルダのフラット配列（フロントでツリー化）
 * }
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  if (request.headers.get("Authorization") !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const user_id = url.searchParams.get("user_id");
  if (!user_id) return json({ error: "user_id is required" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL, supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = { "apikey": supaKey, "Authorization": `Bearer ${supaKey}` };

  // フォルダ全件取得
  const fRes = await fetch(`${supaUrl}/rest/v1/mm_folders?user_id=eq.${user_id}&order=order_index.asc`, { headers: h });
  if (!fRes.ok) return json({ error: "DB error (folders)" }, 500);
  const folders = await fRes.json();

  // マップ全件取得（軽量：id / title / folder_id / updated_at のみ）
  const mRes = await fetch(`${supaUrl}/rest/v1/mm_maps?user_id=eq.${user_id}&archived=eq.false&select=id,title,folder_id,updated_at&order=updated_at.desc`, { headers: h });
  if (!mRes.ok) return json({ error: "DB error (maps)" }, 500);
  const maps = await mRes.json();

  // フォルダ別マップを振り分け
  const mapsByFolder = {};
  const root_maps = [];
  for (const m of maps) {
    if (!m.folder_id) { root_maps.push(m); continue; }
    if (!mapsByFolder[m.folder_id]) mapsByFolder[m.folder_id] = [];
    mapsByFolder[m.folder_id].push(m);
  }

  // フォルダにマップを付与
  const foldersWithMaps = folders.map(f => ({
    ...f,
    maps: mapsByFolder[f.id] ?? [],
  }));

  return json({ root_maps, folders: foldersWithMaps }, 200);
}

export async function onRequestOptions() { return new Response(null, { status: 204, headers: corsHeaders() }); }
function json(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: corsHeaders() }); }
function corsHeaders() { return { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
