import { useEffect, useRef, useState } from "react";
import { getDB } from "../lib/db.js";
import { LS, BASE, adminKeyFor, rid } from "../lib/utils.js";
import { normalizeConfig, newQuestion, isValidQuestion, parseQuickAdd, toArr, BLIND_ROUNDS, TEAM_COLORS, newTrack, isValidTrack, parseTime } from "../lib/quiz.js";
import { TrackPlayer, youtubeId, youtubeStart, youtubeThumb } from "../lib/media.js";
import { mergeConfigs } from "../lib/merge.js";
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
  const [othersChanged, setOthersChanged] = useState(false);
  const [tab, setTab] = useState(() => LS.get("quizz-config-tab") || "general");
  const fileRef = useRef(null);
  const path = `q/${admin.adminKey}/config`;
  // Version de départ, pour fusionner avec les modifications des autres au moment d'enregistrer
  const baseRef = useRef(normalizeConfig(admin.config));
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // Synchro en direct : les ajouts des autres apparaissent tout seuls si je n'ai rien en cours
  useEffect(() => db.on(path, (v) => {
    if (!v) return;
    const remote = normalizeConfig(v);
    if (JSON.stringify(remote) === JSON.stringify(baseRef.current)) return;
    if (!dirtyRef.current) { baseRef.current = remote; setCfg(remote); }
    else setOthersChanged(true);
  }), [path]);

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
    const remote = await db.get(path);
    const merged = JSON.parse(JSON.stringify(remote ? mergeConfigs(baseRef.current, cfg, remote) : cfg));
    await db.set(path, merged);
    baseRef.current = normalizeConfig(merged);
    setCfg(baseRef.current);
    setDirty(false);
    setSaved(othersChanged ? "Enregistré et fusionné avec les modifications des autres ✓" : "Enregistré ✓");
    setOthersChanged(false);
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
    const blob = new Blob([JSON.stringify({ categories: cfg.categories, blind: cfg.blind }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quizz-questions.json";
    a.click();
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      const imported = normalizeConfig({ categories: data.categories || (Array.isArray(data) ? data : []), blind: data.blind });
      const cats = imported.categories;
      const nTracks = imported.blind.reduce((n, r) => n + r.tracks.length, 0);
      change((c) => {
        for (const cat of cats) c.categories.push({ ...cat, id: rid(4) });
        imported.blind.forEach((r, i) => c.blind[i].tracks.push(...r.tracks.map((t) => ({ ...t, id: rid(4) }))));
      });
      alert(`${cats.length} catégorie(s) et ${nTracks} morceau(x) importés. Pense à enregistrer.`);
    } catch (e) {
      alert("Fichier invalide : " + e.message);
    }
  }

  const toggleOpen = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const s = cfg.settings;
  const enabledCount = cfg.categories.filter((c) => c.enabled).reduce((n, c) => n + c.questions.filter(isValidQuestion).length, 0);

  const blindCount = cfg.blind.reduce((n, r, i) => n + (r.enabled ? r.tracks.filter((t) => isValidTrack(t, BLIND_ROUNDS[i].kind)).length : 0), 0);
  const TABS = [
    { id: "general", label: "Général", hint: "Les deux jeux" },
    { id: "quiz", label: "Quiz", hint: `${enabledCount} question${enabledCount > 1 ? "s" : ""}` },
    { id: "blind", label: "Blind test", hint: `${blindCount} morceau${blindCount > 1 ? "x" : ""}` },
  ];
  const selectTab = (t) => { setTab(t); LS.set("quizz-config-tab", t); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const setClip = (key) => (fn) => change((c) => { fn(c.settings[key]); });

  return (
    <div className="config">
      <header className="cfg-top">
        <h1>Configuration</h1>
        <div className="row">
          <a className="btn btn-ghost btn-sm" href={BASE + "accueil/"}>Écran de jeu</a>
          <button className="btn btn-ghost btn-sm" onClick={() => { LS.del("quizz-admin"); location.reload(); }}>Déconnexion</button>
        </div>
      </header>

      <nav className="cfg-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => selectTab(t.id)}>
            <strong>{t.label}</strong><small>{t.hint}</small>
          </button>
        ))}
      </nav>

      {/* ================= GÉNÉRAL ================= */}
      {tab === "general" && (
        <>
          <section className="card cfg-section">
            <h2>La partie</h2>
            <div className="mode-switch">
              <button type="button" className={"mode-opt" + (s.scoring ? " active" : "")} onClick={() => setS("scoring", true)}>
                <strong>Avec points</strong><span>Score, classement et vainqueur à la fin</span>
              </button>
              <button type="button" className={"mode-opt" + (!s.scoring ? " active" : "")} onClick={() => setS("scoring", false)}>
                <strong>Sans points</strong><span>Juste pour le plaisir : pas de score ni de vainqueur</span>
              </button>
            </div>
            <div className="grid">
              <label className="field"><span>Titre</span>
                <input value={s.title} onChange={(e) => setS("title", e.target.value)} /></label>
              <label className="field"><span>Mot de passe des joueurs</span>
                <input value={cfg.gamePassword} onChange={(e) => change((c) => { c.gamePassword = e.target.value; })} placeholder="ex : soiree2026" /></label>
              <label className={"field" + (s.scoring ? "" : " off")}><span>Points par bonne réponse</span>
                <input type="number" min="1" disabled={!s.scoring} value={s.points} onChange={(e) => setS("points", Math.max(1, num(e.target.value)))} /></label>
            </div>
            <div className="checks">
              <Check label="Afficher la réponse à la fin de chaque question / morceau" v={s.autoReveal} on={(v) => setS("autoReveal", v)} />
              <Check label="Autoriser à rejoindre une partie en cours" v={s.lateJoin} on={(v) => setS("lateJoin", v)} />
              <Check label="Afficher le mot de passe sur l'écran de jeu" v={s.showPassword} on={(v) => setS("showPassword", v)} />
              {s.scoring && <Check label="Points masqués au démarrage" v={s.hideScores} on={(v) => setS("hideScores", v)} />}
            </div>
          </section>

          <section className="card cfg-section">
            <h2>Équipes</h2>
            <Check label="Jouer en équipes (une bonne réponse = un point pour toute l'équipe)" v={s.teams} on={(v) => setS("teams", v)} />
            {s.teams && (
              <>
                <label className="field team-count"><span>Nombre d'équipes</span>
                  <select value={s.teamCount} onChange={(e) => setS("teamCount", Number(e.target.value))}>
                    {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} équipes</option>)}
                  </select>
                </label>
                <div className="team-names">
                  {s.teamNames.slice(0, s.teamCount).map((n, i) => (
                    <label key={i} className="team-name" style={{ "--team": TEAM_COLORS[i] }}>
                      <span className="dot" />
                      <input value={n} onChange={(e) => change((c) => { c.settings.teamNames[i] = e.target.value; })} />
                    </label>
                  ))}
                </div>
              </>
            )}
            <p className="muted small">Ce sont les réglages par défaut : tu peux aussi passer en solo ou en équipes, changer le nombre d'équipes et leurs noms directement dans le salon d'attente de l'écran de jeu.</p>
          </section>

          <section className="card cfg-section">
            <h2>Musique de fin</h2>
            <p className="muted small">
              Se lance sur l'écran de jeu à l'affichage du classement final (quiz et blind test) et tourne <strong>en boucle</strong>.
              Un bouton permet d'en couper le son pendant le classement. Laisse vide pour aucune musique.
            </p>
            <ClipEditor id="end-music" value={s.endMusic} onChange={setClip("endMusic")} withEnd={false} preview={15} />
          </section>

          <section className="card cfg-section">
            <h2>Sauvegarde</h2>
            <p className="muted small">Télécharge toutes tes questions et tous tes morceaux dans un fichier, ou ajoute ceux d'un fichier.</p>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={exportJson}>Exporter (JSON)</button>
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>Importer</button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
            </div>
          </section>

          <section className="card cfg-section danger-zone">
            <h2>Sécurité</h2>
            <button className="btn btn-ghost btn-sm" onClick={changeAdminPassword}>Changer le mot de passe de configuration</button>
          </section>
        </>
      )}

      {/* ================= QUIZ ================= */}
      {tab === "quiz" && (
        <>
          <section className="card cfg-section">
            <h2>Réglages du quiz</h2>
            <div className="grid">
              <label className="field"><span>Bonnes réponses</span>
                <select value={s.mode} onChange={(e) => setS("mode", e.target.value)}>
                  <option value="all">Tout le monde peut trouver</option>
                  <option value="first">Seul le premier (la question se ferme)</option>
                </select></label>
              {s.scoring && (
                <label className="field"><span>Bonus pour le 1er</span>
                  <input type="number" min="0" value={s.firstBonus} onChange={(e) => setS("firstBonus", num(e.target.value))} /></label>
              )}
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
            </div>
          </section>

          <section className="card cfg-section">
            <h2>Sons du quiz</h2>
            <h3 className="sub-title">Musique de fond</h3>
            <p className="muted small">Tourne en boucle sur l'écran de jeu pendant les questions, sans redémarrer d'une question à l'autre. Un bouton « Fond » permet de la couper pendant la partie.</p>
            <ClipEditor id="quiz-bg" value={s.quizBg} onChange={setClip("quizBg")} withEnd={false} preview={15} />
            <label className="field volume">
              <span>Volume de la musique de fond : {s.quizBg.volume} %</span>
              <input type="range" min="5" max="100" step="5" value={s.quizBg.volume} onChange={(e) => change((c) => { c.settings.quizBg.volume = Number(e.target.value); })} />
            </label>
            <h3 className="sub-title spaced">Son de bonne réponse</h3>
            <p className="muted small">Joué sur l'écran de jeu chaque fois que quelqu'un trouve la bonne réponse (3 secondes environ, 8 au maximum).</p>
            <ClipEditor id="quiz-correct" value={s.quizCorrect} onChange={setClip("quizCorrect")} withEnd />
          </section>

          <section className="cfg-section">
            <div className="section-head">
              <h2>Questions</h2>
              <div className="row">
                <button className="btn btn-gold btn-sm" onClick={() => {
                  const id = rid(4);
                  change((c) => { c.categories.push({ id, name: "Nouvelle catégorie", enabled: true, questions: [] }); });
                  setOpen((o) => new Set(o).add(id));
                }}>+ Catégorie</button>
              </div>
            </div>
            <p className="muted small">{enabledCount} question{enabledCount > 1 ? "s" : ""} valide{enabledCount > 1 ? "s" : ""} dans les catégories cochées.</p>
            {cfg.categories.length === 0 && <p className="muted">Aucune catégorie. Ajoute-en une !</p>}
            {cfg.categories.map((cat, ci) => (
              <Category
                key={cat.id} cat={cat} isOpen={open.has(cat.id)} onToggle={() => toggleOpen(cat.id)}
                edit={(fn) => change((c) => fn(c.categories[ci]))}
                remove={() => confirm(`Supprimer la catégorie « ${cat.name} » et ses ${cat.questions.length} questions ?`) && change((c) => { c.categories.splice(ci, 1); })}
              />
            ))}
          </section>
        </>
      )}

      {/* ================= BLIND TEST ================= */}
      {tab === "blind" && (
        <>
          <BlindSection cfg={cfg} change={change} setS={setS} part="settings" />
          <SoundsSection cfg={cfg} change={change} setS={setS} />
          <BlindSection cfg={cfg} change={change} setS={setS} part="rounds" />
        </>
      )}

      <div className={"save-bar" + (dirty ? " dirty" : "")}>
        <span>
          {dirty ? "Modifications non enregistrées" : saved || "Tout est enregistré"}
          {othersChanged && <small className="others">Quelqu'un d'autre a modifié la config : tout sera fusionné à l'enregistrement.</small>}
        </span>
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

/* ================= Blind test ================= */

let tester = null;
const getTester = (onUpdate, onLimit) => {
  if (!tester) tester = new TrackPlayer({});
  tester.onUpdate = onUpdate;
  tester.onLimit = onLimit;
  return tester;
};

function BlindSection({ cfg, change, setS, part }) {
  const total = cfg.blind.reduce((n, r, i) => n + (r.enabled ? r.tracks.filter((t) => isValidTrack(t, BLIND_ROUNDS[i].kind)).length : 0), 0);
  const [playing, setPlaying] = useState(null); // id du morceau en test
  const [testErr, setTestErr] = useState(null);
  useEffect(() => () => tester?.stop(), []);

  const onPlay = (t) => {
    const p = getTester(
      (st) => { if (st.err) { setTestErr({ id: t.id, msg: st.err }); setPlaying(null); } },
      () => setPlaying(null),
    );
    if (playing === t.id) { p.stop(); setPlaying(null); return; }
    setTestErr(null);
    setPlaying(t.id);
    const start = parseTime(t.start) ?? youtubeStart(t.link) ?? 0;
    const end = parseTime(t.end) ?? start + 20;
    p.play(t, start, end);
  };

  // Déplacer un morceau vers une autre manche
  const moveTrack = (from, ti, to) => change((c) => {
    const [x] = c.blind[from].tracks.splice(ti, 1);
    c.blind[to].tracks.push(x);
  });

  if (part === "rounds") {
    return (
      <section className="cfg-section">
        <div className="section-head"><h2>Manches et morceaux</h2></div>
        <p className="muted small">{total} morceau{total > 1 ? "x" : ""} valide{total > 1 ? "s" : ""} dans les manches cochées.</p>
      {cfg.blind.map((round, ri) => (
          <BlindRound
            key={ri} index={ri} round={round} meta={BLIND_ROUNDS[ri]} rounds={cfg.blind}
            playing={playing} onPlay={onPlay} testErr={testErr}
            edit={(fn) => change((c) => fn(c.blind[ri]))}
            onMove={(ti, to) => moveTrack(ri, ti, to)}
          />
        ))}
      </section>
    );
  }
  return (
    <section className="cfg-section">
      <div className="section-head">
        <h2>Réglages du blind test</h2>
      </div>
      <div className="card blind-help">
        <p>
          Pour chaque morceau, colle le <strong>lien YouTube</strong>, indique où l'extrait <strong>commence</strong> et
          où il <strong>s'arrête</strong> (<code>45</code> ou <code>1:05</code>), puis la réponse.
          Pour la manche « suite des paroles », la fin correspond au moment où la musique se coupe.
          Utilise <strong>▶ Tester</strong> pour vérifier l'extrait.
        </p>
        <p className="muted small">
          Seul le son est joué sur l'écran de jeu, la vidéo reste cachée. Certaines vidéos (souvent les clips officiels)
          interdisent la lecture hors de YouTube : le test te le dira, prends alors une version « lyrics » ou « audio ».
          Plusieurs personnes peuvent remplir la config en même temps : tout est fusionné à l'enregistrement.
        </p>
        <div className="checks">
          <Check label="Un joueur refusé ne peut plus buzzer sur le même morceau" v={cfg.settings.blindLockout} on={(v) => setS("blindLockout", v)} />
          <Check label="Mélanger les morceaux dans chaque manche" v={cfg.settings.blindShuffle} on={(v) => setS("blindShuffle", v)} />
        </div>
        <label className="field check-mode">
          <span>Quand un joueur buzze et répond à voix haute</span>
          <select value={cfg.settings.blindCheck} onChange={(e) => setS("blindCheck", e.target.value)}>
            <option value="auto">Le maître du jeu tape la réponse, le jeu valide tout seul</option>
            <option value="assist">Le maître du jeu tape la réponse, le jeu la teste, le maître du jeu confirme</option>
            <option value="manual">Le maître du jeu valide lui-même (boutons Bonne / Mauvaise réponse)</option>
          </select>
        </label>
        <p className="muted small">
          Le jeu tolère les fautes de frappe : 1 lettre par mot jusqu'à 5 lettres, 2 au-delà. Pour les paroles, il faut tous les mots, dans l'ordre.
          Plusieurs réponses possibles ? Sépare-les par <code>|</code> (ex : <code>Star Wars | La Guerre des étoiles</code>).
        </p>
        <p className="muted">{total} morceau{total > 1 ? "x" : ""} valide{total > 1 ? "s" : ""} dans les manches cochées.</p>
      </div>
    </section>
  );
}

function BlindRound({ index, round, rounds, meta, edit, onMove, playing, onPlay, testErr }) {
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const valid = round.tracks.filter((t) => isValidTrack(t, meta.kind)).length;
  const endLabel = meta.kind === "lyrics" ? "Coupure à" : "Fin";
  return (
    <div className={"card cat" + (round.enabled ? "" : " disabled")}>
      <div className="cat-head">
        <label className="check" title="Jouer cette manche">
          <input type="checkbox" checked={round.enabled} onChange={(e) => edit((r) => { r.enabled = e.target.checked; })} />
        </label>
        <span className="round-tag">Manche {index + 1}</span>
        <input className="cat-name" value={round.name} onChange={(e) => edit((r) => { r.name = e.target.value; })} />
        <span className="badge">{valid}/{round.tracks.length}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? "Replier" : "Modifier"}</button>
      </div>
      {open && (
        <div className="cat-body">
          <p className="muted small">{meta.prompt}.</p>
          {round.tracks.map((t, ti) => {
            const ok = isValidTrack(t, meta.kind);
            const id = youtubeId(t.link);
            const set = (k) => (e) => edit((r) => {
              r.tracks[ti][k] = e.target.value;
              // Le temps de départ présent dans le lien (?t=…) est repris automatiquement
              if (k === "link" && !String(r.tracks[ti].start).trim()) {
                const ts = youtubeStart(e.target.value);
                if (ts != null) r.tracks[ti].start = String(ts);
              }
            });
            return (
              <div key={t.id} className={"q-edit track" + (ok ? "" : " invalid")}>
                <div className="q-edit-head">
                  <span className="q-num">#{ti + 1}</span>
                  {!ok && <span className="warn">incomplet</span>}
                  <span className="spacer" />
                  <select className="move-round" value={index} title="Changer de manche" onChange={(e) => onMove(ti, Number(e.target.value))}>
                    {rounds.map((r, i) => <option key={i} value={i}>{i === index ? "Manche " + (i + 1) : "→ " + r.name}</option>)}
                  </select>
                  <button className="icon-btn" disabled={ti === 0} onClick={() => edit((r) => { const [x] = r.tracks.splice(ti, 1); r.tracks.splice(ti - 1, 0, x); })}>↑</button>
                  <button className="icon-btn" disabled={ti === round.tracks.length - 1} onClick={() => edit((r) => { const [x] = r.tracks.splice(ti, 1); r.tracks.splice(ti + 1, 0, x); })}>↓</button>
                  <button className="icon-btn danger" onClick={() => edit((r) => { r.tracks.splice(ti, 1); })}>✕</button>
                </div>
                <div className="track-file">
                  {id && <img className="yt-thumb" src={youtubeThumb(id)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
                  <input placeholder="Lien YouTube (https://youtu.be/…)" value={t.link} onChange={set("link")} />
                  <button className="btn btn-ghost btn-sm" disabled={!t.link.trim()} onClick={() => onPlay(t)}>
                    {playing === t.id ? "■ Stop" : "▶ Tester"}
                  </button>
                </div>
                {testErr?.id === t.id && <div className="warn test-err">{testErr.msg}</div>}
                <div className="track-times">
                  <label className="field"><span>Début</span><input placeholder="0:30" value={t.start} onChange={set("start")} /></label>
                  <label className="field"><span>{endLabel}</span><input placeholder={meta.kind === "lyrics" ? "1:05" : "0:50"} value={t.end} onChange={set("end")} /></label>
                </div>
                <div className="track-answers">
                  <label className="field">
                    <span>{meta.a1}{meta.kind === "lyrics" && t.answer.trim() ? ` · ${t.answer.split("|")[0].trim().split(/\s+/).length} mots` : ""}</span>
                    <input value={t.answer} onChange={set("answer")} placeholder={meta.kind === "lyrics" ? "Les mots exacts qui suivent la coupure" : "Plusieurs réponses : séparer par |"} />
                  </label>
                  <label className="field"><span>{meta.a2}</span><input value={t.answer2} onChange={set("answer2")} /></label>
                </div>
              </div>
            );
          })}
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => edit((r) => { r.tracks.push(newTrack()); })}>+ Morceau</button>
          </div>
          <details className="quick">
            <summary>Ajout rapide (plusieurs morceaux d'un coup)</summary>
            <p className="muted">
              Un morceau par ligne : <code>lien ; début ; fin ; {meta.a1.toLowerCase()} ; {meta.a2.replace(" (optionnel)", "").toLowerCase()}</code>
            </p>
            <textarea rows={4} value={quick} onChange={(e) => setQuick(e.target.value)}
              placeholder={meta.kind === "lyrics"
                ? "https://youtu.be/xxxxxxxxxxx ; 0:12 ; 0:31 ; et je m'envole ; Artiste – Titre"
                : "https://youtu.be/xxxxxxxxxxx ; 1:02 ; 1:22 ; " + (meta.kind === "artist" ? "Céline Dion ; My Heart Will Go On" : "Star Wars")} />
            <button className="btn btn-gold btn-sm" onClick={() => {
              const lines = quick.split("\n").map((l) => l.split(";").map((x) => x.trim())).filter((p) => p[0]);
              if (!lines.length) return alert("Aucune ligne reconnue.");
              edit((r) => {
                for (const [link, start = "", end = "", answer = "", answer2 = ""] of lines)
                  r.tracks.push({ ...newTrack(), link, start: start || String(youtubeStart(link) ?? ""), end, answer, answer2 });
              });
              setQuick("");
            }}>Ajouter ces morceaux</button>
          </details>
        </div>
      )}
    </div>
  );
}

/* ================= Sons de buzzer ================= */

function SoundsSection({ cfg, change, setS }) {
  const [playing, setPlaying] = useState(null);
  const [err, setErr] = useState(null);
  const valid = (x) => x.name.trim() && youtubeId(x.link);
  const nValid = cfg.sounds.filter(valid).length;
  const sig = cfg.settings.hostSignal;

  const test = (x, key) => {
    const p = getTester(
      (st) => { if (st.err) { setErr({ id: key, msg: st.err }); setPlaying(null); } },
      () => setPlaying(null),
    );
    if (playing === key) { p.stop(); setPlaying(null); return; }
    setErr(null);
    setPlaying(key);
    const start = parseTime(x.start) ?? youtubeStart(x.link) ?? 0;
    let end = parseTime(x.end) ?? start + 3;
    if (end <= start) end = start + 3;
    p.play(x, start, Math.min(end, start + 8));
  };

  // Champs communs : lien YouTube (+ miniature, + Tester), début, fin
  const clipFields = (x, key, onChange) => {
    const id = youtubeId(x.link);
    const set = (k) => (e) => {
      const v = e.target.value;
      onChange((o) => {
        o[k] = v;
        if (k === "link" && !String(o.start).trim()) { const ts = youtubeStart(v); if (ts != null) o.start = String(ts); }
      });
    };
    return (
      <>
        <div className="track-file">
          {id && <img className="yt-thumb" src={youtubeThumb(id)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
          <input placeholder="Lien YouTube" value={x.link} onChange={set("link")} />
          <button className="btn btn-ghost btn-sm" disabled={!id} onClick={() => test(x, key)}>{playing === key ? "■ Stop" : "▶ Tester"}</button>
        </div>
        {err?.id === key && <div className="warn test-err">{err.msg}</div>}
        <div className="track-times">
          <label className="field"><span>Début</span><input placeholder="0:12" value={x.start} onChange={set("start")} /></label>
          <label className="field"><span>Fin</span><input placeholder="0:15" value={x.end} onChange={set("end")} /></label>
        </div>
      </>
    );
  };

  return (
    <section className="cfg-section">
      <div className="section-head"><h2>Sons de buzzer</h2></div>

      <div className="card blind-help">
        <h3 className="sub-title">Son de l'écran du maître du jeu</h3>
        <p className="muted small">
          Joué <strong>uniquement sur l'écran de jeu</strong> à chaque buzz, pour signaler que quelqu'un a buzzé
          (3 secondes environ, 8 au maximum). Laisse vide pour aucun son.
        </p>
        <ClipEditor id="signal" value={sig} onChange={(fn) => change((c) => { fn(c.settings.hostSignal); })} withEnd />
      </div>

      <div className="section-head sub">
        <h3 className="sub-title">Sons des joueurs</h3>
        <button className="btn btn-gold btn-sm" onClick={() => change((c) => { c.sounds.push({ id: rid(4), name: "", icon: "", link: "", start: "", end: "" }); })}>+ Son</button>
      </div>
      <p className="muted small sounds-help">
        La liste proposée aux joueurs dans le salon d'attente. Chacun (ou chaque équipe) en choisit un, qui sortira de
        <strong> son propre téléphone</strong> quand il buzzera. Un nom, un emoji, le lien YouTube et le passage à jouer.
        {" "}{nValid} son{nValid > 1 ? "s" : ""} prêt{nValid > 1 ? "s" : ""}.
      </p>
      {cfg.sounds.length === 0 && <p className="muted small">Aucun son pour l'instant : les téléphones resteront silencieux.</p>}
      {cfg.sounds.map((x, i) => (
        <div key={x.id} className={"card q-edit sound-edit" + (valid(x) ? "" : " invalid")}>
          <div className="sound-row">
            <input className="sound-emoji" value={x.icon} maxLength={4} placeholder="🎵" title="Icône (emoji)"
              onChange={(e) => change((c) => { c.sounds[i].icon = e.target.value; })} />
            <input className="sound-name-input" value={x.name} maxLength={18} placeholder="Nom du son (ex : Mario)"
              onChange={(e) => change((c) => { c.sounds[i].name = e.target.value; })} />
            <button className="icon-btn danger" title="Supprimer" onClick={() => change((c) => { c.sounds.splice(i, 1); })}>✕</button>
          </div>
          {clipFields(x, x.id, (fn) => change((c) => { fn(c.sounds[i]); }))}
        </div>
      ))}
    </section>
  );
}

/* ================= Éditeur d'extrait YouTube (sons, musiques) ================= */

/** Lien YouTube (+ miniature, + ▶ Tester), début, et fin si `withEnd` */
function ClipEditor({ id, value, onChange, withEnd = true, preview = 8 }) {
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState("");
  const vid = youtubeId(value.link);
  const set = (k) => (e) => {
    const v = e.target.value;
    onChange((o) => {
      o[k] = v;
      if (k === "link" && !String(o.start).trim()) { const ts = youtubeStart(v); if (ts != null) o.start = String(ts); }
    });
  };
  const test = () => {
    const p = getTester((st) => { if (st.err) { setErr(st.err); setPlaying(false); } }, () => setPlaying(false));
    if (playing) { p.stop(); setPlaying(false); return; }
    setErr("");
    setPlaying(true);
    const start = parseTime(value.start) ?? youtubeStart(value.link) ?? 0;
    let end = withEnd ? parseTime(value.end) ?? start + 3 : start + preview;
    if (end <= start) end = start + 3;
    p.play(value, start, Math.min(end, start + Math.max(preview, 8)));
  };
  return (
    <div className="clip-editor" data-clip={id}>
      <div className="track-file">
        {vid && <img className="yt-thumb" src={youtubeThumb(vid)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
        <input placeholder="Lien YouTube (vide = aucun)" value={value.link} onChange={set("link")} />
        <button className="btn btn-ghost btn-sm" disabled={!vid} onClick={test}>{playing ? "■ Stop" : "▶ Tester"}</button>
      </div>
      {err && <div className="warn test-err">{err}</div>}
      <div className={"track-times" + (withEnd ? "" : " single")}>
        <label className="field"><span>Début</span><input placeholder="0:00" value={value.start} onChange={set("start")} /></label>
        {withEnd && <label className="field"><span>Fin</span><input placeholder="0:03" value={value.end} onChange={set("end")} /></label>}
      </div>
      {value.link && (
        <button className="btn btn-ghost btn-sm clear-sig" onClick={() => onChange((o) => { o.link = ""; o.start = ""; if ("end" in o) o.end = ""; })}>Retirer</button>
      )}
    </div>
  );
}
