import { useEffect, useRef, useState } from "react";
import { getDB } from "../lib/db.js";
import { LS, BASE, adminKeyFor, rid } from "../lib/utils.js";
import { normalizeConfig, newQuestion, isValidQuestion, parseQuickAdd, toArr } from "../lib/quiz.js";
import AdminGate from "../components/AdminGate.jsx";
import "../styles/config.css";

export default function Config() {
  const [admin, setAdmin] = useState(null);
  if (!admin) return <AdminGate title="Configuration du quizz" allowCreate onLogin={setAdmin} />;
  return <ConfigEditor admin={admin} onChangeKey={(adminKey) => setAdmin({ ...admin, adminKey })} />;
}

function ConfigEditor({ admin, onChangeKey }) {
  const db = getDB();
  const [cfg, setCfg] = useState(() => normalizeConfig(admin.config));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const fileRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const change = (fn) => {
    setCfg((c) => { const n = structuredClone(c); fn(n); return n; });
    setDirty(true);
    setSaved("");
  };
  const setS = (k, v) => change((c) => { c.settings[k] = v; });
  const num = (v) => Math.max(0, parseInt(v, 10) || 0);

  async function save() {
    await db.set(`q/${admin.adminKey}/config`, JSON.parse(JSON.stringify(cfg)));
    setDirty(false);
    setSaved("Enregistré ✓");
  }

  async function changeAdminPassword() {
    const p1 = prompt("Nouveau mot de passe de configuration :");
    if (!p1) return;
    if (prompt("Confirme le nouveau mot de passe :") !== p1) return alert("Les mots de passe ne correspondent pas.");
    const key = await adminKeyFor(p1);
    const current = await db.get(`q/${admin.adminKey}/current`);
    await db.set(`q/${key}/config`, JSON.parse(JSON.stringify(cfg)));
    if (current) await db.set(`q/${key}/current`, current);
    await db.remove(`q/${admin.adminKey}`);
    LS.set("quizz-admin", { key });
    onChangeKey(key);
    setDirty(false);
    setSaved("Mot de passe changé ✓");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ categories: cfg.categories }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quizz-questions.json";
    a.click();
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const cats = normalizeConfig({ categories: data.categories || data }).categories;
      change((c) => { for (const cat of cats) c.categories.push({ ...cat, id: rid(4) }); });
      alert(`${cats.length} catégorie(s) importée(s). Pense à enregistrer.`);
    } catch (e) {
      alert("Fichier invalide : " + e.message);
    }
  }

  const toggleOpen = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const s = cfg.settings;
  const enabledCount = cfg.categories.filter((c) => c.enabled).reduce((n, c) => n + c.questions.filter(isValidQuestion).length, 0);

  return (
    <div className="config">
      <header className="cfg-top">
        <h1>Configuration</h1>
        <div className="row">
          <a className="btn btn-ghost btn-sm" href={BASE + "accueil/"}>Écran de jeu</a>
          <button className="btn btn-ghost btn-sm" onClick={() => { LS.del("quizz-admin"); location.reload(); }}>Déconnexion</button>
        </div>
      </header>

      <section className="card cfg-section">
        <h2>Prochaine partie</h2>
        <div className="grid">
          <label className="field"><span>Titre du quizz</span>
            <input value={s.title} onChange={(e) => setS("title", e.target.value)} /></label>
          <label className="field"><span>Mot de passe des joueurs</span>
            <input value={cfg.gamePassword} onChange={(e) => change((c) => { c.gamePassword = e.target.value; })} placeholder="ex : soiree2026" /></label>
          <label className="field"><span>Qui marque des points ?</span>
            <select value={s.mode} onChange={(e) => setS("mode", e.target.value)}>
              <option value="all">Tous ceux qui trouvent</option>
              <option value="first">Seulement le premier (la question se ferme)</option>
            </select></label>
          <label className="field"><span>Points par bonne réponse</span>
            <input type="number" min="1" value={s.points} onChange={(e) => setS("points", Math.max(1, num(e.target.value)))} /></label>
          <label className="field"><span>Bonus pour le 1er</span>
            <input type="number" min="0" value={s.firstBonus} onChange={(e) => setS("firstBonus", num(e.target.value))} /></label>
          <label className="field"><span>Chrono par question (s, 0 = aucun)</span>
            <input type="number" min="0" value={s.timer} onChange={(e) => setS("timer", num(e.target.value))} /></label>
          <label className="field"><span>Essais (texte libre, 0 = illimité)</span>
            <input type="number" min="0" value={s.attempts} onChange={(e) => setS("attempts", num(e.target.value))} /></label>
          <label className="field"><span>Nombre de questions (0 = toutes)</span>
            <input type="number" min="0" value={s.maxQuestions} onChange={(e) => setS("maxQuestions", num(e.target.value))} /></label>
        </div>
        <div className="checks">
          <Check label="Mélanger les questions" v={s.shuffle} on={(v) => setS("shuffle", v)} />
          <Check label="Tolérer les petites fautes de frappe" v={s.tolerance} on={(v) => setS("tolerance", v)} />
          <Check label="Afficher la réponse à la fin de chaque question" v={s.autoReveal} on={(v) => setS("autoReveal", v)} />
          <Check label="Autoriser à rejoindre une partie en cours" v={s.lateJoin} on={(v) => setS("lateJoin", v)} />
          <Check label="Afficher le mot de passe sur l'écran de jeu" v={s.showPassword} on={(v) => setS("showPassword", v)} />
          <Check label="Points masqués au démarrage" v={s.hideScores} on={(v) => setS("hideScores", v)} />
        </div>
        <p className="muted">{enabledCount} question{enabledCount > 1 ? "s" : ""} valide{enabledCount > 1 ? "s" : ""} dans les catégories cochées.</p>
      </section>

      <section className="cfg-section">
        <div className="section-head">
          <h2>Catégories</h2>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={exportJson}>Exporter (JSON)</button>
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>Importer</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
            <button className="btn btn-gold btn-sm" onClick={() => {
              const id = rid(4);
              change((c) => { c.categories.push({ id, name: "Nouvelle catégorie", enabled: true, questions: [] }); });
              setOpen((o) => new Set(o).add(id));
            }}>+ Catégorie</button>
          </div>
        </div>

        {cfg.categories.length === 0 && <p className="muted">Aucune catégorie. Ajoute-en une !</p>}
        {cfg.categories.map((cat, ci) => (
          <Category
            key={cat.id} cat={cat} isOpen={open.has(cat.id)} onToggle={() => toggleOpen(cat.id)}
            edit={(fn) => change((c) => fn(c.categories[ci]))}
            remove={() => confirm(`Supprimer la catégorie « ${cat.name} » et ses ${cat.questions.length} questions ?`) && change((c) => { c.categories.splice(ci, 1); })}
          />
        ))}
      </section>

      <section className="card cfg-section danger-zone">
        <h2>Sécurité</h2>
        <button className="btn btn-ghost btn-sm" onClick={changeAdminPassword}>Changer le mot de passe de configuration</button>
      </section>

      <div className={"save-bar" + (dirty ? " dirty" : "")}>
        <span>{dirty ? "Modifications non enregistrées" : saved || "Tout est enregistré"}</span>
        <button className="btn btn-gold" disabled={!dirty} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}

function Check({ label, v, on }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Category({ cat, isOpen, onToggle, edit, remove }) {
  const [quick, setQuick] = useState("");
  const valid = cat.questions.filter(isValidQuestion).length;
  return (
    <div className={"card cat" + (cat.enabled ? "" : " disabled")}>
      <div className="cat-head">
        <label className="check" title="Utiliser pour la prochaine partie">
          <input type="checkbox" checked={cat.enabled} onChange={(e) => edit((c) => { c.enabled = e.target.checked; })} />
        </label>
        <input className="cat-name" value={cat.name} onChange={(e) => edit((c) => { c.name = e.target.value; })} />
        <span className="badge">{valid}/{cat.questions.length}</span>
        <button className="btn btn-ghost btn-sm" onClick={onToggle}>{isOpen ? "Replier" : "Modifier"}</button>
        <button className="btn btn-danger btn-sm" onClick={remove}>Supprimer</button>
      </div>

      {isOpen && (
        <div className="cat-body">
          {cat.questions.map((q, qi) => (
            <QuestionEditor
              key={q.id} q={q} index={qi} count={cat.questions.length}
              edit={(fn) => edit((c) => fn(c.questions[qi]))}
              move={(d) => edit((c) => { const [x] = c.questions.splice(qi, 1); c.questions.splice(qi + d, 0, x); })}
              remove={() => edit((c) => { c.questions.splice(qi, 1); })}
            />
          ))}
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => edit((c) => { c.questions.push(newQuestion("text")); })}>+ Question texte libre</button>
            <button className="btn btn-ghost btn-sm" onClick={() => edit((c) => { c.questions.push(newQuestion("qcm")); })}>+ Question QCM</button>
          </div>
          <details className="quick">
            <summary>Ajout rapide (plusieurs questions d'un coup)</summary>
            <p className="muted">
              Une question par ligne. Texte libre : <code>Question ; réponse | variante</code><br />
              QCM (étoile sur la bonne) : <code>Question ; *bonne ; mauvaise ; mauvaise</code>
            </p>
            <textarea rows={5} value={quick} onChange={(e) => setQuick(e.target.value)}
              placeholder={"Capitale du Japon ? ; Tokyo\nCouleur du ciel ? ; Rouge ; *Bleu ; Vert"} />
            <button className="btn btn-gold btn-sm" onClick={() => {
              const qs = parseQuickAdd(quick);
              if (!qs.length) return alert("Aucune ligne reconnue.");
              edit((c) => { c.questions.push(...qs); });
              setQuick("");
            }}>Ajouter ces questions</button>
          </details>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({ q, index, count, edit, move, remove }) {
  const ok = isValidQuestion(q);
  return (
    <div className={"q-edit" + (ok ? "" : " invalid")}>
      <div className="q-edit-head">
        <span className="q-num">#{index + 1}</span>
        <select value={q.type} onChange={(e) => edit((x) => { x.type = e.target.value; })}>
          <option value="text">Texte libre</option>
          <option value="qcm">QCM</option>
        </select>
        {!ok && <span className="warn">incomplète</span>}
        <span className="spacer" />
        <button className="icon-btn" disabled={index === 0} onClick={() => move(-1)} title="Monter">↑</button>
        <button className="icon-btn" disabled={index === count - 1} onClick={() => move(1)} title="Descendre">↓</button>
        <button className="icon-btn danger" onClick={remove} title="Supprimer">✕</button>
      </div>
      <textarea rows={2} placeholder="Intitulé de la question" value={q.text} onChange={(e) => edit((x) => { x.text = e.target.value; })} />
      {q.type === "text" ? (
        <input placeholder="Réponses acceptées, séparées par |   (ex : Paris | Lutèce)" value={q.answers}
          onChange={(e) => edit((x) => { x.answers = e.target.value; })} />
      ) : (
        <div className="q-choices">
          {toArr(q.choices).map((c, i) => (
            <div key={i} className={"q-choice" + (q.correct === i ? " good" : "")}>
              <input type="radio" checked={q.correct === i} onChange={() => edit((x) => { x.correct = i; })} title="Bonne réponse" />
              <input placeholder={`Choix ${i + 1}`} value={c} onChange={(e) => edit((x) => { x.choices[i] = e.target.value; })} />
              {q.choices.length > 2 && (
                <button className="icon-btn" onClick={() => edit((x) => {
                  x.choices.splice(i, 1);
                  if (x.correct === i || x.correct >= x.choices.length) x.correct = 0;
                  else if (x.correct > i) x.correct--;
                })}>✕</button>
              )}
            </div>
          ))}
          {q.choices.length < 6 && (
            <button className="btn btn-ghost btn-sm" onClick={() => edit((x) => { x.choices.push(""); })}>+ Choix</button>
          )}
        </div>
      )}
      <input className="q-image" placeholder="Image (URL, optionnel)" value={q.image} onChange={(e) => edit((x) => { x.image = e.target.value; })} />
    </div>
  );
}
