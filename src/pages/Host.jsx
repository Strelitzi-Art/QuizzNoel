import { useEffect, useRef, useState } from "react";
import { getDB, useDb } from "../lib/db.js";
import { LS, BASE, rid, roomKeyFor, ranking } from "../lib/utils.js";
import { normalizeConfig, buildDeck, answerText, checkAnswer } from "../lib/quiz.js";
import AdminGate from "../components/AdminGate.jsx";
import Timer, { useRemaining } from "../components/Timer.jsx";
import Podium from "../components/Podium.jsx";
import OptionalImage, { IMAGES, preloadImages } from "../components/OptionalImage.jsx";
import "../styles/host.css";

const LETTERS = "ABCDEFGH";

export default function Host() {
  const [admin, setAdmin] = useState(null);
  const [roomKey, setRoomKey] = useState(null);
  const cfg = admin ? normalizeConfig(admin.config) : null;

  useEffect(() => {
    if (cfg?.gamePassword) roomKeyFor(cfg.gamePassword).then(setRoomKey);
  }, [cfg?.gamePassword]);

  if (!admin) return <AdminGate title="Écran du maître du jeu" allowCreate={false} onLogin={setAdmin} />;
  if (!cfg.gamePassword)
    return (
      <div className="center-page">
        <div className="card">
          <h2>Il manque le mot de passe des joueurs</h2>
          <p className="muted">Définis-le dans la page de configuration avant d'ouvrir une partie.</p>
          <a className="btn btn-gold" href={BASE + "quizz/config/"}>Aller à la configuration</a>
        </div>
      </div>
    );
  if (!roomKey) return <div className="center-page"><div className="loading">Chargement…</div></div>;
  return <HostRoom adminKey={admin.adminKey} roomKey={roomKey} gamePassword={cfg.gamePassword} />;
}

function HostRoom({ adminKey, roomKey, gamePassword }) {
  const db = getDB();
  const R = `q/${roomKey}`;
  const [ready, setReady] = useState(false);
  const st = useDb(`${R}/state`);
  const players = useDb(`${R}/players`);
  const current = useDb(`q/${adminKey}/current`);
  const qi = st?.qIndex ?? -1;
  const answers = useDb(qi >= 0 ? `${R}/answers/${qi}` : null);
  const found = useDb(qi >= 0 ? `${R}/found/${qi}` : null);

  // Références toujours à jour pour la validation asynchrone des réponses
  const stRef = useRef(st); stRef.current = st;
  const playersRef = useRef(players); playersRef.current = players;
  const curRef = useRef(current); curRef.current = current;
  const queue = useRef(Promise.resolve());
  const local = useRef({ qi: -2, found: {}, results: {}, processed: new Set() });
  const scores = useRef({});
  const closing = useRef(false);

  const enqueue = (fn) => { queue.current = queue.current.then(fn).catch((e) => console.error(e)); return queue.current; };

  // ---------- Initialisation de la salle ----------
  useEffect(() => {
    preloadImages(Object.values(IMAGES));
    (async () => {
      const s = await db.get(`${R}/state`);
      const cur = await db.get(`q/${adminKey}/current`);
      if (!s || !cur || cur.roomKey !== roomKey) await newGame(false);
      else if (s.status === "lobby") await refreshDeck();
      setReady(true);
    })();
  }, []);

  async function loadConfig() {
    return normalizeConfig(await db.get(`q/${adminKey}/config`));
  }

  function stateFromSettings(s, deck) {
    return {
      status: "lobby", qIndex: -1, total: deck.length, title: s.title,
      hideScores: !!s.hideScores, lateJoin: !!s.lateJoin, mode: s.mode,
      attempts: Number(s.attempts) || 0, timer: Number(s.timer) || 0, gameId: rid(),
    };
  }

  async function newGame(keepPlayers) {
    const cfg = await loadConfig();
    const deck = buildDeck(cfg);
    const pl = keepPlayers ? (await db.get(`${R}/players`)) || {} : {};
    for (const p of Object.values(pl)) p.score = 0;
    scores.current = {};
    local.current = { qi: -2, found: {}, results: {}, processed: new Set() };
    await db.set(`q/${adminKey}/current`, { roomKey, deck, settings: cfg.settings });
    await db.set(R, { players: pl, state: stateFromSettings(cfg.settings, deck) });
  }

  async function refreshDeck() {
    const cfg = await loadConfig();
    const deck = buildDeck(cfg);
    const s = await db.get(`${R}/state`);
    await db.set(`q/${adminKey}/current`, { roomKey, deck, settings: cfg.settings });
    await db.set(`${R}/state`, { ...stateFromSettings(cfg.settings, deck), gameId: s?.gameId || rid() });
  }

  // ---------- Déroulé ----------
  async function goTo(i) {
    const cur = curRef.current;
    const q = cur.deck[i];
    const timer = Number(cur.settings.timer) || 0;
    closing.current = false;
    await db.set(`${R}/state`, {
      ...stRef.current,
      status: "question",
      qIndex: i,
      question: { type: q.type, text: q.text, choices: q.type === "qcm" ? q.choices : null, image: q.image || null, cat: q.cat || null },
      endsAt: timer > 0 ? db.now() + timer * 1000 + 500 : null,
      revealed: null,
    });
  }

  async function closeQuestion(reveal) {
    const s = stRef.current;
    if (!s || (s.status !== "question" && !reveal)) return;
    const q = curRef.current.deck[s.qIndex];
    const upd = { "state/status": "closed" };
    if (reveal || curRef.current.settings.autoReveal) upd["state/revealed"] = answerText(q);
    await db.update(R, upd);
  }

  const next = () => (qi + 1 < (st?.total || 0) ? goTo(qi + 1) : endGame());
  const endGame = () => db.update(R, { "state/status": "ended", "state/endsAt": null });
  const toggleScores = () => db.update(R, { "state/hideScores": !st.hideScores });
  const kick = (pid) => { if (confirm(`Retirer ${players[pid]?.name} de la partie ?`)) db.remove(`${R}/players/${pid}`); };

  // ---------- Validation des réponses (le maître du jeu fait foi) ----------
  async function evaluate(ans) {
    const s = stRef.current;
    const cur = curRef.current;
    if (!s || s.status !== "question" || !cur) return;
    const i = s.qIndex;
    const L = local.current;
    if (L.qi !== i) {
      // Nouvelle question (ou rechargement de la page) : on repart de ce qui est en base
      L.qi = i;
      L.found = (await db.get(`${R}/found/${i}`)) || {};
      L.results = (await db.get(`${R}/results/${i}`)) || {};
      L.processed = new Set();
    }
    const q = cur.deck[i];
    const set = cur.settings;
    const limit = q.type === "qcm" ? 1 : Number(set.attempts) || 0;
    const upd = {};
    let close = false;

    for (const [pid, a] of Object.entries(ans || {})) {
      if (!a || typeof a.n !== "number") continue;
      const key = pid + ":" + a.n;
      if (L.processed.has(key)) continue;
      L.processed.add(key);
      const p = playersRef.current?.[pid];
      const prev = L.results[pid];
      if (!p || prev?.ok || (prev && a.n <= prev.n)) continue;
      if (limit > 0 && a.n > limit) continue;
      if (set.mode === "first" && Object.keys(L.found).length > 0) {
        upd[`results/${i}/${pid}`] = { ok: false, n: a.n, late: true };
        continue;
      }
      const ok = checkAnswer(q, a.v, set.tolerance);
      L.results[pid] = { ok, n: a.n };
      upd[`results/${i}/${pid}`] = L.results[pid];
      if (ok) {
        const rank = Object.keys(L.found).length + 1;
        const pts = (Number(set.points) || 1) + (rank === 1 ? Number(set.firstBonus) || 0 : 0);
        L.found[pid] = { name: p.name, rank, pts, at: db.now() };
        upd[`found/${i}/${pid}`] = L.found[pid];
        const score = (scores.current[pid] ?? p.score ?? 0) + pts;
        scores.current[pid] = score;
        upd[`players/${pid}/score`] = score;
        if (set.mode === "first") close = true;
      }
    }
    if (close) {
      upd["state/status"] = "closed";
      if (set.autoReveal) upd["state/revealed"] = answerText(q);
    }
    if (Object.keys(upd).length) await db.update(R, upd);
  }

  useEffect(() => {
    if (answers && st?.status === "question") enqueue(() => evaluate(answers));
  }, [answers, st?.status, st?.qIndex]);

  // Fin du chrono
  const remaining = useRemaining(st?.status === "question" ? st.endsAt : null);
  useEffect(() => {
    if (remaining === 0 && st?.status === "question" && !closing.current) {
      closing.current = true;
      enqueue(() => closeQuestion(false));
    }
  }, [remaining, st?.status]);

  if (!ready || !st || current === undefined)
    return <div className="center-page"><div className="loading">Ouverture de la partie…</div></div>;

  const playerCount = Object.keys(players || {}).length;
  const joinUrl = location.origin + BASE;

  return (
    <div className={"host status-" + st.status}>
      <header className="host-top">
        <div className="host-title">{st.title}</div>
        {st.status !== "lobby" && st.status !== "ended" && (
          <div className="host-progress">Question {qi + 1} / {st.total}</div>
        )}
        <div className="host-tools">
          <a className="btn btn-ghost btn-sm" href={BASE + "quizz/config/"} target="_blank" rel="noreferrer">Config</a>
          <button className="btn btn-ghost btn-sm" onClick={() => { LS.del("quizz-admin"); location.reload(); }}>Déconnexion</button>
        </div>
      </header>

      <main className="host-main">
        {st.status === "lobby" && (
          <Lobby
            joinUrl={joinUrl} password={current?.settings?.showPassword ? gamePassword : null}
            players={players} total={st.total} onKick={kick}
          />
        )}
        {(st.status === "question" || st.status === "closed") && (
          <QuestionView st={st} answers={answers} found={found} playerCount={playerCount} deckQ={current?.deck?.[qi]} />
        )}
        {st.status === "ended" && (
          <div className="final-wrap">
            <Podium players={players} />
            <OptionalImage name={IMAGES.ranking} className="final-gif" />
          </div>
        )}
      </main>

      <div className="host-controls">
        {st.status === "lobby" && (
          <>
            <button className="btn btn-ghost" onClick={() => refreshDeck()}>↻ Recharger les questions</button>
            <button className="btn btn-gold btn-big" disabled={!playerCount || !st.total} onClick={() => goTo(0)}>
              Lancer la partie ▶
            </button>
          </>
        )}
        {(st.status === "question" || st.status === "closed") && (
          <>
            {!st.revealed && <button className="btn btn-ghost" onClick={() => closeQuestion(true)}>Révéler la réponse</button>}
            {st.status === "question" && <button className="btn btn-ghost" onClick={() => closeQuestion(false)}>Clore la question</button>}
            <button className="btn btn-gold btn-big" onClick={next}>
              {qi + 1 < st.total ? "Question suivante ▶" : "Voir le classement final ▶"}
            </button>
            <button className="btn btn-danger" onClick={() => confirm("Terminer la partie maintenant ?") && endGame()}>Terminer la partie</button>
          </>
        )}
        {st.status === "ended" && (
          <>
            <button className="btn btn-ghost" onClick={() => newGame(false)}>Nouvelle partie (vider les joueurs)</button>
            <button className="btn btn-gold btn-big" onClick={() => newGame(true)}>Rejouer avec les mêmes joueurs</button>
          </>
        )}
      </div>

      {st.status !== "ended" && st.status !== "lobby" && (
        <Scoreboard players={players} hidden={st.hideScores} onToggle={toggleScores} found={found} />
      )}
      {st.status === "lobby" && playerCount > 0 && (
        <div className="lobby-hint">{playerCount} joueur{playerCount > 1 ? "s" : ""} prêt{playerCount > 1 ? "s" : ""}</div>
      )}
    </div>
  );
}

function Lobby({ joinUrl, password, players, total, onKick }) {
  const list = Object.entries(players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(joinUrl)}`;
  return (
    <div className="lobby">
      <div className="lobby-join card">
        <h2>Rejoignez la partie</h2>
        <img className="qr" src={qr} alt="QR code" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div className="join-url">{joinUrl.replace(/^https?:\/\//, "")}</div>
        {password && <div className="join-pwd">Mot de passe : <strong>{password}</strong></div>}
        <div className="muted">{total} question{total > 1 ? "s" : ""} prête{total > 1 ? "s" : ""}</div>
      </div>
      <div className="lobby-players">
        <h2>Joueurs</h2>
        {list.length === 0 && <p className="muted waiting">En attente des joueurs…</p>}
        <div className="chips">
          {list.map(([pid, p]) => (
            <div key={pid} className="chip pop">
              {p.name}
              <button className="chip-x" title="Retirer" onClick={() => onKick(pid)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuestionView({ st, answers, found, playerCount, deckQ }) {
  const q = st.question || {};
  const foundList = Object.values(found || {}).sort((a, b) => a.rank - b.rank);
  const answered = Object.keys(answers || {}).length;
  const counts = {};
  if (q.type === "qcm") for (const a of Object.values(answers || {})) counts[a.v] = (counts[a.v] || 0) + 1;
  const showCounts = st.status === "closed" && q.type === "qcm";
  const presenter = foundList.length > 0 ? IMAGES.found : st.status === "closed" ? IMAGES.nobody : IMAGES.question;
  return (
    <div className="qview">
      <OptionalImage name={presenter} className="presenter" />
      <div className="qview-main">
        {q.cat && <div className="q-cat">{q.cat}</div>}
        <Timer endsAt={st.status === "question" ? st.endsAt : null} total={st.timer} />
        <h1 className="q-text">{q.text}</h1>
        {q.image && <img className="q-img" src={q.image} alt="" />}
        {q.type === "qcm" && (
          <div className="choices">
            {(q.choices || []).map((c, i) => (
              <div key={i} className={"choice" + (st.revealed && deckQ?.correct === i ? " correct" : "") + (st.revealed && deckQ?.correct !== i ? " dim" : "")}>
                <span className="letter">{LETTERS[i]}</span>
                <span>{c}</span>
                {showCounts && <span className="count">{counts[i] || 0}</span>}
              </div>
            ))}
          </div>
        )}
        {st.revealed && q.type !== "qcm" && (
          <div className="revealed">Réponse : <strong>{st.revealed}</strong></div>
        )}
        {st.status === "closed" && !st.revealed && <div className="muted closed-note">Question close</div>}
        <div className="answered">{answered} / {playerCount} ont répondu</div>
      </div>
      <aside className="found">
        <h3>Ont trouvé</h3>
        {foundList.length === 0 && <p className="muted">Personne pour l'instant…</p>}
        <ol>
          {foundList.map((f) => (
            <li key={f.name} className="pop">
              <span className="f-rank">{f.rank}</span>
              <span className="f-name">{f.name}</span>
              <span className="f-pts">+{f.pts}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Scoreboard({ players, hidden, onToggle, found }) {
  let list = ranking(players);
  if (hidden) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const foundNames = new Set(Object.values(found || {}).map((f) => f.name));
  return (
    <footer className="scoreboard">
      <button className="btn btn-ghost btn-sm" onClick={onToggle}>{hidden ? "👁 Afficher les points" : "🙈 Masquer les points"}</button>
      <div className="sb-list">
        {list.map((p) => (
          <div key={p.pid} className={"sb-item" + (foundNames.has(p.name) ? " got" : "")}>
            <span className="sb-name">{p.name}</span>
            <span className="sb-score">{hidden ? "•" : p.score}</span>
          </div>
        ))}
      </div>
    </footer>
  );
}
