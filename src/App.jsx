import { useState, useEffect } from "react";
import Home from "./screens/Home.jsx";
import Edit from "./screens/Edit.jsx";

function parsePath() {
  const p = window.location.pathname;
  if (p.startsWith("/m/")) {
    const mapId = p.slice(3).replace(/\/$/, "");
    if (mapId) return { screen: "edit", mapId };
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

  if (route.screen === "edit") return <Edit mapId={route.mapId} />;
  return <Home />;
}
