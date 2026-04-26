/**
 * POST /api/internal/import-text-to-map
 *
 * 修正履歴：
 * v1: ノードを1件ずつ INSERT → 30秒タイムアウト
 * v2: UUID 事前生成 + 1回 bulk INSERT → 自己参照FK制約エラーの可能性
 * v3: 深さ(depth)単位でバッチ INSERT → 親が必ず先に挿入されFK制約を確実に回避
 */

const BULLET_RE = /^[-*・+]\s+/;

function detectIndentUnit(lines) {
  for (const line of lines) {
    const match = line.match(/^(\t+|[ ]+)/);
    if (match) {
      const raw = match[1];
      if (raw.includes("\t")) return "\t";
      if (raw.length % 4 === 0) return "    ";
      if (raw.length % 2 === 0) return "  ";
      return " ";
    }
  }
  return "  ";
}

function parseIndentedText(rawText) {
  if (!rawText || !rawText.trim()) return { items: [], errors: [] };
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines   = normalized.split("\n").filter(l => l.trim() !== "");
  if (rawLines.length === 0) return { items: [], errors: [] };

  const indentUnit = detectIndentUnit(rawLines);
  const errors = [], items = [], depthStack = [-1];

  for (let i = 0; i < rawLines.length; i++) {
    let raw = rawLines[i], depth = 0;
    if (indentUnit === "\t") {
      const m = raw.match(/^(\t*)/);
      depth = m ? m[1].length : 0;
      raw = raw.slice(depth);
    } else {
      const ul = indentUnit.length;
      while (raw.startsWith(indentUnit)) { raw = raw.slice(ul); depth++; }
      raw = raw.trimStart();
    }
    raw = raw.replace(BULLET_RE, "").trim();
    if (!raw) continue;

    const prevDepth = depthStack.length - 1;
    if (depth > prevDepth + 1) {
      errors.push(`${i + 1}行目: インデントが深すぎます。自動補正します。`);
      depth = prevDepth + 1;
    }
    while (depthStack.length - 1 > depth) depthStack.pop();

    const correctedParent = depth === 0 ? -1 : (depthStack[depth - 1] ?? -1);
    const myIndex = items.length;
    items.push({ text: raw, depth, parentIndex: correctedParent });
    if (depthStack.length - 1 < depth) depthStack.push(myIndex);
    else depthStack[depth] = myIndex;
  }
  return { items, errors };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { title, indented_text, user_id, source_note } = body;
  if (!title || !indented_text || !user_id) return json({ error: "title, indented_text, user_id are required" }, 400);

  const lineCount = indented_text.split("\n").filter(l => l.trim()).length;
  if (lineCount > 10000) return json({ error: "too_large", message: "10000ノードを超えるインポートはできません。" }, 400);

  const { items, errors } = parseIndentedText(indented_text);
  if (items.length === 0) return json({ error: "empty", message: "有効なノードが見つかりませんでした。" }, 400);

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const h = {
    "Content-Type":  "application/json",
    "apikey":        supaKey,
    "Authorization": `Bearer ${supaKey}`,
    "Prefer":        "return=representation",
  };

  // 1. mm_maps INSERT
  const mapRes = await fetch(`${supaUrl}/rest/v1/mm_maps`, {
    method: "POST", headers: h,
    body: JSON.stringify({ user_id, title }),
  });
  if (!mapRes.ok) {
    const err = await mapRes.text();
    return json({ error: "map_insert_failed", detail: err }, 500);
  }
  const [mapRow] = await mapRes.json();
  const map_id = mapRow.id;

  // 2. 深さ単位でバッチ INSERT（親が必ず先に挿入される）
  // indexMap: items のインデックス → 実際の node_id（Supabase が採番）
  const indexMap = {};
  const maxDepth = Math.max(...items.map(it => it.depth));

  for (let depth = 0; depth <= maxDepth; depth++) {
    const batch = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.depth === depth);

    if (batch.length === 0) continue;

    const nodeRows = batch.map(({ item, i }) => {
      const parent_id = item.parentIndex === -1 ? null : (indexMap[item.parentIndex] ?? null);
      // 兄弟内での order_index
      const sibsBefore = items.slice(0, i).filter(x => x.parentIndex === item.parentIndex && x.depth === item.depth);
      return {
        user_id,
        map_id,
        parent_id,
        content:     item.text,
        order_index: (sibsBefore.length + 1) * 1024,
      };
    });

    const res = await fetch(`${supaUrl}/rest/v1/mm_nodes`, {
      method: "POST", headers: h,
      body: JSON.stringify(nodeRows),
    });

    if (!res.ok) {
      const err = await res.text();
      // ロールバック：マップごと削除（mm_nodes は CASCADE で消える）
      await fetch(`${supaUrl}/rest/v1/mm_maps?id=eq.${map_id}`, {
        method: "DELETE", headers: h,
      }).catch(() => {});
      return json({ error: "node_insert_failed", depth, detail: err }, 500);
    }

    // 返ってきた ID を indexMap に記録
    const inserted = await res.json();
    batch.forEach(({ i }, idx) => {
      indexMap[i] = inserted[idx]?.id;
    });
  }

  // 3. mm_import_log INSERT（ベストエフォート）
  await fetch(`${supaUrl}/rest/v1/mm_import_log`, {
    method: "POST", headers: h,
    body: JSON.stringify({ user_id, map_id, source: "whimsical_paste", source_note: source_note ?? null, node_count: items.length }),
  }).catch(() => {});

  return json({ map_id, node_count: items.length, source_note: source_note ?? null, parse_errors: errors }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
