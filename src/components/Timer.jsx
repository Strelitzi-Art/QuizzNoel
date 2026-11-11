import { useEffect, useState } from "react";
import { getDB } from "../lib/db.js";

/** Renvoie les secondes restantes avant endsAt (null si pas de chrono) */
export function useRemaining(endsAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => tick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - getDB().now()) / 1000));
}

export default function Timer({ endsAt, total }) {
  const left = useRemaining(endsAt);
  if (left == null) return null;
  const pct = total ? Math.min(100, (left / total) * 100) : 0;
  return (
    <div className={"timer" + (left <= 5 ? " urgent" : "")}>
      <div className="timer-bar" style={{ width: pct + "%" }} />
      <span>{left}s</span>
    </div>
  );
}
