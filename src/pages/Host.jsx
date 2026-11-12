import { useEffect, useRef, useState } from "react";
import { getDB, useDb } from "../lib/db.js";
import { LS, BASE, rid, roomKeyFor, ranking } from "../lib/utils.js";
import { parseTime, normalizeConfig, buildDeck, buildBlindDeck, buildBonusCats, answerText, answerLabel, checkAnswer, checkBlind, countWords, toArr, TEAM_COLORS } from "../lib/quiz.js";
import { TrackPlayer, LoopMusic, youtubeStart, readyFx, playSiren, playDing } from "../lib/media.js";
import { soundById, firstFreeSound, buildSoundCatalog, buildSignal, buildClip, setSoundCatalog, getSoundCatalog, primeSignal, playSignal, primeClip, playClip } from "../lib/sounds.js";
import MusicStage from "../components/MusicStage.jsx";
import Confetti from "../components/Confetti.jsx";
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
  const roomSounds = useDb(`${R}/sounds`);
  if (roomSounds !== undefined) setSoundCatalog(toArr(roomSounds)); // sons de la partie (intégrés + personnalisés)
  const qi = st?.qIndex ?? -1;
  const isBlind = st?.question?.type === "blind";
  const inQuestion = st?.status === "question" || st?.status === "closed";
  const inBonus = st?.status === "bonus";
  const bonus = inBonus ? st.bonus : null;
  const answers = useDb(inQuestion && !isBlind ? `${R}/answers/${qi}` : null);
  const extra = useDb(inQuestion && !isBlind ? `${R}/extra/${qi}` : null);
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
  const panicTaken = useRef(null);   // question pour laquelle une panique a déjà été acceptée
  const bonusHandled = useRef(null); // question bonus dont la réponse a déjà été traitée

  const enqueue = (fn) => { chain.current = chain.current.then(fn).catch((e) => console.error(e)); return chain.current; };

  // Le navigateur n'autorise les sons générés (sirène, ding) qu'après un premier clic sur la page
  useEffect(() => {
    const h = () => readyFx();
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, []);

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
  useEffect(() => () => media.destroy(), []);
  const playFrom = (q, from, limit) => media.play(q, from, limit);
  const pauseAudio = () => media.pause();
  const resumeAudio = () => media.resume();
  const stopAudio = () => media.stop();
  const playFull = () => media.playFull();

  // ---------- Musiques d'ambiance : un seul bouton (en haut) pour toutes les couper ----------
  const [musicMuted, setMusicMuted] = useState(() => !!LS.get("quizz-music-muted"));
  const loops = useRef(null);
  if (!loops.current) {
    loops.current = { end: new LoopMusic("end"), bg: new LoopMusic("quiz-bg"), bonus: new LoopMusic("bonus-music") };
    Object.values(loops.current).forEach((m) => { m.muted = musicMuted; });
  }
  const toggleMusic = () => {
    const v = !musicMuted;
    setMusicMuted(v);
    LS.set("quizz-music-muted", v);
    Object.values(loops.current).forEach((m) => m.setMuted(v));
  };
  useEffect(() => () => Object.values(loops.current).forEach((m) => m.stop()), []);
  const clipOf = (m) => ({ link: m.link, start: parseTime(m.start) ?? youtubeStart(m.link) ?? 0, volume: m.volume });

  // Musique de fin : se lance avec le classement, en boucle
  const endMusic = current?.settings?.endMusic;
  useEffect(() => {
    if (st?.status === "ended" && endMusic?.link) loops.current.end.start(clipOf(endMusic));
    else loops.current.end.stop();
  }, [st?.status, st?.gameId, endMusic?.link, endMusic?.start]);

  // Quiz : musique de fond en boucle pendant les questions (elle reprend là où elle en était)
  const quizBg = current?.settings?.quizBg;
  const bgOn = !!quizBg?.link && st?.gameType !== "blind" && inQuestion;
  useEffect(() => {
    if (bgOn) loops.current.bg.start(clipOf(quizBg));
    else loops.current.bg.stop();
  }, [bgOn, quizBg?.link, quizBg?.start, quizBg?.volume]);

  // Question bonus : sa musique. Au blind test, seulement pendant le choix de la catégorie (sinon on n'entendrait pas le morceau)
  const bonusMusic = current?.settings?.bonusMusic;
  const bonusMusicOn = !!bonusMusic?.link && inBonus && (st?.gameType === "blind" ? bonus?.phase === "alert" : true);
  useEffect(() => {
    if (bonusMusicOn) loops.current.bonus.start(clipOf(bonusMusic));
    else loops.current.bonus.stop();
  }, [bonusMusicOn, bonusMusic?.link, bonusMusic?.start, bonusMusic?.volume]);

  // Quiz : son joué chaque fois que quelqu'un trouve la bonne réponse
  const correctClip = buildClip(current?.settings?.quizCorrect, "quiz-correct");
  useEffect(() => { primeClip(correctClip); }, [correctClip?.link, correctClip?.start]);
  const foundSeen = useRef({ qi: -9, n: 0 });
  useEffect(() => {
    if (!inQuestion || isBlind) return;
    const n = Object.keys(found || {}).length;
    if (foundSeen.current.qi !== qi) { foundSeen.current = { qi, n }; return; } // nouvelle question (ou rechargement) : pas de son
    if (n > foundSeen.current.n) playClip(correctClip);
    foundSeen.current.n = n;
  }, [found, qi, inQuestion, isBlind]);

  // Son d'alerte de la question bonus : préchargé
  const alertClip = buildClip(current?.settings?.bonusAlert, "bonus-alert");
  useEffect(() => { primeClip(alertClip); }, [alertClip?.link, alertClip?.start]);

  // Son de signal de l'écran de jeu : préchargé pour partir sans délai au buzz
  const signal = buildSignal(current?.settings);
  useEffect(() => { primeSignal(signal); }, [signal?.link, signal?.start]);

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
      panicOn: !!s.panic && s.scoring !== false, panicCooldown: Number(s.panicCooldown) || 5,
      speakTime: Number(s.speakTime) || 0, bonusTimer: Number(s.bonusTimer) || 0,
      bonusPts: { win: s.bonusWin, lose: s.bonusLose, effort: s.bonusEffort },
      partialPoints: Number(s.partialPoints) || 1,
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
      p.bonusAt = null; p.panic = null; p.bonusAnswer = null;
      const n = parseInt(String(p.team || "").slice(1), 10);
      if (!s.teams || !n || n > s.teamCount) p.team = null;
    }
    return pl;
  }
  const currentFor = (cfg, deck, type) => ({ roomKey, deck, settings: cfg.settings, gameType: type, bonusCats: buildBonusCats(cfg, type, deck) });

  async function newGame(keepPlayers, type) {
    stopAudio();
    const cfg = await loadConfig();
    const deck = deckFor(cfg, type);
    const pl = cleanPlayers(keepPlayers ? (await db.get(`${R}/players`)) || {} : {}, cfg.settings);
    scores.current = {}; teamScores.current = {};
    local.current = { qi: -2, found: {}, results: {}, processed: new Set(), teamFound: new Set() };
    blind.current = { qi: -2, processed: new Set(), queue: [], locked: {} };
    panicTaken.current = null;
    await db.set(`q/${adminKey}/current`, currentFor(cfg, deck, type));
    await db.set(R, { players: pl, teams: teamsFromSettings(cfg.settings), state: stateFromSettings(cfg.settings, deck, type), sounds: buildSoundCatalog(cfg) });
  }

  // Dans le salon : recharge les questions (ou change de jeu) sans perdre les joueurs
  async function refreshDeck(type) {
    const cfg = await loadConfig();
    const deck = deckFor(cfg, type);
    const s = cfg.settings;
    const teamsNow = teamsFromSettings(s);
    const old = (await db.get(`${R}/teams`)) || {};
    if (teamsNow) for (const [tid, t] of Object.entries(teamsNow)) if (old[tid]?.sound) t.sound = old[tid].sound;
    const upd = { state: { ...stateFromSettings(s, deck, type), gameId: stRef.current?.gameId || rid() }, teams: teamsNow, sounds: buildSoundCatalog(cfg) };
    for (const [pid, p] of Object.entries((await db.get(`${R}/players`)) || {})) {
      const n = parseInt(String(p.team || "").slice(1), 10);
      if (p.team && (!s.teams || !n || n > s.teamCount)) upd[`players/${pid}/team`] = null;
    }
    await db.set(`q/${adminKey}/current`, currentFor(cfg, deck, type));
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
  const playerKeys = Object.keys(players || {}).sort().join("|");
  useEffect(() => {
    if (st?.status === "lobby" || st?.status === "ended" || !st) return;
    (async () => { if (st.teams) await assignUnassigned(); await assignSounds(); })();
  }, [playerKeys, st?.status, st?.teams]);

  /** Ajoute (ou retire, si `pts` est négatif) des points au joueur, ou à son équipe, dans `upd` */
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
    return (Number(set.points) || 2) + (rank === 1 ? Number(set.firstBonus) || 0 : 0);
  };
  const partialPts = () => (curRef.current.settings.scoring === false ? 0 : Number(curRef.current.settings.partialPoints) || 1);
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
    const base = { ...stRef.current, qIndex: i, revealed: null, queue: null, phase: null, locked: null, endsAt: null, speakEnds: null, panic: null, bonus: null };
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
    const valid = new Set(getSoundCatalog().map((x) => x.id));
    const taken = Object.values(items).map((x) => x.sound).filter((x) => valid.has(x));
    const upd = {};
    for (const [id, x] of Object.entries(items)) {
      if (x.sound && valid.has(x.sound)) continue;
      const snd = firstFreeSound(taken);
      if (!snd) break; // aucun son de joueur dans la config
      taken.push(snd);
      upd[`${teamMode ? "teams" : "players"}/${id}/sound`] = snd;
    }
    if (Object.keys(upd).length) await db.update(R, upd);
  }

  async function startGame() {
    await assignUnassigned();
    await assignSounds();
    await goTo(0);
  }

  async function closeQuestion(reveal) {
    const s = stRef.current;
    if (!s || (s.status !== "question" && !reveal)) return;
    const q = curRef.current.deck[s.qIndex];
    const upd = { "state/status": "closed", "state/queue": null, "state/speakEnds": null };
    if (reveal || curRef.current.settings.autoReveal) upd["state/revealed"] = answerText(q);
    if (q.type === "blind") { upd["state/phase"] = "reveal"; if (reveal) playFull(); }
    await db.update(R, upd);
  }

  /** Passer à la suite : si quelqu'un a appuyé sur le bouton panique, c'est l'heure de la question bonus */
  function next() {
    const s = stRef.current;
    if (s?.panic && s.panic.qi === s.qIndex && (s.status === "question" || s.status === "closed")) return startBonus();
    return s.qIndex + 1 < (s.total || 0) ? goTo(s.qIndex + 1) : endGame();
  }
  const endGame = () => { stopAudio(); return db.update(R, { "state/status": "ended", "state/endsAt": null, "state/queue": null, "state/bonus": null, "state/panic": null }); };
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
        L.results[pid] = { ok: false, n: a.n, late: true };
        upd[`results/${i}/${pid}`] = L.results[pid];
        continue;
      }
      if (s.teams && p.team && L.teamFound.has(p.team)) {
        L.results[pid] = { ok: false, n: a.n, teamDone: true };
        upd[`results/${i}/${pid}`] = L.results[pid];
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
    // Plus personne ne peut répondre (tout le monde a trouvé ou n'a plus d'essai) : la pause commence tout de suite
    const pl = Object.entries(playersRef.current || {});
    if (!close && pl.length) {
      const done = ([pid, p]) => {
        const r = L.results[pid];
        if (L.found[pid] || r?.late || r?.teamDone) return true;
        if (s.teams && p.team && L.teamFound.has(p.team)) return true;
        return limit > 0 && r && r.n >= limit;
      };
      if (pl.every(done)) close = true;
    }
    if (close) {
      upd["state/status"] = "closed";
      upd["state/endsAt"] = null;
      if (set.autoReveal) upd["state/revealed"] = answerText(q);
    }
    if (Object.keys(upd).length) await db.update(R, upd);
  }

  useEffect(() => {
    if (answers && st?.status === "question") enqueue(() => evaluate(answers));
  }, [answers, st?.status, st?.qIndex]);

  /** Pendant la pause : le maître du jeu donne (ou reprend) un point à une réponse pertinente */
  function toggleExtra(pid) {
    enqueue(async () => {
      const i = stRef.current.qIndex;
      const given = Number(await db.get(`${R}/extra/${i}/${pid}`)) || 0;
      const upd = {};
      if (given) { upd[`extra/${i}/${pid}`] = null; award(upd, pid, -given); }
      else { const pts = partialPts(); upd[`extra/${i}/${pid}`] = pts; award(upd, pid, pts); }
      await db.update(R, upd);
    });
  }

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
  const speakEndsFrom = () => {
    const t = Number(curRef.current?.settings?.speakTime) || 0;
    return t > 0 ? db.now() + t * 1000 : null;
  };

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
    // Uniquement le son de signal sur cet écran (le son de chaque joueur sort de son téléphone)
    const sig = buildSignal(curRef.current?.settings);
    if (sig) fresh.forEach((b, i) => setTimeout(() => playSignal(sig), i * 350));
    const upd = { "state/queue": B.queue, "state/phase": "buzzed" };
    if (wasEmpty) upd["state/speakEnds"] = speakEndsFrom(); // le temps de parole commence
    await db.update(R, upd);
  }

  useEffect(() => {
    if (buzz && st?.status === "question" && isBlind) enqueue(() => processBuzz(buzz));
  }, [buzz, st?.status, st?.qIndex]);

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
      "state/status": "closed", "state/queue": null, "state/phase": "reveal", "state/speakEnds": null,
    };
    if (curRef.current.settings.autoReveal) upd["state/revealed"] = answerText(q);
    award(upd, head.pid, pts);
    B.queue = [];
    await db.update(R, upd);
    playFull(); // on écoute la suite pendant l'affichage de la réponse
  }

  /** Mauvaise réponse (avec, si `partial`, un point pour l'effort) : la parole passe au suivant de la file */
  async function refuseBuzz(partial = false) {
    const s = stRef.current;
    const B = blindState();
    const head = B.queue.shift();
    if (!head) return;
    const upd = { [`results/${s.qIndex}/${head.pid}`]: { ok: false, n: head.n, partial: partial || null } };
    if (partial) award(upd, head.pid, partialPts());
    if (curRef.current.settings.blindLockout !== false) {
      B.locked[head.pid] = true;
      upd["state/locked"] = B.locked;
    }
    upd["state/queue"] = B.queue.length ? B.queue : null;
    upd["state/speakEnds"] = B.queue.length ? speakEndsFrom() : null;
    if (!B.queue.length) upd["state/phase"] = resumeAudio() ? "playing" : "stopped";
    await db.update(R, upd);
  }
  const partialBuzz = () => refuseBuzz(true);

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

  // Temps de parole écoulé : un petit « ding » sur l'écran de jeu
  const speakLeft = useRemaining(st?.status === "question" && isBlind && toArr(st?.queue).length ? st.speakEnds : null);
  useEffect(() => { if (speakLeft === 0) playDing(520); }, [speakLeft === 0, st?.speakEnds]);

  // ---------- Bouton panique ----------
  // Les joueurs écrivent leur demande dans players/<pid>/panic ; le premier (dans le temps) l'emporte.
  useEffect(() => {
    const s = stRef.current;
    if (!s || !s.panicOn || s.panic || !(s.status === "question" || s.status === "closed") || panicTaken.current === s.qIndex + ":" + s.gameId) return;
    const cd = s.panicCooldown || 5;
    const reqs = Object.entries(players || {})
      .filter(([, p]) => p.panic && p.panic.qi === s.qIndex && p.panic.g === s.gameId && (p.bonusAt == null || s.qIndex >= p.bonusAt + cd))
      .sort((a, b) => (a[1].panic.at || 0) - (b[1].panic.at || 0));
    if (!reqs.length) return;
    const [pid, p] = reqs[0];
    panicTaken.current = s.qIndex + ":" + s.gameId;
    playDing(880);
    db.update(R, {
      "state/panic": { pid, name: p.name, qi: s.qIndex, prev: p.bonusAt ?? null, team: p.team || null },
      [`players/${pid}/bonusAt`]: s.qIndex,
    });
  }, [players, st?.status, qi, st?.panic, st?.gameId]);

  /** Le maître du jeu annule une panique (appui par erreur) : le joueur récupère son bonus */
  async function cancelPanic() {
    const s = stRef.current;
    const pn = s.panic || (s.bonus && { pid: s.bonus.pid, prev: s.bonus.prev });
    if (!pn) return;
    panicTaken.current = null; // un autre joueur pourra la déclencher sur cette question
    await db.update(R, { "state/panic": null, [`players/${pn.pid}/bonusAt`]: pn.prev ?? null, [`players/${pn.pid}/panic`]: null });
    if (s.status === "bonus") resumeAfterBonus();
  }

  // ---------- Question bonus d'urgence ----------
  /** Les catégories (quiz) ou manches (blind test) proposées, avec le nombre de questions disponibles */
  function bonusCatsInfo(fromQ) {
    const cur = curRef.current;
    const future = (cur.deck || []).slice(fromQ + 1);
    return toArr(cur.bonusCats).map((c) => ({
      key: c.key, name: c.name,
      n: toArr(c.items).length + future.filter((q) => q.catKey === c.key).length,
    }));
  }

  function startBonus() {
    readyFx();
    const s = stRef.current;
    const pn = s.panic;
    stopAudio();
    const p = playersRef.current?.[pn.pid] || {};
    const b = {
      key: rid(4), pid: pn.pid, name: pn.name, prev: pn.prev ?? null,
      team: p.team || null, teamName: (p.team && teamsRef.current?.[p.team]?.name) || null,
      phase: "alert", cats: bonusCatsInfo(s.qIndex), fromQ: s.qIndex, nextIndex: s.qIndex + 1,
    };
    // Le son d'alerte part tout de suite (on est dans le clic du maître du jeu)
    if (alertClip) playClip(alertClip); else playSiren();
    return db.update(R, { "state/status": "bonus", "state/bonus": b, "state/queue": null, "state/endsAt": null, "state/speakEnds": null, "state/panic": null });
  }

  async function pickBonusCat(key) {
    const s = stRef.current, cur = curRef.current, b = s?.bonus;
    if (!b || b.phase !== "alert") return;
    loops.current.bonus.stop();
    const cats = toArr(cur.bonusCats).map((c) => ({ ...c, items: toArr(c.items) }));
    const cat = cats.find((c) => c.key === key);
    let q = null, deck = cur.deck;
    if (cat?.items.length) q = cat.items.shift();
    else {
      // Réserve vide : on prend une question de cette catégorie qui n'a pas encore été posée
      const idx = deck.map((d, i) => i).filter((i) => i > b.fromQ && deck[i].catKey === key);
      if (!idx.length) return;
      const j = idx[Math.floor(Math.random() * idx.length)];
      q = deck[j];
      deck = deck.filter((_, i) => i !== j);
    }
    const pub = q.type === "blind"
      ? { type: "blind", round: q.round, roundName: q.roundName, prompt: q.prompt, kind: q.kind || null, words: q.words || null }
      : { type: q.type, text: q.text, choices: q.type === "qcm" ? q.choices : null, image: q.image || null, cat: q.cat || null };
    const timer = Number(cur.settings.bonusTimer) || 0;
    await db.update(`q/${adminKey}/current`, { deck, bonusCats: cats, bonusQ: q });
    curRef.current = { ...cur, deck, bonusCats: cats, bonusQ: q };
    await db.update(R, {
      "state/total": deck.length,
      "state/bonus": {
        ...b, phase: "question", catKey: key, catName: cat?.name || q.cat || q.roundName || "", question: pub,
        endsAt: q.type !== "blind" && timer > 0 ? db.now() + timer * 1000 + 500 : null,
      },
    });
    if (q.type === "blind") playFrom(q, q.start, q.end);
  }

  // Quiz : la réponse du joueur arrive dans players/<pid>/bonusAnswer
  const bonusAns = bonus ? players?.[bonus.pid]?.bonusAnswer : null;
  useEffect(() => {
    const b = stRef.current?.bonus;
    if (!b || b.phase !== "question" || !bonusAns || bonusAns.k !== b.key || bonusHandled.current === b.key) return;
    const q = curRef.current?.bonusQ;
    if (!q || q.type === "blind") return;
    bonusHandled.current = b.key;
    const label = answerLabel(q, bonusAns.v);
    if (checkAnswer(q, bonusAns.v, curRef.current.settings.tolerance)) finishBonus("win", label);
    else db.update(R, { "state/bonus/phase": "judge", "state/bonus/answer": label, "state/bonus/endsAt": null });
  }, [bonusAns?.at, bonus?.phase, bonus?.key]);

  /** Fin du temps (ou le maître du jeu juge tout de suite) : on affiche la dernière réponse */
  function judgeNow() {
    const b = stRef.current?.bonus;
    if (!b || b.phase !== "question") return;
    bonusHandled.current = b.key;
    const a = playersRef.current?.[b.pid]?.bonusAnswer;
    const q = curRef.current?.bonusQ;
    stopAudio();
    db.update(R, { "state/bonus/phase": "judge", "state/bonus/answer": a && a.k === b.key ? answerLabel(q, a.v) : null, "state/bonus/endsAt": null });
  }
  const bonusLeft = useRemaining(bonus?.phase === "question" ? bonus.endsAt : null);
  useEffect(() => { if (bonusLeft === 0) judgeNow(); }, [bonusLeft]);

  async function finishBonus(outcome, ans) {
    const s = stRef.current, b = s?.bonus, set = curRef.current.settings, q = curRef.current.bonusQ;
    if (!b || b.phase === "result") return;
    const pts = outcome === "win" ? Number(set.bonusWin) || 0 : outcome === "effort" ? Number(set.bonusEffort) || 0 : -(Number(set.bonusLose) || 0);
    const upd = {
      "state/bonus/phase": "result", "state/bonus/outcome": outcome, "state/bonus/pts": pts,
      "state/bonus/endsAt": null, "state/bonus/revealed": answerText(q),
    };
    if (ans !== undefined) upd["state/bonus/answer"] = ans;
    award(upd, b.pid, pts);
    await db.update(R, upd);
    if (q?.type === "blind") playFull();
  }

  function resumeAfterBonus() {
    const s = stRef.current;
    const n = s.bonus?.nextIndex ?? s.qIndex + 1;
    stopAudio();
    return n < (s.total || 0) ? goTo(n) : endGame();
  }

  function toggleBonusPlay() {
    const q = curRef.current?.bonusQ;
    if (!q) return;
    if (!media.isLoaded(q)) return media.play(q, q.start, bonus?.phase === "result" ? null : q.end);
    if (media.playing) media.pause();
    else if (bonus?.phase === "result") playFull();
    else if (!resumeAudio()) playFrom(q, q.start, q.end);
  }

  // ---------- Raccourcis clavier du maître du jeu ----------
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      const s = stRef.current;
      if (!s) return;
      const k = e.key.toLowerCase();
      // → ou N : passer à la suite quand la question est terminée
      if ((e.key === "ArrowRight" || k === "n") && (s.status === "closed" || (s.status === "bonus" && s.bonus?.phase === "result"))) {
        e.preventDefault();
        if (s.status === "bonus") resumeAfterBonus(); else next();
        return;
      }
      if (s.status === "bonus" && s.bonus?.phase === "judge") {
        if (k === "v") finishBonus("win");
        else if (k === "d") finishBonus("effort");
        else if (k === "x") finishBonus("lose");
        return;
      }
      if (s.question?.type !== "blind" || s.status === "bonus") return;
      const hasQueue = toArr(s.queue).length > 0;
      if (s.status === "question" && hasQueue && k === "v") { e.preventDefault(); validateBuzz(); }
      else if (s.status === "question" && hasQueue && k === "x") { e.preventDefault(); refuseBuzz(); }
      else if (s.status === "question" && hasQueue && k === "d") { e.preventDefault(); partialBuzz(); }
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
  const panicArmed = !!st.panic && st.panic.qi === qi && inQuestion;
  const isLast = qi + 1 >= st.total;
  const nextLabel = panicArmed ? "🚨 Lancer la question bonus ▶" : isLast ? "Voir le classement final ▶" : gameType === "blind" ? "Morceau suivant ▶" : "Question suivante ▶";
  const bonusPts = st.bonusPts || { win: 4, lose: 2, effort: 1 };
  const bonusQ = current?.bonusQ;
  const confirmEnd = () => confirm("Terminer la partie maintenant ?") && endGame();
  const progressPct = st.total ? Math.round(((qi + 1) / st.total) * 100) : 0;

  return (
    <div className={"host status-" + st.status + (isBlind ? " is-blind" : "") + (inBonus ? " in-bonus" : "")}>
      <header className="host-top">
        <div className="host-title">{st.title}</div>
        {(inQuestion || inBonus || st.status === "intro") && qi >= 0 && (
          <div className="host-progress">
            <span>{isBlind ? `Manche ${st.question.round} · ` : ""}{gameType === "blind" ? "Morceau" : "Question"} {Math.min(qi + 1, st.total)} / {st.total}</span>
            <div className="progress-track"><div style={{ width: progressPct + "%" }} /></div>
          </div>
        )}
        {panicArmed && (
          <div className="panic-badge pop" title="Au passage à la suite, la question bonus d'urgence se déclenchera">
            <span className="pb-light" />🚨 <strong>{st.panic.name}</strong> a appuyé sur le bouton panique
            <button onClick={() => confirm(`Annuler la panique de ${st.panic.name} ? Il pourra la réutiliser.`) && cancelPanic()} title="Annuler">×</button>
          </div>
        )}
        <nav className="host-tools">
          <button className={"tool" + (musicMuted ? " off" : "")} onClick={toggleMusic} title="Couper ou remettre les musiques d'ambiance (fond du quiz, question bonus, classement)">
            <span className="tool-ico">{musicMuted ? "🔇" : "🎵"}</span><span className="tool-label">{musicMuted ? "Musique coupée" : "Musique"}</span>
          </button>
          {st.status !== "lobby" && (
            <button className="tool" title="Arrêter la partie sans classement et revenir au salon d'attente"
              onClick={() => confirm("Arrêter la partie maintenant, sans classement, et revenir au salon d'attente ?") && newGame(true, gameType)}>
              <span className="tool-ico">⌂</span><span className="tool-label">Accueil</span>
            </button>
          )}
          <a className="tool" href={BASE + "quizz/config/"} target="_blank" rel="noreferrer" title="Ouvrir la configuration dans un nouvel onglet">
            <span className="tool-ico">⚙</span><span className="tool-label">Config</span>
          </a>
          <button className="tool icon-only" title="Déconnexion" onClick={() => { LS.del("quizz-admin"); location.reload(); }}>
            <span className="tool-ico">⏻</span>
          </button>
        </nav>
      </header>

      <main className="host-main">
        {st.status === "lobby" && (
          <Lobby
            joinUrl={joinUrl} password={current?.settings?.showPassword ? gamePassword : null}
            players={players} teams={st.teams ? teams : null} teamIds={teamIds} total={st.total} unit={unit} units={units}
            gameType={gameType} onType={(t) => refreshDeck(t)} onKick={kick} onCycle={cycleTeam} onRandom={randomTeams}
            teamCount={current?.settings?.teamCount || 2} onTeamMode={(on) => setTeamSettings({ teams: on })}
            onTeamCount={(n) => setTeamSettings({ teamCount: n })} onRename={renameTeam}
            panic={st.panicOn ? st.panicCooldown : 0} bonusPts={bonusPts}
          />
        )}
        {st.status === "intro" && <RoundIntro key={"intro" + qi} q={st.question} />}
        {inQuestion && !isBlind && (
          <QuestionView key={"q" + qi} st={st} answers={answers} found={found} extra={extra} players={players} playerCount={playerCount}
            deckQ={deckQ} onExtra={toggleExtra} partial={st.partialPoints || 1} scoring={scoring} />
        )}
        {inQuestion && isBlind && (
          <BlindView key={"b" + qi} st={st} deckQ={deckQ} found={found} queue={queue} audio={audio} teams={teams} players={players}
            onToggle={togglePlay} speakLeft={speakLeft} />
        )}
        {inBonus && bonus && (
          <BonusView b={bonus} st={st} pts={bonusPts} onPick={pickBonusCat} audio={audio} deckQ={bonusQ}
            onToggle={toggleBonusPlay} />
        )}
        {st.status === "ended" && <Confetti image={gameType === "blind" ? IMAGES.blindParty : IMAGES.quizParty} />}
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
            <button className="btn btn-danger btn-sm" onClick={confirmEnd}>Terminer</button>
            <button className="btn btn-gold btn-big" onClick={() => goTo(qi, true)}>Lancer la manche ▶</button>
          </>
        )}
        {inQuestion && isBlind && st.status === "question" && queue.length > 0 && (
          (current?.settings?.blindCheck || "auto") === "manual" || !deckQ?.answer ? (
            <div className="judge-row">
              <span className="judge-who">Réponse de <strong>{queue[0].name}</strong></span>
              <button className="btn btn-ok btn-big" onClick={validateBuzz}>✓ Bonne réponse +{pointsFor(1)} <kbd>V</kbd></button>
              <button className="btn btn-effort btn-big" onClick={partialBuzz}>🤏 +{st.partialPoints || 1} et au suivant <kbd>D</kbd></button>
              <button className="btn btn-danger btn-big" onClick={() => refuseBuzz()}>✗ Faux, au suivant <kbd>X</kbd></button>
            </div>
          ) : (
            <AnswerEntry
              key={queue[0].pid + ":" + queue[0].n} q={deckQ} who={queue[0].name}
              mode={current.settings.blindCheck || "auto"} onValidate={validateBuzz} onRefuse={() => refuseBuzz()} onPartial={partialBuzz}
              labels={{ ok: `✓ Valider +${pointsFor(1)}`, okAnyway: `✓ Valider quand même +${pointsFor(1)}`, ko: "✗ Faux, au suivant", partial: `🤏 +${st.partialPoints || 1} et au suivant` }}
            />
          )
        )}
        {inQuestion && isBlind && !(st.status === "question" && queue.length > 0) && (
          <>
            <button className="btn btn-danger btn-sm" onClick={confirmEnd}>Terminer</button>
            <button className="btn btn-ghost" onClick={togglePlay}>{audio.playing ? "⏸ Pause" : "▶ Lecture"}</button>
            {st.status === "question" && <button className="btn btn-ghost" onClick={replayExtract}>↺ Rejouer l'extrait</button>}
            {!st.revealed && <button className="btn btn-ghost" onClick={() => closeQuestion(true)}>Révéler la réponse</button>}
            <button className={"btn btn-big " + (panicArmed ? "btn-panic" : "btn-gold")} onClick={next}>{nextLabel}</button>
          </>
        )}
        {inQuestion && !isBlind && (
          <>
            <button className="btn btn-danger btn-sm" onClick={confirmEnd}>Terminer</button>
            {st.status === "question" && <button className="btn btn-ghost" onClick={() => closeQuestion(false)}>⏸ Clore et voir les réponses</button>}
            {!st.revealed && <button className="btn btn-ghost" onClick={() => closeQuestion(true)}>Révéler la réponse</button>}
            <button className={"btn btn-big " + (panicArmed ? "btn-panic" : "btn-gold")} onClick={next}>{nextLabel}{st.status === "closed" && <kbd>→</kbd>}</button>
          </>
        )}
        {inBonus && bonus?.phase === "alert" && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => confirm("Annuler cette question bonus ? Le joueur pourra réutiliser son bouton panique.") && cancelPanic()}>Annuler la question bonus</button>
            <span className="controls-hint">{bonus.name} choisit sa catégorie : clique sur la carte qu'il annonce</span>
          </>
        )}
        {inBonus && bonus?.phase === "question" && bonus.question?.type !== "blind" && (
          <>
            <span className="controls-hint">{bonus.name} répond sur son téléphone…</span>
            <button className="btn btn-ghost" onClick={judgeNow}>⏱ Arrêter et juger</button>
          </>
        )}
        {inBonus && bonus?.phase === "question" && bonus.question?.type === "blind" && bonusQ && (
          <>
            {(current?.settings?.blindCheck || "auto") === "manual" || !bonusQ.answer ? (
              <div className="judge-row">
                <button className="btn btn-ghost" onClick={toggleBonusPlay}>{audio.playing ? "⏸" : "▶"}</button>
                <button className="btn btn-ok btn-big" onClick={() => finishBonus("win")}>✓ Bonne réponse +{bonusPts.win}</button>
                <button className="btn btn-effort btn-big" onClick={() => finishBonus("effort")}>🤏 Effort +{bonusPts.effort}</button>
                <button className="btn btn-danger btn-big" onClick={() => finishBonus("lose")}>✗ Faux −{bonusPts.lose}</button>
              </div>
            ) : (
              <AnswerEntry
                key={bonus.key} q={bonusQ} who={bonus.name} mode={current.settings.blindCheck || "auto"}
                onValidate={() => finishBonus("win")} onRefuse={() => finishBonus("lose")} onPartial={() => finishBonus("effort")}
                labels={{ ok: `✓ Valider +${bonusPts.win}`, okAnyway: `✓ Valider quand même +${bonusPts.win}`, ko: `✗ Faux −${bonusPts.lose}`, partial: `🤏 Effort +${bonusPts.effort}` }}
                extra={<button type="button" className="btn btn-ghost btn-sm" onClick={toggleBonusPlay}>{audio.playing ? "⏸ Pause" : "▶ Musique"}</button>}
              />
            )}
          </>
        )}
        {inBonus && bonus?.phase === "judge" && (
          <div className="judge-row">
            <button className="btn btn-ok btn-big" onClick={() => finishBonus("win")}>✓ Validé +{bonusPts.win} <kbd>V</kbd></button>
            <button className="btn btn-effort btn-big" onClick={() => finishBonus("effort")}>🤏 Pour l'effort +{bonusPts.effort} <kbd>D</kbd></button>
            <button className="btn btn-danger btn-big" onClick={() => finishBonus("lose")}>✗ Totalement faux −{bonusPts.lose} <kbd>X</kbd></button>
          </div>
        )}
        {inBonus && bonus?.phase === "result" && (
          <>
            {bonus.question?.type === "blind" && <button className="btn btn-ghost" onClick={toggleBonusPlay}>{audio.playing ? "⏸ Pause" : "▶ Lecture"}</button>}
            <button className="btn btn-gold btn-big" onClick={resumeAfterBonus}>
              {bonus.nextIndex < st.total ? "Reprendre la partie ▶" : "Voir le classement final ▶"}<kbd>→</kbd>
            </button>
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
        <Scoreboard players={players} teams={st.teams ? teams : null} hidden={st.hideScores} onToggle={toggleScores} found={found} scoring={scoring}
          spotlight={inBonus ? (st.teams ? bonus?.team : bonus?.pid) : null} />
      )}
      {st.status === "lobby" && playerCount > 0 && (
        <div className="lobby-hint">{playerCount} joueur{playerCount > 1 ? "s" : ""} prêt{playerCount > 1 ? "s" : ""}</div>
      )}
    </div>
  );
}

function Lobby({ joinUrl, password, players, teams, teamIds, total, unit, units, gameType, onType, onKick, onCycle, onRandom, teamCount, onTeamMode, onTeamCount, onRename, panic, bonusPts }) {
  const list = Object.entries(players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(joinUrl)}`;
  const soundIcon = (id) => {
    const snd = soundById(id);
    return snd ? <span className="chip-sound" title={snd.name}>{snd.icon}</span> : null;
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
        {panic > 0 && (
          <div className="panic-rule">
            <span className="pr-ico">🚨</span>
            <span>
              <strong>Bouton panique</strong> : une question bonus rien que pour toi (+{bonusPts.win} si juste, −{bonusPts.lose} si faux).
              Une fois toutes les {panic} questions.
            </span>
          </div>
        )}
        {gameType === "blind" && (
          <div className="blind-note muted">
            ♫ La musique est jouée par cet écran : monte le son !<br />
            {getSoundCatalog().length
              ? "Chacun choisit son son de buzzer, qui sortira de son téléphone."
              : <span className="warn-sounds">⚠ Aucun son de joueur dans la config (onglet Blind test) : les téléphones ne feront pas de bruit.</span>}
          </div>
        )}
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

function Presenter({ found, status, blind }) {
  const n = Object.keys(found || {}).length;
  // Quiz : Julien Lepers ; blind test : Nagui
  const name = n > 0 ? (blind ? IMAGES.blindFound : IMAGES.found) : status === "closed" ? IMAGES.nobody : (blind ? IMAGES.blindQuestion : IMAGES.question);
  return <OptionalImage name={name} className="presenter" />;
}

function QuestionView({ st, answers, found, extra, players, playerCount, deckQ, onExtra, partial, scoring }) {
  const q = st.question || {};
  const foundList = Object.values(found || {}).sort((a, b) => a.rank - b.rank);
  const answered = Object.keys(answers || {}).length;
  const counts = {};
  if (q.type === "qcm") for (const a of Object.values(answers || {})) counts[a.v] = (counts[a.v] || 0) + 1;
  const closed = st.status === "closed";
  return (
    <div className={"qview" + (closed ? " is-review" : "")}>
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
                {closed && <span className="count">{counts[i] || 0}</span>}
              </div>
            ))}
          </div>
        )}
        {st.revealed && q.type !== "qcm" && <div className="revealed">Réponse : <strong>{st.revealed}</strong></div>}
        {closed && (
          <ReviewGrid deckQ={deckQ} answers={answers} found={found} extra={extra} players={players} onExtra={onExtra} partial={partial} scoring={scoring} />
        )}
        {!closed && <div className="answered"><span className="answered-dot" />{answered} / {playerCount} ont répondu</div>}
      </div>
      {!closed && (
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
      )}
    </div>
  );
}

/** La pause après une question : la dernière réponse de chacun, et un +1 pour les réponses pertinentes */
function ReviewGrid({ deckQ, answers, found, extra, players, onExtra, partial, scoring }) {
  const list = Object.entries(players || {}).map(([pid, p]) => ({
    pid, name: p.name, team: p.team, f: found?.[pid], a: answers?.[pid], x: Number(extra?.[pid]) || 0,
  }));
  list.sort((a, b) => (a.f ? a.f.rank : 999) - (b.f ? b.f.rank : 999) || (!!b.a - !!a.a) || a.name.localeCompare(b.name));
  return (
    <div className="review">
      <div className="review-head">
        <h3>Les réponses</h3>
        {scoring && <span className="muted small">Une réponse pertinente ? Clique sur <strong>+{partial}</strong> pour la récompenser</span>}
      </div>
      <div className="review-grid">
        {list.map((r, i) => (
          <div key={r.pid} className={"rv-card" + (r.f ? " ok" : r.x ? " bonus" : !r.a ? " empty" : "")}
            style={{ animationDelay: i * 45 + "ms", ...(r.team ? { "--team": teamColor(r.team) } : {}) }}>
            <div className="rv-name">{r.name}</div>
            <div className="rv-answer">{r.a ? answerLabel(deckQ, r.a.v) : <em>Pas de réponse</em>}</div>
            {r.f ? (
              <span className="rv-tag ok">✓ {r.f.pts > 0 ? "+" + r.f.pts : "Trouvé"}</span>
            ) : scoring ? (
              <button className={"rv-plus" + (r.x ? " on" : "")} onClick={() => onExtra(r.pid)} title={r.x ? "Retirer le point" : "Donner un point pour cette réponse"}>
                {r.x ? `✓ +${r.x}` : `+${partial}`}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function BlindView({ st, deckQ, found, queue, audio, teams, players, onToggle, speakLeft }) {
  const q = st.question || {};
  const winner = Object.values(found || {})[0];
  const len = deckQ ? deckQ.end - deckQ.start : 0;
  const pct = deckQ && len > 0 ? Math.min(100, Math.max(0, ((audio.t - deckQ.start) / len) * 100)) : 0;
  const speakTotal = st.speakTime || 0;
  return (
    <div className="qview">
      <Presenter found={found} status={st.status} blind />
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
              {i === 0 && (speakLeft != null
                ? <SpeakRing left={speakLeft} total={speakTotal} />
                : <span className="f-pts">répond…</span>)}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

/** Temps de parole : un petit cercle qui se vide */
function SpeakRing({ left, total }) {
  const pct = total ? Math.max(0, Math.min(1, left / total)) : 0;
  const C = 2 * Math.PI * 16;
  return (
    <span className={"speak-ring" + (left === 0 ? " over" : left <= 3 ? " urgent" : "")} title="Temps de parole">
      <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" className="sr-bg" /><circle cx="20" cy="20" r="16" className="sr-fg" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pct) }} /></svg>
      <b>{left === 0 ? "⏰" : left}</b>
    </span>
  );
}

/** La question bonus d'urgence, sur l'écran de jeu */
function BonusView({ b, st, pts, onPick, audio, deckQ, onToggle }) {
  const q = b.question || {};
  const who = (
    <span className="bn-who" style={b.team ? { "--team": teamColor(b.team) } : undefined}>
      {b.name}{b.teamName && <small> · {b.teamName}</small>}
    </span>
  );
  if (b.phase === "alert") {
    const cats = toArr(b.cats);
    return (
      <div className="bonus-alert" key={b.key}>
        <div className="ba-flash" />
        <div className="ba-stripes top" /><div className="ba-stripes bottom" />
        <div className="ba-head">
          <div className="ba-beacon"><span>🚨</span></div>
          <div className="ba-title">
            <small>Alerte générale</small>
            <h1>Question bonus d'urgence !</h1>
          </div>
          <div className="ba-beacon"><span>🚨</span></div>
        </div>
        <p className="ba-sub">{who} a appuyé sur le bouton panique</p>
        <div className="ba-rules">
          <span className="ok">+{pts.win} si c'est juste</span>
          <span className="eff">+{pts.effort} pour l'effort</span>
          <span className="ko">−{pts.lose} si c'est faux</span>
        </div>
        <p className="ba-pick">{b.name}, choisis ta catégorie !</p>
        <div className="ba-cats">
          {cats.length === 0 && <p className="muted">Aucune question disponible pour la question bonus.</p>}
          {cats.map((c, i) => (
            <button key={c.key} className="ba-card" disabled={!c.n} onClick={() => onPick(c.key)} style={{ animationDelay: 0.5 + i * 0.09 + "s" }}>
              <span className="bc-corner tl">✦</span><span className="bc-corner br">✦</span>
              <span className="bc-sigil">{["☾", "✶", "♆", "☉", "♅", "✷", "☿", "♄"][i % 8]}</span>
              <span className="bc-name">{c.name}</span>
              <span className="bc-count">{c.n ? `${c.n} question${c.n > 1 ? "s" : ""}` : "épuisée"}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  const blind = q.type === "blind";
  return (
    <div className={"bonus-stage phase-" + b.phase} key={b.key}>
      <div className="bn-banner">
        <span className="bn-tag">🚨 Question bonus</span>
        {who}
        <span className="bn-cat">{b.catName}</span>
      </div>
      {blind ? (
        <>
          <h1 className="q-text">{q.prompt}</h1>
          {q.words > 0 && b.phase !== "result" && <LyricBlanks n={q.words} />}
          <MusicStage playing={audio.playing} round={q.round} queue={[]} onToggle={onToggle} colorOf={() => "#ff5a5a"} iconOf={() => "🚨"} />
          {audio.err && <div className="audio-err">{audio.err}</div>}
        </>
      ) : (
        <>
          {b.phase === "question" && <Timer endsAt={b.endsAt} total={st.bonusTimer} />}
          <h1 className="q-text">{q.text}</h1>
          {q.image && <img className="q-img" src={q.image} alt="" />}
          {q.type === "qcm" && (
            <div className="choices">
              {(q.choices || []).map((c, i) => (
                <div key={i} className={"choice" + (b.revealed && deckQ?.correct === i ? " correct" : "") + (b.revealed && deckQ?.correct !== i ? " dim" : "")}>
                  <span className="letter">{LETTERS[i]}</span><span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {b.phase === "question" && !blind && <div className="bn-thinking">{b.name} réfléchit<span className="dots"><i>.</i><i>.</i><i>.</i></span></div>}
      {b.phase === "question" && blind && <div className="bn-thinking">{b.name}, à toi de répondre à voix haute !</div>}
      {b.phase === "judge" && (
        <div className="bn-judge">
          <div className="bn-given">
            <small>Réponse de {b.name}</small>
            <strong>{b.answer || <em>Pas de réponse</em>}</strong>
          </div>
          <div className="bn-expected"><small>Réponse attendue</small><strong>{deckQ ? answerText(deckQ) : "?"}</strong></div>
          <div className="bn-deliberate">Le maître du jeu délibère…</div>
        </div>
      )}
      {b.phase === "result" && (
        <div className={"bn-result " + b.outcome}>
          <div className="bn-points">{b.pts > 0 ? "+" + b.pts : b.pts < 0 ? "−" + Math.abs(b.pts) : "0"}</div>
          <div className="bn-verdict">
            {b.outcome === "win" ? "🎉 Bonne réponse !" : b.outcome === "effort" ? "🤏 Pour l'effort !" : "💀 Raté !"}
          </div>
          {b.answer && b.outcome !== "win" && <div className="bn-given small"><small>{b.name} a répondu</small> <strong>{b.answer}</strong></div>}
          {b.revealed && <div className="revealed">Réponse : <strong>{b.revealed}</strong></div>}
          {b.outcome === "win" && <div className="bn-sparkles">{Array.from({ length: 18 }, (_, i) => <span key={i} style={{ "--a": i * 20 + "deg", "--d": (i % 3) * 0.12 + "s" }} />)}</div>}
        </div>
      )}
    </div>
  );
}

function Scoreboard({ players, teams, hidden, onToggle, found, scoring, spotlight }) {
  const foundNames = new Set(Object.values(found || {}).map((f) => f.name));
  const foundTeams = new Set(Object.values(found || {}).map((f) => f.team).filter(Boolean));
  let list = teams
    ? ranking(teams).map((t) => ({ ...t, got: foundTeams.has(t.pid), color: teamColor(t.pid) }))
    : ranking(players).map((p) => ({ ...p, got: foundNames.has(p.name) }));
  if (hidden || !scoring) list = [...list].sort((a, b) => a.name.localeCompare(b.name));

  // Petites bulles « +2 », « −2 » quand un score change
  const prev = useRef(null);
  const [deltas, setDeltas] = useState({});
  const sig = list.map((p) => p.pid + ":" + p.score).join("|");
  useEffect(() => {
    const before = prev.current;
    prev.current = Object.fromEntries(list.map((p) => [p.pid, p.score]));
    if (!before || hidden || !scoring) return;
    const d = {};
    for (const p of list) if (before[p.pid] != null && before[p.pid] !== p.score) d[p.pid] = { v: p.score - before[p.pid], id: Math.random() };
    if (!Object.keys(d).length) return;
    setDeltas((x) => ({ ...x, ...d }));
    setTimeout(() => setDeltas((x) => {
      const n = { ...x };
      for (const k in d) if (n[k]?.id === d[k].id) delete n[k];
      return n;
    }), 2200);
  }, [sig]);

  return (
    <footer className="scoreboard">
      {scoring && <button className="btn btn-ghost btn-sm" onClick={onToggle}>{hidden ? "👁 Afficher les points" : "🙈 Masquer les points"}</button>}
      <div className="sb-list">
        {list.map((p) => {
          const d = deltas[p.pid];
          return (
            <div key={p.pid} className={"sb-item" + (p.got ? " got" : "") + (teams ? " team" : "") + (spotlight === p.pid ? " spot" : "") + (d ? (d.v > 0 ? " up" : " down") : "")}
              style={p.color ? { "--team": p.color } : undefined}>
              {!hidden && scoring && p.rank <= 3 && p.score > 0 && <span className="sb-medal">{["🥇", "🥈", "🥉"][p.rank - 1]}</span>}
              <span className="sb-name">{p.name}</span>
              {scoring && <span className="sb-score" key={hidden ? "h" : p.score}>{hidden ? "•" : p.score}</span>}
              {d && <span key={d.id} className={"sb-delta " + (d.v > 0 ? "up" : "down")}>{d.v > 0 ? "+" + d.v : "−" + Math.abs(d.v)}</span>}
            </div>
          );
        })}
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
 *  - mode "auto"   : le jeu vérifie et valide tout seul une bonne réponse
 *  - mode "assist" : le jeu vérifie, le maître du jeu confirme
 * Si c'est faux, le maître du jeu choisit : faux, point d'effort (onPartial), ou valider quand même.
 */
function AnswerEntry({ q, who, mode, onValidate, onRefuse, onPartial, labels = {}, extra }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [verdict, setVerdict] = useState(null);
  const [done, setDone] = useState(false);
  const firstRef = useRef(null);
  const isArtist = q.kind === "artist" && !!q.answer2;
  const label = q.kind === "lyrics" ? "Paroles proposées" : q.kind === "artist" ? "Artiste" : "Réponse proposée";
  const expectedWords = q.kind === "lyrics" ? q.words : null;
  const typedWords = countWords(a);
  const L = { ok: "✓ Valider", okAnyway: "✓ Valider quand même", ko: "✗ Refuser, au suivant", partial: "🤏 +1 et au suivant", ...labels };

  useEffect(() => { firstRef.current?.focus(); }, []);

  function check(e) {
    e?.preventDefault();
    if (done || !a.trim()) return;
    const v = checkBlind(q, a, b);
    setVerdict(v);
    // Bonne réponse en mode automatique : validée toute seule.
    if (mode === "auto" && v.ok) {
      setDone(true);
      setTimeout(onValidate, 1300);
    }
  }
  const decide = (fn) => { setDone(true); fn(); };

  return (
    <form className={"answer-entry" + (verdict ? (verdict.ok ? " is-ok" : " is-ko") : "")} onSubmit={check}>
      <div className="ae-who">Réponse de <strong>{who}</strong>{extra}</div>
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
        {verdict && !done && (mode === "assist" || !verdict.ok) && (
          <>
            <button type="button" className="btn btn-ok btn-big" onClick={() => decide(onValidate)}>{verdict.ok ? L.ok : L.okAnyway}</button>
            {onPartial && !verdict.ok && <button type="button" className="btn btn-effort btn-big" onClick={() => decide(onPartial)}>{L.partial}</button>}
            <button type="button" className="btn btn-danger btn-big" onClick={() => decide(onRefuse)}>{L.ko}</button>
          </>
        )}
      </div>
      {verdict && !verdict.ok && !done && (
        <div className="ae-override">Faute de frappe dans ta saisie ? Corrige-la puis appuie sur Entrée pour retester.</div>
      )}
      {!done && !verdict && (
        <div className="ae-override">
          Décider soi-même :
          <button type="button" onClick={() => decide(onValidate)}>✓ accepter</button>
          {onPartial && <button type="button" onClick={() => decide(onPartial)}>🤏 effort</button>}
          <button type="button" onClick={() => decide(onRefuse)}>✗ refuser</button>
        </div>
      )}
    </form>
  );
}
