import { useEffect, useState } from "react";
import { getDB, useDb } from "../lib/db.js";
import { SESSION, go, ranking } from "../lib/utils.js";
import Timer, { useRemaining } from "../components/Timer.jsx";
import Podium from "../components/Podium.jsx";
import OptionalImage, { IMAGES } from "../components/OptionalImage.jsx";
import "../styles/player.css";

const LETTERS = "ABCDEFGH";

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
  const myRank = ranking(players).find((p) => p.pid === pid);

  return (
    <div className="player">
      <header className="p-top">
        <span className="p-name">{me.name}</span>
        {st.status !== "lobby" && st.status !== "ended" && <span className="p-progress">{st.qIndex + 1}/{st.total}</span>}
        {scoring && !st.hideScores && <span className="p-score">{me.score || 0} pt{(me.score || 0) > 1 ? "s" : ""}</span>}
      </header>

      {st.status === "lobby" && <PlayerLobby players={players} title={st.title} />}
      {(st.status === "question" || st.status === "closed") && (
        <PlayerQuestion key={`${st.gameId}-${st.qIndex}`} st={st} R={R} pid={pid} />
      )}
      {st.status === "ended" && (
        <div className="p-ended">
          <h2>Partie terminée</h2>
          {!scoring && <p className="p-myrank">Merci d'avoir joué, <strong>{me.name}</strong> !</p>}
          {scoring && myRank && <p className="p-myrank">Tu termines <strong>{myRank.rank === 1 ? "1er 🏆" : myRank.rank + "e"}</strong> avec {myRank.score} pt{myRank.score > 1 ? "s" : ""}</p>}
          {scoring && <Podium players={players} highlight={pid} />}
          <OptionalImage name={IMAGES.ranking} className="final-gif" />
        </div>
      )}
    </div>
  );
}

function PlayerLobby({ players, title }) {
  const list = Object.values(players || {});
  return (
    <div className="p-lobby">
      <div className="sigil big pulse">✦</div>
      <h2>Tu es dans la partie !</h2>
      <p className="muted">{title} va bientôt commencer. Regarde l'écran principal…</p>
      <div className="chips small">
        {list.map((p) => <div key={p.name} className="chip">{p.name}</div>)}
      </div>
    </div>
  );
}

function PlayerQuestion({ st, R, pid }) {
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
  const outOfTries = limit > 0 && tries >= limit && !waiting && !result?.ok;
  const canAnswer = open && !result?.ok && !waiting && !outOfTries && !blockedFirst;

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
