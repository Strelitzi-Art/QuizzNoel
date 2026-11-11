import { useEffect, useRef, useState } from "react";
import { getDB, useDb } from "../lib/db.js";
import { LS, BASE, rid, roomKeyFor, ranking } from "../lib/utils.js";
import { normalizeConfig, buildDeck, buildBlindDeck, answerText, checkAnswer, checkBlind, countWords, toArr, TEAM_COLORS } from "../lib/quiz.js";
import { TrackPlayer } from "../lib/media.js";
import { SOUNDS, soundById, playSound, unlockSounds, firstFreeSound } from "../lib/sounds.js";
import MusicStage from "../components/MusicStage.jsx";
import AdminGate from "../components/AdminGate.jsx";
import Timer, { useRemaining } from "../components/Timer.jsx";
import Podium from "../components/Podium.jsx";
import OptionalImage, { IMAGES, preloadImages } from "../components/OptionalImage.jsx";
import "../styles/host.css";

const LETTERS = "ABCDEFGH";
const teamColor = (tid) => TEAM_COLORS[(parseInt(String(tid).slice(1), 10) || 1) - 1] || TEAM_COLORS[0];

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
  const teams = useDb(`${R}/teams`);
  const current = useDb(`q/${adminKey}/current`);
  const qi = st?.qIndex ?? -1;
  const isBlind = st?.question?.type === "blind";
  const inQuestion = st?.status === "question" || st?.status === "closed";
  const answers = useDb(inQuestion && !isBlind ? `${R}/answers/${qi}` : null);
  const buzz = useDb(inQuestion && isBlind ? `${R}/buzz/${qi}` : null);
  const found = useDb(inQuestion ? `${R}/found/${qi}` : null);

  // Références toujours à jour pour les traitements asynchrones
  const stRef = useRef(st); stRef.current = st;
  const playersRef = useRef(players); playersRef.current = players;
  const teamsRef = useRef(teams); teamsRef.current = teams;
  const curRef = useRef(current); curRef.current = current;
  const chain = useRef(Promise.resolve());
  const local = useRef({ qi: -2, found: {}, results: {}, processed: new Set(), teamFound: new Set() });
  const blind = useRef({ qi: -2, processed: new Set(), queue: [], locked: {} });
  const scores = useRef({});
  const teamScores = useRef({});
  const closing = useRef(false);

  const enqueue = (fn) => { chain.current = chain.current.then(fn).catch((e) => console.error(e)); return chain.current; };

  // ---------- Musique (blind test) : jouée uniquement sur cet écran ----------
  const [audio, setAudio] = useState({ playing: false, t: 0, err: "" });
  const playerRef = useRef(null);
  if (!playerRef.current) {
    playerRef.current = new TrackPlayer({
      onUpdate: (state) => setAudio(state),
      onLimit: () => {
        const s = stRef.current;
        if (s?.status === "question" && s.phase === "playing") db.update(R, { "state/phase": "stopped" });
      },
    });
  }
  const media = playerRef.current;
  useEffect(() => {
    const unlock = () => unlockSounds();
    window.addEventListener("pointerdown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); media.destroy(); };
  }, []);
  const playFrom = (q, from, limit) => media.play(q, from, limit);
  const pauseAudio = () => media.pause();
  const resumeAudio = () => media.resume();
  const stopAudio = () => media.stop();
  const playFull = () => media.playFull();

  // ---------- Initialisation de la salle ----------
  useEffect(() => {
    preloadImages(Object.values(IMAGES));
    (async () => {
      const s = await db.get(`${R}/state`);
      const cur = await db.get(`q/${adminKey}/current`);
      if (!s || !cur || cur.roomKey !== roomKey) await newGame(false, cur?.gameType || "quiz");
      else if (s.status === "lobby") await refreshDeck(s.gameType || "quiz");
      setReady(true);
    })();
  }, []);

  const loadConfig = async () => normalizeConfig(await db.get(`q/${adminKey}/config`));
  const deckFor = (cfg, type) => (type === "blind" ? buildBlindDeck(cfg) : buildDeck(cfg));

  function stateFromSettings(s, deck, type) {
    return {
      status: "lobby", qIndex: -1, total: deck.length, title: s.title, gameType: type,
      hideScores: !!s.hideScores, lateJoin: !!s.lateJoin, mode: s.mode, scoring: s.scoring !== false,
      teams: !!s.teams, attempts: Number(s.attempts) || 0, timer: Number(s.timer) || 0, gameId: rid(),
    };
  }
  function teamsFromSettings(s) {
    if (!s.teams) return null;
    const t = {};
    for (let i = 1; i <= s.teamCount; i++) t["t" + i] = { name: s.teamNames[i - 1], score: 0 };
    return t;
  }
  function cleanPlayers(pl, s) {
    for (const p of Object.values(pl)) {
      p.score = 0;
      const n = parseInt(String(p.team || "").slice(1), 10);
      if (!s.teams || !n || n > s.teamCount) p.team = null;
    }
    return pl;
  }

  async function newGame(keepPlayers, type) {
    stopAudio();
    const cfg = await loadConfig();
    const deck = deckFor(cfg, type);
    const pl = cleanPlayers(keepPlayers ? (await db.get(`${R}/players`)) || {} : {}, cfg.settings);
    scores.current = {}; teamScores.current = {};
    local.current = { qi: -2, found: {}, results: {}, processed: new Set(), teamFound: new Set() };
    blind.current = { qi: -2, processed: new Set(), queue: [], locked: {} };
    await db.set(`q/${adminKey}/current`, { roomKey, deck, settings: cfg.settings, gameType: type });
    await db.set(R, { players: pl, teams: teamsFromSettings(cfg.settings), state: stateFromSettings(cfg.settings, deck, type) });
  }

  // Dans le salon : recharge les questions (ou change de jeu) sans perdre les joueurs
  async function refreshDeck(type) {
    const cfg = await loadConfig();
    const deck = deckFor(cfg, type);
    const s = cfg.settings;
    const teamsNow = teamsFromSettings(s);
    const old = (await db.get(`${R}/teams`)) || {};
    if (teamsNow) for (const [tid, t] of Object.entries(teamsNow)) if (old[tid]?.sound) t.sound = old[tid].sound;
    const upd = { state: { ...stateFromSettings(s, deck, type), gameId: stRef.current?.gameId || rid() }, teams: teamsNow };
    for (const [pid, p] of Object.entries((await db.get(`${R}/players`)) || {})) {
      const n = parseInt(String(p.team || "").slice(1), 10);
      if (p.team && (!s.teams || !n || n > s.teamCount)) upd[`players/${pid}/team`] = null;
    }
    await db.set(`q/${adminKey}/current`, { roomKey, deck, settings: s, gameType: type });
    await db.update(R, upd);
  }

  // ---------- Équipes ----------
  async function setTeamSettings(patch) {
    await db.update(`q/${adminKey}/config/settings`, patch);
    await refreshDeck(stRef.current?.gameType || "quiz");
  }
  async function renameTeam(tid, name) {
    const clean = name.trim().slice(0, 24);
    if (!clean || clean === teams?.[tid]?.name) return;
    const i = parseInt(tid.slice(1), 10) - 1;
    const cfg = await loadConfig();
    const names = [...cfg.settings.teamNames];
    names[i] = clean;
    await db.update(R, { [`teams/${tid}/name`]: clean });
    await db.update(`q/${adminKey}/config/settings`, { teamNames: names });
  }
  const teamIds = Object.keys(teams || {}).sort();
  function smallestTeam(pl) {
    const counts = Object.fromEntries(teamIds.map((t) => [t, 0]));
    for (const p of Object.values(pl || {})) if (p.team in counts) counts[p.team]++;
    return teamIds.reduce((a, b) => (counts[b] < counts[a] ? b : a), teamIds[0]);
  }
  async function cycleTeam(pid) {
    if (!teamIds.length) return;
    const cur = teamIds.indexOf(players[pid]?.team);
    await db.update(R, { [`players/${pid}/team`]: teamIds[(cur + 1) % teamIds.length] });
  }
  async function randomTeams() {
    const pids = Object.keys(players || {}).sort(() => Math.random() - 0.5);
    const upd = {};
    pids.forEach((pid, i) => { upd[`players/${pid}/team`] = teamIds[i % teamIds.length]; });
    await db.update(R, upd);
  }
  async function assignUnassigned() {
    if (!st?.teams || !teamIds.length) return;
    const pl = structuredClone(playersRef.current || {});
    const upd = {};
    for (const [pid, p] of Object.entries(pl)) {
      if (!p.team || !teamIds.includes(p.team)) {
        p.team = smallestTeam(pl);
        upd[`players/${pid}/team`] = p.team;
      }
    }
    if (Object.keys(upd).length) await db.update(R, upd);
  }
  // Arrivée en cours de partie : placé dans l'équipe la moins nombreuse
  useEffect(() => {
    if (st?.status === "lobby" || st?.status === "ended" || !st) return;
    (async () => { if (st.teams) await assignUnassigned(); await assignSounds(); })();
  }, [players, st?.status, st?.teams]);

  /** Ajoute les points d'une bonne réponse (au joueur, ou à son équipe) dans `upd` */
  function award(upd, pid, pts) {
    if (!pts) return;
    const p = playersRef.current?.[pid];
    if (stRef.current?.teams && p?.team) {
      const t = p.team;
      const score = (teamScores.current[t] ?? teamsRef.current?.[t]?.score ?? 0) + pts;
      teamScores.current[t] = score;
      upd[`teams/${t}/score`] = score;
    } else if (p) {
      const score = (scores.current[pid] ?? p.score ?? 0) + pts;
      scores.current[pid] = score;
      upd[`players/${pid}/score`] = score;
    }
  }
  const pointsFor = (rank) => {
    const set = curRef.current.settings;
    if (set.scoring === false) return 0;
    return (Number(set.points) || 1) + (rank === 1 ? Number(set.firstBonus) || 0 : 0);
  };
  const foundEntry = (pid, rank, pts) => {
    const p = playersRef.current?.[pid] || {};
    return { name: p.name || "?", rank, pts, at: db.now(), team: p.team || null, teamName: (p.team && teamsRef.current?.[p.team]?.name) || null };
  };

  // ---------- Déroulé ----------
  async function goTo(i, skipIntro = false) {
    const cur = curRef.current;
    const q = cur.deck[i];
    const prev = cur.deck[i - 1];
    stopAudio();
    closing.current = false;
    const base = { ...stRef.current, qIndex: i, revealed: null, queue: null, phase: null, locked: null, endsAt: null };
    if (q.type === "blind") {
      const question = { type: "blind", round: q.round, roundName: q.roundName, prompt: q.prompt, kind: q.kind || null, words: q.words || null };
      if (!skipIntro && (!prev || prev.round !== q.round)) {
        await db.set(`${R}/state`, { ...base, status: "intro", question });
        return;
      }
      await db.set(`${R}/state`, { ...base, status: "question", question, phase: "playing" });
      playFrom(q, q.start, q.end);
      return;
    }
    const timer = Number(cur.settings.timer) || 0;
    await db.set(`${R}/state`, {
      ...base, status: "question",
      question: { type: q.type, text: q.text, choices: q.type === "qcm" ? q.choices : null, image: q.image || null, cat: q.cat || null },
      endsAt: timer > 0 ? db.now() + timer * 1000 + 500 : null,
    });
  }

  /** Donne un son de buzzer libre à ceux qui n'en ont pas choisi (joueurs, ou équipes) */
  async function assignSounds() {
    if ((stRef.current?.gameType || "quiz") !== "blind") return;
    const teamMode = !!stRef.current?.teams;
    const items = teamMode ? (await db.get(`${R}/teams`)) || {} : (await db.get(`${R}/players`)) || {};
    const taken = Object.values(items).map((x) => x.sound).filter(Boolean);
    const upd = {};
    for (const [id, x] of Object.entries(items)) {
      if (x.sound) continue;
      const snd = firstFreeSound(taken);
      taken.push(snd);
      upd[`${teamMode ? "teams" : "players"}/${id}/sound`] = snd;
    }
    if (Object.keys(upd).length) await db.update(R, upd);
  }

  async function startGame() {
    unlockSounds();
    await assignUnassigned();
    await assignSounds();
    await goTo(0);
  }

  async function closeQuestion(reveal) {
    const s = stRef.current;
    if (!s || (s.status !== "question" && !reveal)) return;
    const q = curRef.current.deck[s.qIndex];
    const upd = { "state/status": "closed", "state/queue": null };
    if (reveal || curRef.current.settings.autoReveal) upd["state/revealed"] = answerText(q);
    if (q.type === "blind") { upd["state/phase"] = "reveal"; if (reveal) playFull(); }
    await db.update(R, upd);
  }

  const next = () => (qi + 1 < (st?.total || 0) ? goTo(qi + 1) : endGame());
  const endGame = () => { stopAudio(); return db.update(R, { "state/status": "ended", "state/endsAt": null, "state/queue": null }); };
  const toggleScores = () => db.update(R, { "state/hideScores": !st.hideScores });
  const kick = (pid) => { if (confirm(`Retirer ${players[pid]?.name} de la partie ?`)) db.remove(`${R}/players/${pid}`); };

  // ---------- Quiz : validation automatique des réponses écrites ----------
  async function evaluate(ans) {
    const s = stRef.current;
    const cur = curRef.current;
    if (!s || s.status !== "question" || !cur || s.question?.type === "blind") return;
    const i = s.qIndex;
    const L = local.current;
    if (L.qi !== i) {
      L.qi = i;
      L.found = (await db.get(`${R}/found/${i}`)) || {};
      L.results = (await db.get(`${R}/results/${i}`)) || {};
      L.processed = new Set();
      L.teamFound = new Set(Object.values(L.found).map((f) => f.team).filter(Boolean));
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
      if (s.teams && p.team && L.teamFound.has(p.team)) {
        upd[`results/${i}/${pid}`] = { ok: false, n: a.n, teamDone: true };
        continue;
      }
      const ok = checkAnswer(q, a.v, set.tolerance);
      L.results[pid] = { ok, n: a.n };
      upd[`results/${i}/${pid}`] = L.results[pid];
      if (ok) {
        const rank = Object.keys(L.found).length + 1;
        const pts = pointsFor(rank);
        L.found[pid] = foundEntry(pid, rank, pts);
        upd[`found/${i}/${pid}`] = L.found[pid];
        if (p.team) L.teamFound.add(p.team);
        award(upd, pid, pts);
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

  // Fin du chrono (quiz)
  const remaining = useRemaining(st?.status === "question" ? st.endsAt : null);
  useEffect(() => {
    if (remaining === 0 && st?.status === "question" && !closing.current) {
      closing.current = true;
      enqueue(() => closeQuestion(false));
    }
  }, [remaining, st?.status]);

  // ---------- Blind test : file des buzzers ----------
  function blindState() {
    const s = stRef.current;
    const B = blind.current;
    if (B.qi !== s.qIndex) {
      B.qi = s.qIndex;
      B.processed = new Set();
      B.queue = toArr(s.queue);
      B.locked = { ...(s.locked || {}) };
    }
    return B;
  }

  async function processBuzz(all) {
    const s = stRef.current;
    if (!s || s.status !== "question" || s.question?.type !== "blind") return;
    const B = blindState();
    const fresh = [];
    for (const [pid, b] of Object.entries(all || {})) {
      if (!b || typeof b.n !== "number") continue;
      const key = pid + ":" + b.n;
      if (B.processed.has(key)) continue;
      B.processed.add(key);
      const p = playersRef.current?.[pid];
      if (!p || B.locked[pid] || B.queue.some((x) => x.pid === pid)) continue;
      fresh.push({ pid, name: p.name, at: b.at || db.now(), n: b.n, team: p.team || null });
    }
    if (!fresh.length) return;
    const byTime = (a, b) => a.at - b.at;
    const wasEmpty = B.queue.length === 0;
    // Le premier de la file garde la parole ; les autres sont classés par vitesse
    B.queue = wasEmpty ? fresh.sort(byTime) : [B.queue[0], ...[...B.queue.slice(1), ...fresh].sort(byTime)];
    if (wasEmpty) pauseAudio();
    fresh.sort(byTime).forEach((b, i) => setTimeout(() => playSound(soundOf(b.pid)), i * 300));
    await db.update(R, { "state/queue": B.queue, "state/phase": "buzzed" });
  }

  useEffect(() => {
    if (buzz && st?.status === "question" && isBlind) enqueue(() => processBuzz(buzz));
  }, [buzz, st?.status, st?.qIndex]);

  function soundOf(pid) {
    const p = playersRef.current?.[pid];
    if (stRef.current?.teams && p?.team) return teamsRef.current?.[p.team]?.sound;
    return p?.sound;
  }

  async function validateBuzz() {
    const s = stRef.current;
    const B = blindState();
    const head = B.queue[0];
    if (!head) return;
    const q = curRef.current.deck[s.qIndex];
    const pts = pointsFor(1);
    const upd = {
      [`results/${s.qIndex}/${head.pid}`]: { ok: true, n: head.n },
      [`found/${s.qIndex}/${head.pid}`]: foundEntry(head.pid, 1, pts),
      "state/status": "closed", "state/queue": null, "state/phase": "reveal",
    };
    if (curRef.current.settings.autoReveal) upd["state/revealed"] = answerText(q);
    award(upd, head.pid, pts);
    B.queue = [];
    await db.update(R, upd);
    playFull(); // on écoute la suite pendant l'affichage de la réponse
  }

  async function refuseBuzz() {
    const s = stRef.current;
    const B = blindState();
    const head = B.queue.shift();
    if (!head) return;
    const upd = { [`results/${s.qIndex}/${head.pid}`]: { ok: false, n: head.n } };
    if (curRef.current.settings.blindLockout !== false) {
      B.locked[head.pid] = true;
      upd["state/locked"] = B.locked;
    }
    upd["state/queue"] = B.queue.length ? B.queue : null;
    if (!B.queue.length) upd["state/phase"] = resumeAudio() ? "playing" : "stopped";
    await db.update(R, upd);
  }

  function replayExtract() {
    const q = curRef.current.deck[qi];
    playFrom(q, q.start, q.end);
    db.update(R, { "state/phase": "playing" });
  }
  function togglePlay() {
    const q = curRef.current.deck[qi];
    if (!media.isLoaded(q)) {
      if (st.status === "closed") return media.play(q, q.start, null);
      return replayExtract();
    }
    if (!media.playing) {
      if (st.status === "closed") playFull();
      else if (resumeAudio()) db.update(R, { "state/phase": "playing" });
      else replayExtract();
    } else {
      media.pause();
      if (st.status === "question") db.update(R, { "state/phase": "stopped" });
    }
  }

  // Raccourcis clavier pour le maître du jeu (blind test)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest("input, textarea, select")) return;
      const s = stRef.current;
      if (s?.question?.type !== "blind") return;
      const hasQueue = toArr(s.queue).length > 0;
      if (s.status === "question" && hasQueue && e.key.toLowerCase() === "v") { e.preventDefault(); validateBuzz(); }
      else if (s.status === "question" && hasQueue && e.key.toLowerCase() === "x") { e.preventDefault(); refuseBuzz(); }
      else if (e.key === " " && !hasQueue) { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!ready || !st || current === undefined)
    return <div className="center-page"><div className="loading">Ouverture de la partie…</div></div>;

  const playerCount = Object.keys(players || {}).length;
  const joinUrl = location.origin + BASE;
  const gameType = st.gameType || "quiz";
  const deckQ = current?.deck?.[qi];
  const queue = toArr(st.queue);
  const scoring = st.scoring !== false;
  const unit = gameType === "blind" ? "morceau" : "question";
  const units = gameType === "blind" ? "morceaux" : "questions";

  return (
    <div className={"host status-" + st.status + (isBlind ? " is-blind" : "")}>
      <header className="host-top">
        <div className="host-title">{st.title}</div>
        {inQuestion && (
          <div className="host-progress">
            {isBlind ? `Manche ${st.question.round} · Morceau ${qi + 1} / ${st.total}` : `Question ${qi + 1} / ${st.total}`}
          </div>
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
            players={players} teams={st.teams ? teams : null} teamIds={teamIds} total={st.total} unit={unit} units={units}
            gameType={gameType} onType={(t) => refreshDeck(t)} onKick={kick} onCycle={cycleTeam} onRandom={randomTeams}
            teamCount={current?.settings?.teamCount || 2} onTeamMode={(on) => setTeamSettings({ teams: on })}
            onTeamCount={(n) => setTeamSettings({ teamCount: n })} onRename={renameTeam}
          />
        )}
        {st.status === "intro" && <RoundIntro q={st.question} />}
        {inQuestion && !isBlind && (
          <QuestionView st={st} answers={answers} found={found} playerCount={playerCount} deckQ={deckQ} />
        )}
        {inQuestion && isBlind && (
          <BlindView st={st} deckQ={deckQ} found={found} queue={queue} audio={audio} teams={teams} players={players} onToggle={togglePlay} />
        )}
        {st.status === "ended" && (
          <div className="final-wrap">
            {!scoring ? <ThanksEnd players={players} /> : st.teams ? <Podium players={teams} /> : <Podium players={players} />}
            <OptionalImage name={IMAGES.ranking} className="final-gif" />
          </div>
        )}
      </main>

      <div className="host-controls">
        {st.status === "lobby" && (
          <>
            <button className="btn btn-ghost" onClick={() => refreshDeck(gameType)}>↻ Recharger les {units}</button>
            <button className="btn btn-gold btn-big" disabled={!playerCount || !st.total} onClick={startGame}>
              Lancer {gameType === "blind" ? "le blind test" : "le quiz"} ▶
            </button>
          </>
        )}
        {st.status === "intro" && (
          <>
            <button className="btn btn-gold btn-big" onClick={() => goTo(qi, true)}>Lancer la manche ▶</button>
            <button className="btn btn-danger" onClick={() => confirm("Terminer la partie maintenant ?") && endGame()}>Terminer la partie</button>
          </>
        )}
        {inQuestion && isBlind && st.status === "question" && queue.length > 0 && (
          (current?.settings?.blindCheck || "auto") === "manual" || !deckQ?.answer ? (
            <>
              <button className="btn btn-ok btn-big" onClick={validateBuzz}>✓ Bonne réponse <kbd>V</kbd></button>
              <button className="btn btn-danger btn-big" onClick={refuseBuzz}>✗ Mauvaise réponse <kbd>X</kbd></button>
            </>
          ) : (
            <AnswerEntry
              key={queue[0].pid + ":" + queue[0].n} q={deckQ} who={queue[0].name}
              mode={current.settings.blindCheck || "auto"} onValidate={validateBuzz} onRefuse={refuseBuzz}
            />
          )
        )}
        {inQuestion && isBlind && !(st.status === "question" && queue.length > 0) && (
          <>
            <button className="btn btn-ghost" onClick={togglePlay}>{audio.playing ? "⏸ Pause" : "▶ Lecture"}</button>
            {st.status === "question" && <button className="btn btn-ghost" onClick={replayExtract}>↺ Rejouer l'extrait</button>}
            {!st.revealed && <button className="btn btn-ghost" onClick={() => closeQuestion(true)}>Révéler la réponse</button>}
            <button className="btn btn-gold btn-big" onClick={next}>{qi + 1 < st.total ? "Morceau suivant ▶" : "Voir le classement final ▶"}</button>
            <button className="btn btn-danger" onClick={() => confirm("Terminer la partie maintenant ?") && endGame()}>Terminer</button>
          </>
        )}
        {inQuestion && !isBlind && (
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
            <button className="btn btn-ghost" onClick={() => newGame(false, gameType)}>Nouvelle partie (vider les joueurs)</button>
            <button className="btn btn-gold btn-big" onClick={() => newGame(true, gameType)}>Rejouer avec les mêmes joueurs</button>
          </>
        )}
      </div>

      {st.status !== "ended" && st.status !== "lobby" && (
        <Scoreboard players={players} teams={st.teams ? teams : null} hidden={st.hideScores} onToggle={toggleScores} found={found} scoring={scoring} />
      )}
      {st.status === "lobby" && playerCount > 0 && (
        <div className="lobby-hint">{playerCount} joueur{playerCount > 1 ? "s" : ""} prêt{playerCount > 1 ? "s" : ""}</div>
      )}
    </div>
  );
}

function Lobby({ joinUrl, password, players, teams, teamIds, total, unit, units, gameType, onType, onKick, onCycle, onRandom, teamCount, onTeamMode, onTeamCount, onRename }) {
  const list = Object.entries(players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(joinUrl)}`;
  const soundIcon = (id) => {
    const snd = soundById(id);
    return snd ? <span className="chip-sound" title={`${snd.name} (cliquer pour écouter)`} onClick={(e) => { e.stopPropagation(); playSound(snd.id); }}>{snd.icon}</span> : null;
  };
  const showSounds = gameType === "blind";
  const chip = ([pid, p]) => (
    <div
      key={pid} className={"chip pop" + (teams ? " clickable" : "")} title={teams ? "Cliquer pour changer d'équipe" : ""}
      style={p.team ? { "--team": teamColor(p.team) } : undefined} onClick={teams ? () => onCycle(pid) : undefined}
    >
      {showSounds && !teams && soundIcon(p.sound)}
      {p.name}
      <button className="chip-x" title="Retirer" onClick={(e) => { e.stopPropagation(); onKick(pid); }}>×</button>
    </div>
  );
  const unassigned = list.filter(([, p]) => !p.team || !teamIds.includes(p.team));
  return (
    <div className="lobby">
      <div className="lobby-join card">
        <div className="game-switch">
          <button className={gameType === "quiz" ? "active" : ""} onClick={() => onType("quiz")}>Quiz</button>
          <button className={gameType === "blind" ? "active" : ""} onClick={() => onType("blind")}>Blind test</button>
        </div>
        <h2>Rejoignez la partie</h2>
        <img className="qr" src={qr} alt="QR code" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div className="join-url">{joinUrl.replace(/^https?:\/\//, "")}</div>
        {password && <div className="join-pwd">Mot de passe : <strong>{password}</strong></div>}
        <div className="muted">{total} {total > 1 ? units : unit} prêt{unit === "question" ? "e" : ""}{total > 1 ? "s" : ""}</div>
        {gameType === "blind" && <div className="blind-note muted">♫ La musique est jouée par cet écran : monte le son !<br />Chacun choisit son son de buzzer sur son téléphone.</div>}
      </div>
      <div className="lobby-players">
        <div className="mode-bar">
          <div className="game-switch">
            <button className={!teams ? "active" : ""} onClick={() => teams && onTeamMode(false)}>Solo</button>
            <button className={teams ? "active" : ""} onClick={() => !teams && onTeamMode(true)}>Équipes</button>
          </div>
          {teams && (
            <label className="team-count-pick">
              <select value={teamCount} onChange={(e) => onTeamCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} équipes</option>)}
              </select>
            </label>
          )}
        </div>
        {!teams ? (
          <>
            <h2>Joueurs</h2>
            {list.length === 0 && <p className="muted waiting">En attente des joueurs…</p>}
            <div className="chips">{list.map(chip)}</div>
          </>
        ) : (
          <>
            <div className="teams-head">
              <h2>Équipes</h2>
              <button className="btn btn-ghost btn-sm" disabled={!list.length} onClick={onRandom}>⤨ Répartir au hasard</button>
            </div>
            <p className="muted small">Les joueurs choisissent leur équipe sur leur téléphone, ou tu cliques sur un joueur pour le déplacer. Clique sur un nom d'équipe pour le modifier. Les joueurs sans équipe seront répartis au lancement.</p>
            <div className="teams-grid">
              {teamIds.map((tid) => (
                <div key={tid} className="team-col" style={{ "--team": teamColor(tid) }}>
                  <h3>
                    {showSounds && soundIcon(teams[tid]?.sound)}
                    <input
                      key={teams[tid]?.name} className="team-title" defaultValue={teams[tid]?.name} maxLength={24}
                      onBlur={(e) => onRename(tid, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                  </h3>
                  {showSounds && !teams[tid]?.sound && <div className="muted small">Son : au choix de l'équipe</div>}
                  <div className="chips">{list.filter(([, p]) => p.team === tid).map(chip)}</div>
                </div>
              ))}
            </div>
            {unassigned.length > 0 && (
              <div className="unassigned">
                <span className="muted">Sans équipe :</span>
                <div className="chips">{unassigned.map(chip)}</div>
              </div>
            )}
            {list.length === 0 && <p className="muted waiting">En attente des joueurs…</p>}
          </>
        )}
      </div>
    </div>
  );
}

function RoundIntro({ q }) {
  return (
    <div className="round-intro">
      <div className="round-num">Manche {q.round}</div>
      <h1>{q.roundName}</h1>
      <p className="muted">{q.prompt}</p>
      <div className="ornament">✦</div>
      <p className="muted small">Buzzez sur votre téléphone dès que vous avez la réponse.</p>
    </div>
  );
}

function Presenter({ found, status }) {
  const n = Object.keys(found || {}).length;
  const name = n > 0 ? IMAGES.found : status === "closed" ? IMAGES.nobody : IMAGES.question;
  return <OptionalImage name={name} className="presenter" />;
}

function QuestionView({ st, answers, found, playerCount, deckQ }) {
  const q = st.question || {};
  const foundList = Object.values(found || {}).sort((a, b) => a.rank - b.rank);
  const answered = Object.keys(answers || {}).length;
  const counts = {};
  if (q.type === "qcm") for (const a of Object.values(answers || {})) counts[a.v] = (counts[a.v] || 0) + 1;
  const showCounts = st.status === "closed" && q.type === "qcm";
  return (
    <div className="qview">
      <Presenter found={found} status={st.status} />
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
        {st.revealed && q.type !== "qcm" && <div className="revealed">Réponse : <strong>{st.revealed}</strong></div>}
        {st.status === "closed" && !st.revealed && <div className="muted closed-note">Question close</div>}
        <div className="answered">{answered} / {playerCount} ont répondu</div>
      </div>
      <aside className="found">
        <h3>Ont trouvé</h3>
        {foundList.length === 0 && <p className="muted">Personne pour l'instant…</p>}
        <ol>
          {foundList.map((f) => (
            <li key={f.name} className="pop" style={f.team ? { "--team": teamColor(f.team) } : undefined}>
              <span className="f-rank">{f.rank}</span>
              <span className="f-name">{f.name}{f.teamName && <small className="f-team">{f.teamName}</small>}</span>
              {f.pts > 0 && <span className="f-pts">+{f.pts}</span>}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function BlindView({ st, deckQ, found, queue, audio, teams, players, onToggle }) {
  const q = st.question || {};
  const winner = Object.values(found || {})[0];
  const len = deckQ ? deckQ.end - deckQ.start : 0;
  const pct = deckQ && len > 0 ? Math.min(100, Math.max(0, ((audio.t - deckQ.start) / len) * 100)) : 0;
  return (
    <div className="qview">
      <Presenter found={found} status={st.status} />
      <div className="qview-main">
        <div className="q-cat">Manche {q.round} · {q.roundName}</div>
        <h1 className="q-text">{q.prompt}</h1>
        {q.words > 0 && !st.revealed && <LyricBlanks n={q.words} />}
        <MusicStage
          playing={audio.playing} round={q.round} queue={queue} onToggle={onToggle}
          colorOf={(b) => (b.team ? teamColor(b.team) : soundById(players?.[b.pid]?.sound)?.color || "#f7dd9e")}
          iconOf={(b) => soundById(b.team ? teams?.[b.team]?.sound : players?.[b.pid]?.sound)?.icon || "🔔"}
        />
        {st.status === "question" && (
          <div className="extract-bar"><div style={{ width: pct + "%" }} /></div>
        )}
        {st.phase === "stopped" && st.status === "question" && !queue.length && <div className="muted closed-note">Extrait terminé : buzzez !</div>}
        {audio.err && <div className="audio-err">{audio.err}<br /><small>Passe au morceau suivant, puis corrige le lien dans la config.</small></div>}
        {audio.loading && <div className="muted small">Chargement de la musique…</div>}
        {st.revealed && <div className="revealed">Réponse : <strong>{st.revealed}</strong></div>}
        {st.status === "closed" && winner && <div className="answered">Trouvé par <strong>{winner.name}</strong>{winner.teamName ? ` (${winner.teamName})` : ""}{winner.pts ? ` · +${winner.pts}` : ""}</div>}
        {st.status === "closed" && !winner && <div className="answered">Personne n'a trouvé</div>}
      </div>
      <aside className="found buzz-panel">
        <h3>Buzzers</h3>
        {queue.length === 0 && <p className="muted">{st.status === "question" ? "En attente d'un buzz…" : "—"}</p>}
        <ol>
          {queue.map((b, i) => (
            <li key={b.pid} className={"pop" + (i === 0 ? " answering" : "")} style={b.team ? { "--team": teamColor(b.team) } : undefined}>
              <span className="f-rank">{i + 1}</span>
              <span className="f-name">{b.name}{b.team && teams?.[b.team] && <small className="f-team">{teams[b.team].name}</small>}</span>
              {i === 0 && <span className="f-pts">répond…</span>}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Scoreboard({ players, teams, hidden, onToggle, found, scoring }) {
  const foundNames = new Set(Object.values(found || {}).map((f) => f.name));
  const foundTeams = new Set(Object.values(found || {}).map((f) => f.team).filter(Boolean));
  let list = teams
    ? ranking(teams).map((t) => ({ ...t, got: foundTeams.has(t.pid), color: teamColor(t.pid) }))
    : ranking(players).map((p) => ({ ...p, got: foundNames.has(p.name) }));
  if (hidden || !scoring) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <footer className="scoreboard">
      {scoring && <button className="btn btn-ghost btn-sm" onClick={onToggle}>{hidden ? "👁 Afficher les points" : "🙈 Masquer les points"}</button>}
      <div className="sb-list">
        {list.map((p) => (
          <div key={p.pid} className={"sb-item" + (p.got ? " got" : "") + (teams ? " team" : "")} style={p.color ? { "--team": p.color } : undefined}>
            <span className="sb-name">{p.name}</span>
            {scoring && <span className="sb-score">{hidden ? "•" : p.score}</span>}
          </div>
        ))}
      </div>
    </footer>
  );
}

/** Fin de partie sans points : pas de vainqueur, juste les participants */
function ThanksEnd({ players }) {
  const list = Object.values(players || {}).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  return (
    <div className="final thanks">
      <div className="sigil big">✦</div>
      <h2 className="winner">Merci d'avoir joué !</h2>
      <p className="muted">Partie terminée avec {list.length} participant{list.length > 1 ? "s" : ""}</p>
      <div className="chips">{list.map((p) => <div key={p.name} className="chip">{p.name}</div>)}</div>
    </div>
  );
}

/** Les cases vides : nombre de mots à trouver */
export function LyricBlanks({ n }) {
  return (
    <div className="lyric-blanks">
      <div className="blanks">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
      <small>{n} mot{n > 1 ? "s" : ""} à trouver</small>
    </div>
  );
}

/**
 * Saisie, par le maître du jeu, de la réponse dite à voix haute par le joueur qui a buzzé.
 *  - mode "auto"   : le jeu vérifie et valide (ou refuse) tout seul
 *  - mode "assist" : le jeu vérifie, le maître du jeu confirme
 */
function AnswerEntry({ q, who, mode, onValidate, onRefuse }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [done, setDone] = useState(false);
  const firstRef = useRef(null);
  const isArtist = q.kind === "artist" && !!q.answer2;
  const label = q.kind === "lyrics" ? "Paroles proposées" : q.kind === "artist" ? "Artiste" : "Réponse proposée";
  const expectedWords = q.kind === "lyrics" ? q.words : null;
  const typedWords = countWords(a);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function check(e) {
    e?.preventDefault();
    if (done || !a.trim()) return;
    const v = checkBlind(q, a, b);
    setVerdict(v);
    if (mode === "auto") {
      setDone(true);
      setTimeout(() => (v.ok ? onValidate() : onRefuse()), 1300);
    }
  }
  const decide = (ok) => { setDone(true); ok ? onValidate() : onRefuse(); };

  return (
    <form className={"answer-entry" + (verdict ? (verdict.ok ? " is-ok" : " is-ko") : "")} onSubmit={check}>
      <div className="ae-who">Réponse de <strong>{who}</strong></div>
      <div className="ae-fields">
        <label className="ae-field">
          <span>{label}{expectedWords ? ` · ${typedWords}/${expectedWords} mots` : ""}</span>
          <input ref={firstRef} value={a} disabled={done} autoComplete="off" spellCheck={false}
            onChange={(e) => { setA(e.target.value); setVerdict(null); }} placeholder={q.kind === "lyrics" ? "Tape les mots dits par le joueur…" : "Tape ce que dit le joueur…"} />
        </label>
        {isArtist && (
          <label className="ae-field">
            <span>Titre</span>
            <input value={b} disabled={done} autoComplete="off" spellCheck={false}
              onChange={(e) => { setB(e.target.value); setVerdict(null); }} placeholder="Titre proposé…" />
          </label>
        )}
      </div>
      <div className="ae-actions">
        {!verdict && (
          <button className="btn btn-gold btn-big" disabled={!a.trim()}>
            {mode === "auto" ? "Valider la réponse" : "Tester la réponse"} <kbd>Entrée</kbd>
          </button>
        )}
        {verdict && (
          <div className={"ae-verdict " + (verdict.ok ? "ok" : "ko")}>
            {verdict.ok ? "✓ Bonne réponse !" : "✗ Mauvaise réponse"}
          </div>
        )}
        {mode === "assist" && verdict && !done && (
          <>
            <button type="button" className="btn btn-ok btn-big" onClick={() => decide(true)}>✓ Valider</button>
            <button type="button" className="btn btn-danger btn-big" onClick={() => decide(false)}>✗ Refuser</button>
          </>
        )}
      </div>
      {!done && (
        <div className="ae-override">
          Décider soi-même :
          <button type="button" onClick={() => decide(true)}>✓ accepter</button>
          <button type="button" onClick={() => decide(false)}>✗ refuser</button>
        </div>
      )}
    </form>
  );
}
