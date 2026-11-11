import { useEffect, useRef, useState } from "react";

const GLYPHS = ["♪", "♫", "♬", "♩", "✦"];
let uid = 0;

/**
 * Animation pendant la musique : un vinyle qui tourne, des notes qui s'envolent,
 * et une explosion de couleur (avec le nom et l'icône du son) à chaque buzz.
 * Cliquer sur le vinyle met en pause / relance la musique.
 */
export default function MusicStage({ playing, round, queue, onToggle, colorOf, iconOf }) {
  const [notes, setNotes] = useState([]);
  const [bursts, setBursts] = useState([]);
  const [scratch, setScratch] = useState(false);
  const seen = useRef(new Set());

  // Notes qui s'envolent tant que la musique joue
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const n = {
        id: ++uid,
        x: (Math.random() - 0.5) * 90,
        drift: (Math.random() - 0.5) * 160,
        glyph: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
        size: 20 + Math.random() * 26,
        dur: 2.6 + Math.random() * 1.8,
        rot: (Math.random() - 0.5) * 60,
      };
      setNotes((list) => [...list.slice(-24), n]);
      setTimeout(() => setNotes((list) => list.filter((x) => x.id !== n.id)), n.dur * 1000);
    }, 380);
    return () => clearInterval(id);
  }, [playing]);

  // Une explosion de couleur pour chaque nouveau buzz
  useEffect(() => {
    const fresh = (queue || []).filter((b) => !seen.current.has(b.pid + ":" + b.n));
    if (!fresh.length) return;
    fresh.forEach((b) => seen.current.add(b.pid + ":" + b.n));
    setScratch(true);
    setTimeout(() => setScratch(false), 450);
    fresh.forEach((b, i) => {
      // Chaque explosion à un endroit différent pour que les noms ne se chevauchent pas
      const slot = (bursts.length + i) % 4;
      const x = [-24, 24, -14, 14][slot] + (Math.random() - 0.5) * 8;
      const y = [-18, 10, 22, -30][slot];
      const burst = { id: ++uid, color: colorOf(b), icon: iconOf(b), name: b.name, delay: i * 300, x, y };
      setTimeout(() => {
        setBursts((list) => [...list, burst]);
        setTimeout(() => setBursts((list) => list.filter((x) => x.id !== burst.id)), 1900);
      }, burst.delay);
    });
  }, [queue]);

  return (
    <div className={"stage" + (playing ? " on" : "") + (scratch ? " scratch" : "")}>
      <div className="stage-glow" />
      <div className="stage-rings"><span /><span /><span /></div>
      <button className="vinyl" onClick={onToggle} title={playing ? "Pause" : "Lecture"}>
        <span className="vinyl-shine" />
        <span className="vinyl-label">
          <span className="vinyl-icon">{playing ? "♫" : "▶"}</span>
          <small>Manche {round}</small>
        </span>
      </button>
      <div className="tonearm" />
      {notes.map((n) => (
        <span
          key={n.id} className="note"
          style={{ left: `calc(50% + ${n.x}%)`, fontSize: n.size, animationDuration: `${n.dur}s`, "--drift": `${n.drift}px`, "--rot": `${n.rot}deg` }}
        >{n.glyph}</span>
      ))}
      {bursts.map((b) => (
        <div key={b.id} className="burst" style={{ "--c": b.color, left: `calc(50% + ${b.x}%)`, top: `calc(50% + ${b.y}%)` }}>
          <span className="burst-ring" />
          {Array.from({ length: 14 }, (_, i) => <span key={i} className="spark" style={{ "--a": `${(360 / 14) * i}deg` }} />)}
          <span className="burst-name">{b.icon} {b.name}</span>
        </div>
      ))}
    </div>
  );
}
