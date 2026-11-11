import { useEffect, useState } from "react";
import { getDB } from "../lib/db.js";
import { LS, adminKeyFor, BASE } from "../lib/utils.js";
import { sampleConfig } from "../lib/quiz.js";

/**
 * Demande le mot de passe de configuration (maître du jeu).
 * Le mot de passe sert de clé : les données sont rangées sous q/<sha256(mot de passe)>/
 */
export default function AdminGate({ title, allowCreate, onLogin }) {
  const db = getDB();
  const [checking, setChecking] = useState(true);
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = LS.get("quizz-admin");
    if (!saved?.key) { setChecking(false); return; }
    db.get(`q/${saved.key}/config`).then((c) => {
      if (c) onLogin({ adminKey: saved.key, config: c });
      else { LS.del("quizz-admin"); setChecking(false); }
    });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!pwd) return;
    const key = await adminKeyFor(pwd);
    if (creating) {
      if (confirm !== pwd) return setError("Les deux mots de passe ne correspondent pas.");
      const cfg = sampleConfig();
      await db.set(`q/${key}/config`, cfg);
      LS.set("quizz-admin", { key });
      return onLogin({ adminKey: key, config: cfg });
    }
    const c = await db.get(`q/${key}/config`);
    if (c) { LS.set("quizz-admin", { key }); return onLogin({ adminKey: key, config: c }); }
    if (allowCreate) setCreating(true);
    else setError("Mot de passe incorrect (ou aucune configuration créée : passe d'abord par la page config).");
  }

  if (checking) return <div className="center-page"><div className="loading">Chargement…</div></div>;

  return (
    <div className="center-page">
      <form className="card gate" onSubmit={submit}>
        <div className="sigil">✦</div>
        <h1>{title}</h1>
        {!creating ? (
          <>
            <label className="field">
              <span>Mot de passe</span>
              <input type="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </label>
            <button className="btn btn-gold" type="submit">Entrer</button>
          </>
        ) : (
          <>
            <p className="muted">Aucune configuration n'existe avec ce mot de passe. Confirme-le pour en créer une nouvelle (avec une catégorie d'exemple).</p>
            <label className="field">
              <span>Confirme le mot de passe</span>
              <input type="password" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => { setCreating(false); setConfirm(""); }}>Annuler</button>
              <button className="btn btn-gold" type="submit">Créer la configuration</button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <a className="small-link" href={BASE}>← Retour</a>
      </form>
    </div>
  );
}
