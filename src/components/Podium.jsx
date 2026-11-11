import { ranking } from "../lib/utils.js";

export default function Podium({ players, highlight }) {
  const list = ranking(players);
  const top = [list[1], list[0], list[2]];
  const winners = list.filter((p) => p.rank === 1);
  return (
    <div className="final">
      {winners.length > 0 && (
        <h2 className="winner">
          {winners.length > 1 && "Égalité ! "}
          <strong>{winners.map((w) => w.name).join(" & ")}</strong>
          {winners.length > 1 ? " remportent la partie" : " remporte la partie"}
        </h2>
      )}
      <div className="podium">
        {top.map((p, i) =>
          p ? (
            <div key={p.pid} className={`step step-${p.rank <= 3 ? p.rank : 3} pos-${i}`}>
              <div className="step-name">{p.name}</div>
              <div className="step-score">{p.score} pt{p.score > 1 ? "s" : ""}</div>
              <div className="step-block">{p.rank}</div>
            </div>
          ) : <div key={"empty" + i} className="step empty" />
        )}
      </div>
      <ol className="ranking">
        {list.map((p) => (
          <li key={p.pid} className={p.pid === highlight ? "me" : ""}>
            <span className="r-rank">{p.rank}</span>
            <span className="r-name">{p.name}</span>
            <span className="r-score">{p.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
