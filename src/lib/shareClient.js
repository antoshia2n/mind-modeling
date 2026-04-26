/**
 * 共有リンク内部 API クライアント（フロント側）
 * MM_INTERNAL_SECRET は main.jsx でグローバルに設定済みの前提
 */

function secret() {
  return window.__MM_SECRET__ ?? "";
}

function authHeaders() {
  return {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${secret()}`,
  };
}

export async function createShareLink({ mapId, userId, note, expiresAt }) {
  const body = { map_id: mapId, user_id: userId };
  if (note)      body.note       = note;
  if (expiresAt) body.expires_at = expiresAt;

  const res = await fetch("/api/internal/create-share-link", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("create failed");
  return res.json();
}

export async function listShareLinks({ mapId, active } = {}) {
  let url = "/api/internal/list-share-links";
  const params = [];
  if (mapId  !== undefined) params.push(`map_id=${mapId}`);
  if (active !== undefined) params.push(`active=${active}`);
  if (params.length) url += "?" + params.join("&");

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error("list failed");
  return res.json();
}

export async function revokeShareLink(shareLinkId) {
  const res = await fetch("/api/internal/revoke-share-link", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ share_link_id: shareLinkId }),
  });
  if (!res.ok) throw new Error("revoke failed");
  return res.json();
}
