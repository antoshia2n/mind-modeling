import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGuard } from "shia2n-core";
import { APP_ID, APP_NAME } from "./constants.js";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthGuard appId={APP_ID} appName={APP_NAME}>
      <App />
    </AuthGuard>
  </StrictMode>
);
