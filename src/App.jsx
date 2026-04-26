import { useState, useEffect } from "react";
import { AuthGuard } from "shia2n-core";
import Home         from "./screens/Home.jsx";
import Edit         from "./screens/Edit.jsx";
import ShareView    from "./screens/ShareView.jsx";
import ShareManage  from "./screens/ShareManage.jsx";

function parsePath() {
  const p = window.location.pathname;

  // /share/:token（AuthGuard 不要）
  if (p.startsWith("/share/")) {
    const token = p.slice(7).replace(/\/$/, "");
    if (token) return { screen: "share", token };
  }

  // /m/:mapId/share（共有管理）
  if (p.startsWith("/m/")) {
    const rest = p.slice(3).replace(/\/$/, "");
    if (rest.endsWith("/share")) {
      const mapId = rest.slice(0, -6);
      if (mapId) return { screen: "share-manage", mapId };
    }
    if (rest) return { screen: "edit", mapId: rest };
  }

  return { screen: "home" };
}

export default function App() {
  const [route, setRoute] = useState(parsePath);

  useEffect(() => {
    function handleRoute() { setRoute(parsePath()); }
    window.addEventListener("navigate", handleRoute);
    window.addEventListener("popstate", handleRoute);
    return () => {
      window.removeEventListener("navigate", handleRoute);
      window.removeEventListener("popstate", handleRoute);
    };
  }, []);

  // 公開ビューは AuthGuard の外側
  if (route.screen === "share") {
    return <ShareView token={route.token} />;
  }

  return (
    <AuthGuard appId="mm">
      {route.screen === "share-manage" ? <ShareManage mapId={route.mapId} /> :
       route.screen === "edit"         ? <Edit mapId={route.mapId} />        :
       <Home />}
    </AuthGuard>
  );
}
