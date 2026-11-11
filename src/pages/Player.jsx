import { useEffect, useState } from "react";
import { getDB, useDb } from "../lib/db.js";
import { SESSION, go, ranking } from "../lib/utils.js";
import { toArr, TEAM_COLORS } from "../lib/quiz.js";
import { SOUNDS, playSound, unlockSounds } from "../lib/sounds.js";
import Timer, { useRemaining } from "../components/Timer.jsx";
import Podium from "../components/Podium.jsx";
import OptionalImage, { IMAGES } from "../components/OptionalImage.jsx";
import "../styles/player.css";

const LETTERS = "ABCDEFGH";
const teamColor = (tid) => TEAM_COLORS[(parseInt(String(tid).slice(1), 10) || 1) - 1] || TEAM_COLORS[0];

export default function Player({ name }) {
  const session = SESSION.get();
  const valid = session && session.name === name;

  useEffect(() => {
    if (!valid) go("?pseudo=" + encodeURIComponent(name));
  }, [valid]);
  if (!valid) return null;
  return <PlayerGame session={session} />;
}

function PlayerGame({ session }) {
  const { roomKey, pid, token, name } = session;
  const R = `q/${roomKey}`;
  const st = useDb(`${R}/state`);
  const me = useDb(`${R}/players/${pid}`);
  const players = useDb(`${R}/players`);
  const teams = useDb(`${R}/teams`);

  if (st === undefined || me === undefined) return <div className="center-page"><div className="loading">Connexion…</div></div>;

  if (!st || !me || me.token !== token) {
    return (
      <div className="center-page">
        <div className="card">
          <h2>Tu n'es plus dans la partie</h2>
          <p className="muted">Le maître du jeu a peut-être lancé une nouvelle partie ou t'a retiré.</p>
          <button className="btn btn-gold" onClick={() => { SESSION.del(); go("?pseudo=" + encodeURIComponent(name)); }}>
            Rejoindre à nouveau
          </button>
        </div>
      </div>
    );
  }

  const scoring = st.scoring !== false;
  const teamMode = !!st.teams && !!teams;
  const myTeam = teamMode && me.team && teams[me.team] ? { id: me.team, ...teams[me.team] } : null;
  const myRank = teamMode
    ? ranking(teams).find((t) => t.pid === me.team)
    : ranking(players).find((p) => p.pid === pid);
  const myScore = teamMode ? myTeam?.score || 0 : me.score || 0;
  const isBlind = st.question?.type === "blind";

  return (
    <div className="player">
      <header className="p-top">
        <span className="p-name">{me.name}</span>
        {myTeam && <span className="p-team" style={{ "--team": teamColor(myTeam.id) }}>{myTeam.name}</span>}
        {st.status !== "lobby" && st.status !== "ended" && <span className="p-progress">{st.qIndex + 1}/{st.total}</span>}
        {scoring && !st.hideScores && (!teamMode || myTeam) && <span className="p-score">{myScore} pt{myScore > 1 ? "s" : ""}</span>}
      </header>

      {st.status === "lobby" && (
        <PlayerLobby players={players} title={st.title} myTeam={myTeam} isBlind={st.gameType === "blind"}>
          {st.gameType === "blind" && <SoundPicker R={R} pid={pid} me={me} teamMode={teamMode} myTeam={myTeam} players={players} teams={teams} />}
        </PlayerLobby>
      )}
      {st.status === "intro" && <PlayerIntro q={st.question} />}
      {(st.status === "question" || st.status === "closed") && !isBlind && (
        <PlayerQuestion key={`${st.gameId}-${st.qIndex}`} st={st} R={R} pid={pid} myTeam={myTeam?.id} />
      )}
      {(st.status === "question" || st.status === "closed") && isBlind && (
        <PlayerBlind key={`${st.gameId}-${st.qIndex}`} st={st} R={R} pid={pid} myTeam={myTeam?.id} />
      )}
      {st.status === "ended" && (
        <div className="p-ended">
          <h2>Partie terminée</h2>
          {!scoring && <p className="p-myrank">Merci d'avoir joué, <strong>{me.name}</strong> !</p>}
          {scoring && myRank && (
            <p className="p-myrank">
              {teamMode ? <>Ton équipe <strong>{myTeam?.name}</strong> termine </> : "Tu termines "}
              <strong>{myRank.rank === 1 ? (teamMode ? "1re 🏆" : "1er 🏆") : myRank.rank + "e"}</strong> avec {myRank.score} pt{myRank.score > 1 ? "s" : ""}
            </p>
          )}
          {scoring && <Podium players={teamMode ? teams : players} highlight={teamMode ? me.team : pid} />}
          <OptionalImage name={IMAGES.ranking} className="final-gif" />
        </div>
      )}
    </div>
  );
}

function PlayerLobby({ players, title, myTeam, isBlind, children }) {
  const list = Object.values(players || {});
  const mates = myTeam ? list.filter((p) => p.team === myTeam.id) : list;
  return (
    <div className="p-lobby">
      <div className="sigil big pulse">✦</div>
      <h2>Tu es dans la partie !</h2>
      <p className="muted">{isBlind ? "Le blind test" : title} va bientôt commencer. Regarde l'écran principal…</p>
      {myTeam && <div className="p-team-big" style={{ "--team": teamColor(myTeam.id) }}>{myTeam.name}</div>}
      <div className="chips small">
        {mates.map((p) => <div key={p.name} className="chip">{p.name}</div>)}
      </div>
      {isBlind && <p className="muted small">Pendant le blind test, tu buzzes avec un gros bouton puis tu réponds à voix haute.</p>}
      {children}
    </div>
  );
}

/** Choix du son de buzzer (par joueur, ou par équipe) : il sera joué sur l'écran principal à chaque buzz */
function SoundPicker({ R, pid, me, teamMode, myTeam, players, teams }) {
  const db = getDB();
  if (teamMode && !myTeam) return <p className="muted small sound-wait">Le son de buzzer se choisit une fois que tu es dans une équipe.</p>;
  const current = teamMode ? myTeam.sound : me.sound;
  const taken = new Map();
  if (teamMode) for (const [tid, t] of Object.entries(teams || {})) { if (tid !== myTeam.id && t.sound) taken.set(t.sound, t.name); }
  else for (const [id, p] of Object.entries(players || {})) { if (id !== pid && p.sound) taken.set(p.sound, p.name); }
  const allTaken = SOUNDS.every((x) => taken.has(x.id) || x.id === current);

  function pick(id) {
    unlockSounds();
    playSound(id);
    if (taken.has(id) && !allTaken) return;
    db.update(R, { [teamMode ? `teams/${myTeam.id}/sound` : `players/${pid}/sound`]: id });
  }

  return (
    <div className="sound-picker">
      <h3>{teamMode ? `Le son de buzzer de ${myTeam.name}` : "Choisis ton son de buzzer"}</h3>
      <p className="muted small">Touche un son pour l'écouter et le choisir. Il retentira sur le grand écran quand tu buzzeras.</p>
      <div className="sound-grid">
        {SOUNDS.map((x) => {
          const owner = taken.get(x.id);
          return (
            <button key={x.id} className={"sound-btn" + (current === x.id ? " active" : "") + (owner && !allTaken ? " taken" : "")}
              style={{ "--c": x.color }} onClick={() => pick(x.id)}>
              <span className="sound-icon">{x.icon}</span>
              <span className="sound-name">{x.name}</span>
              {owner && !allTaken && <span className="sound-owner">{owner}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerIntro({ q }) {
  return (
    <div className="p-lobby">
      <div className="round-num">Manche {q?.round}</div>
      <h2>{q?.roundName}</h2>
      <p className="muted">{q?.prompt}</p>
      <p className="muted small">Prépare ton buzzer…</p>
    </div>
  );
}

/** Blind test : un gros buzzer. Le premier à buzzer répond à voix haute, le maître du jeu valide. */
function PlayerBlind({ st, R, pid, myTeam }) {
  const db = getDB();
  const qi = st.qIndex;
  const q = st.question || {};
  const result = useDb(`${R}/results/${qi}/${pid}`);
  const mine = useDb(`${R}/buzz/${qi}/${pid}`);
  const found = useDb(`${R}/found/${qi}`);
  const [sent, setSent] = useState(0);
  const [pressed, setPressed] = useState(false);
  const queue = toArr(st.queue);
  const pos = queue.findIndex((b) => b.pid === pid);
  const locked = !!st.locked?.[pid];
  const pending = sent > (result?.n || 0) && pos < 0 && st.status === "question" && !locked;
  const open = st.status === "question";
  const canBuzz = open && !locked && pos < 0 && !pending && !result?.ok;
  const winner = Object.entries(found || {})[0];

  async function press() {
    if (!canBuzz) return;
    const n = Math.max(sent, result?.n || 0, mine?.n || 0) + 1;
    setSent(n);
    setPressed(true);
    setTimeout(() => setPressed(false), 180);
    navigator.vibrate?.(60);
    await db.set(`${R}/buzz/${qi}/${pid}`, { n, at: db.now() });
  }

  let msg = null;
  if (result?.ok) msg = <div className="fb ok">✓ Bonne réponse !</div>;
  else if (!open && winner) msg = <div className="fb info">{winner[0] === pid ? "Bravo !" : `${winner[1].name} a trouvé`}{winner[1].team && winner[1].team === myTeam && winner[0] !== pid ? " (ton équipe !)" : ""}</div>;
  else if (!open) msg = <div className="fb info">Morceau terminé</div>;
  else if (pos === 0) msg = <div className="fb your-turn">À toi ! Donne ta réponse à voix haute</div>;
  else if (pos > 0) msg = <div className="fb wait-turn">Tu es {pos + 1}e dans la file · {queue[0].name} répond…</div>;
  else if (pending) msg = <div className="fb wait">Buzz envoyé…</div>;
  else if (locked) msg = <div className="fb ko">✗ Raté pour ce morceau, attends le suivant</div>;
  else if (result && !result.ok) msg = <div className="fb ko">✗ Mauvaise réponse, tu peux rebuzzer !</div>;
  else if (queue.length) msg = <div className="fb wait-turn">{queue[0].name} répond… tu peux buzzer pour passer après</div>;

  return (
    <div className="p-blind">
      <div className="q-cat">Manche {q.round} · {q.roundName}</div>
      <h2 className="p-qtext">{q.prompt}</h2>
      <button
        className={"buzzer" + (pos === 0 ? " first" : pos > 0 || pending ? " queued" : "") + (result?.ok ? " won" : "") + (locked ? " locked" : "") + (pressed ? " pressed" : "")}
        disabled={!canBuzz} onPointerDown={press} aria-label="Buzzer"
      >
        <span className="buzzer-ring" />
        <span className="buzzer-cap">
          <span className="buzzer-text">{result?.ok ? "✓" : pos === 0 ? "À toi !" : pos > 0 ? `${pos + 1}e` : locked ? "✗" : "BUZZ"}</span>
        </span>
      </button>
      {msg}
      {st.revealed && <div className="p-revealed">La réponse était : <strong>{st.revealed}</strong></div>}
    </div>
  );
}

function PlayerQuestion({ st, R, pid, myTeam }) {
  const db = getDB();
  const qi = st.qIndex;
  const q = st.question || {};
  const result = useDb(`${R}/results/${qi}/${pid}`);
  const found = useDb(`${R}/found/${qi}`);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);      // numéro du dernier essai envoyé
  const [picked, setPicked] = useState(null);
  const remaining = useRemaining(st.status === "question" ? st.endsAt : null);

  const limit = q.type === "qcm" ? 1 : st.attempts || 0;
  const tries = Math.max(sent, result?.n || 0);
  const waiting = sent > (result?.n || 0);
  const open = st.status === "question" && remaining !== 0;
  const othersFound = Object.entries(found || {}).filter(([k]) => k !== pid).map(([, f]) => f);
  const blockedFirst = st.mode === "first" && othersFound.length > 0 && !result?.ok;
  const teamFound = myTeam && !result?.ok ? Object.entries(found || {}).find(([k, f]) => k !== pid && f.team === myTeam)?.[1] : null;
  const outOfTries = limit > 0 && tries >= limit && !waiting && !result?.ok;
  const canAnswer = open && !result?.ok && !waiting && !outOfTries && !blockedFirst && !teamFound;

  async function send(v) {
    const n = tries + 1;
    setSent(n);
    await db.set(`${R}/answers/${qi}/${pid}`, { v, n, at: db.now() });
  }

  function submitText(e) {
    e.preventDefault();
    const v = text.trim();
    if (!v || !canAnswer) return;
    send(v);
  }

  // Après une mauvaise réponse, on vide le champ pour réessayer
  useEffect(() => {
    if (result && !result.ok) setText("");
  }, [result?.n]);

  let feedback = null;
  if (result?.ok) feedback = <div className="fb ok">✓ Bonne réponse !</div>;
  else if (teamFound) feedback = <div className="fb ok">✓ Ton équipe a trouvé grâce à {teamFound.name} !</div>;
  else if (waiting) feedback = <div className="fb wait">Vérification…</div>;
  else if (result?.late || blockedFirst) feedback = <div className="fb info">🏆 {othersFound[0]?.name || "Quelqu'un"} a trouvé en premier !</div>;
  else if (result && !result.ok) feedback = <div className="fb ko">✗ Mauvaise réponse{canAnswer ? ", essaie encore !" : ""}</div>;
  if (!open && !result?.ok && !feedback) feedback = <div className="fb info">Les réponses sont fermées</div>;

  return (
    <div className="p-question">
      {q.cat && <div className="q-cat">{q.cat}</div>}
      <Timer endsAt={st.status === "question" ? st.endsAt : null} total={st.timer} />
      <h2 className="p-qtext">{q.text}</h2>
      {q.image && <img className="p-img" src={q.image} alt="" />}

      {q.type === "qcm" ? (
        <div className="p-choices">
          {(q.choices || []).map((c, i) => (
            <button
              key={i}
              className={"p-choice" + (picked === i ? " picked" : "") + (st.revealed && c === st.revealed ? " correct" : "")}
              disabled={!canAnswer}
              onClick={() => { setPicked(i); send(i); }}
            >
              <span className="letter">{LETTERS[i]}</span>{c}
            </button>
          ))}
        </div>
      ) : (
        <form className="p-form" onSubmit={submitText}>
          <input
            value={text} onChange={(e) => setText(e.target.value)} disabled={!canAnswer}
            placeholder={canAnswer ? "Ta réponse…" : ""} autoComplete="off" autoCapitalize="off" autoCorrect="off" enterKeyHint="send"
          />
          <button className="btn btn-gold" disabled={!canAnswer || !text.trim()}>Envoyer</button>
        </form>
      )}

      {limit > 1 && !result?.ok && open && <div className="muted tries">Essais : {tries}/{limit}</div>}
      {feedback}
      {st.revealed && <div className="p-revealed">La réponse était : <strong>{st.revealed}</strong></div>}
    </div>
  );
}
