import { useState, useEffect } from "react";
import { AuthGuard } from "shia2n-core";
import Home           from "./screens/Home.jsx";
import Edit           from "./screens/Edit.jsx";
import ShareView      from "./screens/ShareView.jsx";
import ShareManage    from "./screens/ShareManage.jsx";
import ImportScreen   from "./screens/ImportScreen.jsx";
import ImportHistory  from "./screens/ImportHistory.jsx";
import TemplateList   from "./screens/TemplateList.jsx";
import Slideshow      from "./screens/Slideshow.jsx";

function parsePath() {
  const p = window.location.pathname;

  if (p.startsWith("/share/")) {
    const token = p.slice(7).replace(/\/$/, "");
    if (token) return { screen: "share", token };
  }
  if (p.startsWith("/slideshow/")) {
    const nodeId = p.slice(11).replace(/\/$/, "");
    if (nodeId) return { screen: "slideshow", nodeId };
  }
  if (p.startsWith("/m/")) {
    const rest = p.slice(3).replace(/\/$/, "");
    if (rest.endsWith("/share")) {
      const mapId = rest.slice(0, -6);
      if (mapId) return { screen: "share-manage", mapId };
    }
    if (rest) return { screen: "edit", mapId: rest };
  }
  if (p === "/import-history") return { screen: "import-history" };
  if (p === "/import")         return { screen: "import" };
  if (p === "/templates")      return { screen: "templates" };

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

  // 共有・スライドショーは AuthGuard の外（ただしSlideShowは内部でuidをチェック）
  if (route.screen === "share") return <ShareView token={route.token} />;

  return (
    <AuthGuard appId="mm">
      {route.screen === "slideshow"      ? <Slideshow   /> :
       route.screen === "share-manage"   ? <ShareManage   mapId={route.mapId} /> :
       route.screen === "edit"           ? <Edit          mapId={route.mapId} /> :
       route.screen === "import"         ? <ImportScreen  /> :
       route.screen === "import-history" ? <ImportHistory /> :
       route.screen === "templates"      ? <TemplateList  /> :
       <Home />}
    </AuthGuard>
  );
}
