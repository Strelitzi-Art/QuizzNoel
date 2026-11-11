import { createRoot } from "react-dom/client";
import { firebaseConfig } from "./firebaseConfig.js";
import { initDB } from "./lib/db.js";
import { BASE } from "./lib/utils.js";
import Home from "./pages/Home.jsx";
import Host from "./pages/Host.jsx";
import Player from "./pages/Player.jsx";
import Config from "./pages/Config.jsx";
import "./styles/base.css";

// Routes :
//   /                  -> Home   (les joueurs rejoignent la partie)
//   /accueil/          -> Host   (écran du maître du jeu)
//   /quizz/config/     -> Config
//   /quizz/<pseudo>/   -> Player
function route() {
  let p = location.pathname;
  p = p.startsWith(BASE) ? p.slice(BASE.length) : p.replace(/^\//, "");
  const seg = p.replace(/index\.html$/, "").split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  if (seg[0] === "accueil") return <Host />;
  if (seg[0] === "quizz" && seg[1] === "config") return <Config />;
  if (seg[0] === "quizz" && seg[1]) return <Player name={seg[1]} />;
  return <Home />;
}

// Image de fond (public/images/background.jpg), remplaçable sans toucher au code
document.documentElement.style.setProperty("--bg-image", `url("${BASE}images/background.jpg")`);

const root = createRoot(document.getElementById("root"));
initDB(firebaseConfig)
  .then((db) => {
    root.render(
      <>
        {db.kind === "demo" && (
          <div className="demo-banner">
            Mode démo : les données restent dans ce navigateur (teste avec plusieurs onglets). Configure Firebase pour jouer sur portable.
          </div>
        )}
        {route()}
      </>
    );
  })
  .catch((e) => {
    console.error(e);
    root.render(<div className="center-page"><div className="card"><h2>Connexion impossible</h2><p>{String(e.message || e)}</p></div></div>);
  });
