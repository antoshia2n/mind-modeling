import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// MM_INTERNAL_SECRET をフロントのグローバルに設定（ShareManage から参照）
// VITE_ プレフィックスが必要なため VITE_MM_INTERNAL_SECRET として環境変数を設定する
window.__MM_SECRET__ = import.meta.env.VITE_MM_INTERNAL_SECRET ?? "";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
