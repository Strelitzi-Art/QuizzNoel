import { useState } from "react";
import { getDB } from "../lib/db.js";
import { SESSION, BASE, go, playerUrl, rid, roomKeyFor } from "../lib/utils.js";
import { SITE_TITLE } from "../firebaseConfig.js";
import "../styles/home.css";

const NAME_RE = /^[\p{L}\p{N} _.\-']{1,16}$/u;
const slug = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "joueur";

export default function Home() {
  const db = getDB();
  const params = new URLSearchParams(location.search);
  const session = SESSION.get();
  const [name, setName] = useState(params.get("pseudo") || session?.name || "");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(params.get("msg") || "");
  const [busy, setBusy] = useState(false);

  async function join(e) {
    e.preventDefault();
    setError("");
    const n = name.trim().replace(/\s+/g, " ");
    if (!NAME_RE.test(n) || /^\.+$/.test(n) || n.toLowerCase() === "config")
      return setError("Pseudo invalide (1 à 16 caractères : lettres, chiffres, espaces, - _ . ')");
    if (!pwd) return setError("Entre le mot de passe de la partie.");
    setBusy(true);
    try {
      const roomKey = await roomKeyFor(pwd);
      const R = `q/${roomKey}`;
      const st = await db.get(`${R}/state`);
      if (!st) return setError("Mot de passe incorrect, ou aucune partie n'est ouverte pour le moment.");
      const pid = slug(n);
      const existing = await db.get(`${R}/players/${pid}`);
      if (existing) {
        const mine = session && session.roomKey === roomKey && session.pid === pid && session.token === existing.token;
        if (!mine) return setError("Ce pseudo est déjà pris, choisis-en un autre.");
      } else {
        if (st.status === "ended") return setError("La partie est terminée. Attends que le maître du jeu en relance une !");
        if (st.status !== "lobby" && !st.lateJoin) return setError("Une partie est déjà en cours. Attends la prochaine !");
        const token = rid();
        await db.set(`${R}/players/${pid}`, { name: n, score: 0, token, joinedAt: db.now() });
        SESSION.set({ roomKey, pid, token, name: n });
      }
      go(playerUrl(n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page home">
      <div className="home-head">
        <div className="sigil big">✦</div>
        <h1 className="title">{SITE_TITLE}</h1>
        <p className="muted">Entre ton pseudo et le mot de passe pour rejoindre la partie</p>
      </div>

      <form className="card join" onSubmit={join}>
        <label className="field">
          <span>Pseudo</span>
          <input value={name} maxLength={16} autoComplete="nickname" onChange={(e) => setName(e.target.value)} placeholder="Ton pseudo" />
        </label>
        <label className="field">
          <span>Mot de passe de la partie</span>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="••••••" />
        </label>
        <button className="btn btn-gold btn-big" disabled={busy}>{busy ? "Connexion…" : "Rejoindre la partie"}</button>
        {error && <p className="error">{error}</p>}
      </form>

      {session && (
        <button className="btn btn-ghost" onClick={() => go(playerUrl(session.name))}>
          Reprendre en tant que <strong>{session.name}</strong>
        </button>
      )}

      <nav className="home-links">
        <a href={BASE + "accueil/"}>Écran du maître du jeu</a>
        <span>·</span>
        <a href={BASE + "quizz/config/"}>Configuration</a>
      </nav>
    </div>
  );
}
