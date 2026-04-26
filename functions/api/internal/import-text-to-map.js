/**
 * POST /api/internal/import-text-to-map
 * インデント付きテキストをパースして mm_maps + mm_nodes + mm_import_log に保存する内部 API
 *
 * Headers:
 *   Authorization: Bearer {MM_INTERNAL_SECRET}
 *   Content-Type: application/json
 *
 * Body:
 *   {
 *     title: string,           // 必須
 *     indented_text: string,   // 必須
 *     user_id: string,         // 必須
 *     source_note?: string     // 任意（「Whimsical の○○フォルダから」など）
 *   }
 *
 * Response:
 *   { map_id, node_count, source_note }
 */

// インデント検出とパースをサーバーサイドでも実装
// （フロントの textImport.js と同じロジックを Workers 内にインライン）

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
  const errors = [];
  const items  = [];
  const depthStack = [-1];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    let raw = line;
    let depth = 0;

    if (indentUnit === "\t") {
      const m = raw.match(/^(\t*)/);
      depth = m ? m[1].length : 0;
      raw = raw.slice(depth);
    } else {
      const unitLen = indentUnit.length;
      while (raw.startsWith(indentUnit)) { raw = raw.slice(unitLen); depth++; }
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

    if (depthStack.length - 1 < depth) {
      depthStack.push(myIndex);
    } else {
      depthStack[depth] = myIndex;
    }
  }

  return { items, errors };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 認証
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.MM_INTERNAL_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { title, indented_text, user_id, source_note } = body;
  if (!title || !indented_text || !user_id) {
    return json({ error: "title, indented_text, user_id are required" }, 400);
  }

  // 巨大ペースト上限チェック（10000ノード超）
  const lineCount = indented_text.split("\n").filter(l => l.trim()).length;
  if (lineCount > 10000) {
    return json({ error: "too_large", message: "10000ノードを超えるインポートはできません。" }, 400);
  }

  const { items, errors } = parseIndentedText(indented_text);
  if (items.length === 0) {
    return json({ error: "empty", message: "有効なノードが見つかりませんでした。" }, 400);
  }

  const supaUrl = env.VITE_SUPABASE_URL;
  const supaKey = env.VITE_SUPABASE_ANON_KEY;
  const headers = {
    "Content-Type":  "application/json",
    "apikey":        supaKey,
    "Authorization": `Bearer ${supaKey}`,
    "Prefer":        "return=representation",
  };

  // 1. mm_maps に INSERT
  const mapRes = await fetch(`${supaUrl}/rest/v1/mm_maps`, {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id, title }),
  });
  if (!mapRes.ok) {
    const err = await mapRes.text();
    return json({ error: "map_insert_failed", detail: err }, 500);
  }
  const [mapRow] = await mapRes.json();
  const map_id = mapRow.id;

  // 2. mm_nodes に順番に INSERT（parent_id を indexMap で解決）
  const indexMap = {};  // items のインデックス → 実際の node_id
  const ORDER_UNIT = 1024;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const parent_id = item.parentIndex === -1 ? null : (indexMap[item.parentIndex] ?? null);

    // 兄弟内での order_index を計算（同じ parentIndex の何番目か）
    const siblingsBefore = items.slice(0, i).filter(x => x.parentIndex === item.parentIndex);
    const order_index = (siblingsBefore.length + 1) * ORDER_UNIT;

    const nodeRes = await fetch(`${supaUrl}/rest/v1/mm_nodes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id,
        map_id,
        parent_id,
        content: item.text,
        order_index,
      }),
    });
    if (!nodeRes.ok) {
      // ノード挿入失敗時はマップごと削除してロールバック
      await fetch(`${supaUrl}/rest/v1/mm_maps?id=eq.${map_id}`, {
        method: "DELETE",
        headers,
      });
      return json({ error: "node_insert_failed", node_index: i }, 500);
    }
    const [nodeRow] = await nodeRes.json();
    indexMap[i] = nodeRow.id;
  }

  // 3. mm_import_log に INSERT
  await fetch(`${supaUrl}/rest/v1/mm_import_log`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id,
      map_id,
      source:      "whimsical_paste",
      source_note: source_note ?? null,
      node_count:  items.length,
    }),
  }).catch(() => {}); // 失敗してもメインの結果は返す

  return json({
    map_id,
    node_count:   items.length,
    source_note:  source_note ?? null,
    parse_errors: errors,
  }, 200);
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
