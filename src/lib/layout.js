/**
 * mm_nodes から react-flow 用の位置と方向を計算する。
 *
 * layoutMode: "bi" | "right" | "tb"
 *
 * widths: { [nodeId]: number }
 *   react-flow が計測した実際のノード幅。
 *   1パス目は推定値、2パス目で実測値を渡すと正確な配置になる。
 */

export const NODE_HEIGHT = 28;
const CHILD_GAP_H  = 60;     // 水平余白（推定誤差を吸収）
const CHILD_GAP_V  = 64;     // 垂直余白（tbモード）
const H_SIB_GAP    = 20;     // tbモードの兄弟間
const ROOT_HALF    = 130;    // biモード：ルート半幅（固定・推定不要）
const MIN_NODE_W   = 40;
const MAX_NODE_W   = 260;
const CHAR_W_JP    = 14;
const CHAR_W_ASCII = 8;
const NODE_PADDING = 10;

export function estimateNodeWidth(text) {
  if (!text) return MIN_NODE_W;
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 127 ? CHAR_W_JP : CHAR_W_ASCII;
  return Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w + NODE_PADDING));
}

function nw(nodeId, content, widths) {
  return widths[nodeId] ?? estimateNodeWidth(content);
}

export function calcLayout(nodes, layoutMode = "bi", widths = {}) {
  if (!nodes || nodes.length === 0) return { positions: {}, directions: {} };

  const byParent = {};
  for (const n of nodes) {
    const key = n.parent_id ?? "__root__";
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(n);
  }
  for (const k in byParent) byParent[k].sort((a, b) => a.order_index - b.order_index);

  const roots = byParent["__root__"] ?? [];

  if (layoutMode === "tb")                   return calcTopBottom(nodes, roots, byParent, widths);
  if (layoutMode === "bi" && roots.length === 1) return calcBi(nodes, roots[0], byParent, widths);
  return calcRight(nodes, byParent, widths);
}

// ─── bi（左右展開） ────────────────────────────────────────

function calcBi(nodes, root, byParent, widths) {
  const pos = {}, dir = {};

  function sh(id) {
    const ch = byParent[id] || [];
    return ch.length === 0 ? NODE_HEIGHT : ch.reduce((s, c) => s + sh(c.id), 0);
  }

  function place(id, xAnchor, yStart, d) {
    dir[id] = d;
    const nd = nodes.find(n => n.id === id);
    const w  = nw(id, nd?.content ?? "", widths);
    const h  = sh(id);
    const px = d === "right" ? xAnchor : xAnchor - w;
    pos[id]  = { x: px, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    const ca = d === "right" ? px + w + CHILD_GAP_H : px - CHILD_GAP_H;
    let cy = yStart;
    for (const c of byParent[id] || []) cy = place(c.id, ca, cy, d);
    return yStart + h;
  }

  const ch = byParent[root.id] || [];
  const right = [], left = [];
  let rH = 0, lH = 0;
  for (const c of ch) {
    const h = sh(c.id);
    if (rH <= lH) { right.push(c); rH += h; }
    else          { left.push(c);  lH += h; }
  }

  const total = Math.max(NODE_HEIGHT, rH + lH);

  // ルートは固定中心配置（実測幅に依存しない）
  dir[root.id] = "right";
  pos[root.id] = { x: -ROOT_HALF, y: total / 2 - NODE_HEIGHT / 2 };

  let ry = total / 2 - rH / 2;
  for (const c of right) ry = place(c.id, ROOT_HALF + CHILD_GAP_H, ry, "right");

  let ly = total / 2 - lH / 2;
  for (const c of left) ly = place(c.id, -(ROOT_HALF + CHILD_GAP_H), ly, "left");

  return { positions: pos, directions: dir };
}

// ─── right（右のみ展開） ───────────────────────────────────

function calcRight(nodes, byParent, widths) {
  const pos = {}, dir = {};

  function sh(id) {
    const ch = byParent[id] || [];
    return ch.length === 0 ? NODE_HEIGHT : ch.reduce((s, c) => s + sh(c.id), 0);
  }

  function place(id, x, yStart) {
    dir[id] = "right";
    const nd = nodes.find(n => n.id === id);
    const w  = nw(id, nd?.content ?? "", widths);
    const h  = sh(id);
    pos[id]  = { x, y: yStart + h / 2 - NODE_HEIGHT / 2 };
    let cy = yStart;
    for (const c of byParent[id] || []) cy = place(c.id, x + w + CHILD_GAP_H, cy);
    return yStart + h;
  }

  let y = 0;
  for (const r of byParent["__root__"] || []) y = place(r.id, 0, y);
  return { positions: pos, directions: dir };
}

// ─── tb（上下展開） ────────────────────────────────────────

function calcTopBottom(nodes, roots, byParent, widths) {
  const pos = {}, dir = {};

  function sw(id) {
    const nd = nodes.find(n => n.id === id);
    const myW = nw(id, nd?.content ?? "", widths);
    const ch = byParent[id] || [];
    if (!ch.length) return myW;
    const cW = ch.reduce((s, c, i) => s + sw(c.id) + (i > 0 ? H_SIB_GAP : 0), 0);
    return Math.max(myW, cW);
  }

  function place(id, x, y, allocW) {
    dir[id] = "down";
    const nd = nodes.find(n => n.id === id);
    const myW = nw(id, nd?.content ?? "", widths);
    pos[id] = { x: x + allocW / 2 - myW / 2, y };
    const ch = byParent[id] || [];
    if (!ch.length) return;
    const total = ch.reduce((s, c, i) => s + sw(c.id) + (i > 0 ? H_SIB_GAP : 0), 0);
    let cx = x + allocW / 2 - total / 2;
    for (const c of ch) { const cw = sw(c.id); place(c.id, cx, y + NODE_HEIGHT + CHILD_GAP_V, cw); cx += cw + H_SIB_GAP; }
  }

  let x = 0;
  for (const r of roots) { const w = sw(r.id); place(r.id, x, 0, w); x += w + H_SIB_GAP * 4; }
  return { positions: pos, directions: dir };
}

export function getPositions(nodes, layoutMode = "bi", widths = {}) {
  return calcLayout(nodes, layoutMode, widths).positions;
}
