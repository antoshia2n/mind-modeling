/**
 * インデント付きテキスト → ツリー構造パーサー
 *
 * 対応フォーマット：
 * - インデント：タブ / スペース 2個 / スペース 4個（自動検出）
 * - bullet 記号：「- 」「* 」「・」「+ 」（自動除去）
 * - 改行コード：CRLF / LF 両対応
 *
 * 返り値の items 配列の各要素：
 *   { text: string, depth: number, parentIndex: number | -1 }
 *   parentIndex = -1 はルート（親なし）
 */

const BULLET_RE = /^[-*・+]\s+/;

/**
 * インデント単位を自動検出する。
 * 最初に見つかったインデント文字列（タブ or スペースN個）を単位として返す。
 * @param {string[]} lines
 * @returns {string} indentUnit（例: "\t" or "  " or "    "）
 */
function detectIndentUnit(lines) {
  for (const line of lines) {
    const match = line.match(/^(\t+|[ ]+)/);
    if (match) {
      const raw = match[1];
      if (raw.includes("\t")) return "\t";
      // スペース：最小単位を検出（2 or 4 or それ以外）
      if (raw.length % 4 === 0) return "    ";
      if (raw.length % 2 === 0) return "  ";
      return " "; // 1スペースインデント（まれ）
    }
  }
  return "  "; // デフォルト
}

/**
 * インデント付きテキストをパースして、ツリー構造のフラット配列を返す。
 *
 * @param {string} rawText
 * @returns {{ items: Array<{text:string, depth:number, parentIndex:number}>, errors: string[] }}
 */
export function parseIndentedText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { items: [], errors: [] };
  }

  // 改行コード正規化
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 空行をスキップした行リスト
  const rawLines = normalized.split("\n").filter(l => l.trim() !== "");

  if (rawLines.length === 0) return { items: [], errors: [] };

  const indentUnit = detectIndentUnit(rawLines);
  const errors = [];
  const items  = [];
  const depthStack = [-1]; // depthStack[i] = depth i のとき items の最後のインデックス

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // インデント深度を計算
    let raw = line;
    let depth = 0;
    if (indentUnit === "\t") {
      const m = raw.match(/^(\t*)/);
      depth = m ? m[1].length : 0;
      raw = raw.slice(depth);
    } else {
      const unitLen = indentUnit.length;
      let spaceCount = 0;
      while (raw.startsWith(indentUnit)) { raw = raw.slice(unitLen); spaceCount++; }
      depth = spaceCount;
      // 残余スペースを除去（奇数スペースは切り捨て）
      raw = raw.trimStart();
    }

    // bullet 記号を除去
    raw = raw.replace(BULLET_RE, "").trim();

    if (!raw) continue; // bullet だけの行はスキップ

    // 深度が飛びすぎていたら自動補正してエラー警告
    const prevDepth = depthStack.length - 1;
    if (depth > prevDepth + 1) {
      errors.push(`${i + 1}行目: インデントが深すぎます（${prevDepth + 1}→${depth}）。自動補正します。`);
      depth = prevDepth + 1;
    }

    // 深度スタックを更新
    while (depthStack.length - 1 > depth) depthStack.pop();

    const parentIndex = depthStack.length >= 2 ? depthStack[depthStack.length - 2] : -1;
    // depth=0 のとき depthStack = [-1, ...], parentIndex = -1 が正しい
    const correctedParent = depth === 0 ? -1 : (depthStack[depth - 1] ?? -1);

    const myIndex = items.length;
    items.push({ text: raw, depth, parentIndex: correctedParent });

    // スタックを現在のインデックスで更新
    if (depthStack.length - 1 < depth) {
      depthStack.push(myIndex);
    } else {
      depthStack[depth] = myIndex;
    }
  }

  return { items, errors };
}

/**
 * パース結果のノード数を返す（エラーチェック用）
 */
export function countNodes(items) {
  return items.length;
}

/**
 * パース結果から推奨タイトルを推測する。
 * - depth=0 の最初の項目
 * - なければ最初の項目
 */
export function guessTitle(items) {
  if (items.length === 0) return "";
  const root = items.find(n => n.depth === 0);
  return (root ?? items[0]).text;
}

/**
 * パース結果を整形してツリー表示用の文字列に変換（プレビュー用）
 * @param {Array} items
 * @param {number} maxLines - 最大表示行数（デフォルト 50）
 */
export function formatPreview(items, maxLines = 50) {
  const lines = items.slice(0, maxLines).map(n => {
    const indent = "  ".repeat(n.depth);
    return `${indent}• ${n.text}`;
  });
  if (items.length > maxLines) {
    lines.push(`  ... 他 ${items.length - maxLines} ノード`);
  }
  return lines.join("\n");
}
