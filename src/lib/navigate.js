/**
 * SPA ルーティング用ナビゲーション関数
 * history.pushState で URL を更新し、"navigate" イベントを発火する
 */
export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("navigate"));
}
