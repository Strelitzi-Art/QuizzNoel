import { useMemo } from "react";

/** Décor de Noël en arrière-plan : neige fine, sapin doré, boules suspendues, pain d'épice. */
export default function Decor() {
  const flakes = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        size: 2 + Math.random() * 4,
        duration: 14 + Math.random() * 16,
        delay: -Math.random() * 30,
        drift: (Math.random() - 0.5) * 60,
        opacity: 0.25 + Math.random() * 0.45,
      })),
    []
  );

  return (
    <div className="decor" aria-hidden="true">
      <div className="snow">
        {flakes.map((f) => (
          <span
            key={f.id}
            style={{
              left: f.left + "%", width: f.size, height: f.size, opacity: f.opacity,
              animationDuration: f.duration + "s", animationDelay: f.delay + "s", "--drift": f.drift + "px",
            }}
          />
        ))}
      </div>

      <Bauble className="bauble b1" color="red" string={70} />
      <Bauble className="bauble b2" color="gold" string={120} />
      <Bauble className="bauble b3" color="red" string={40} />
      <Bauble className="bauble b4" color="gold" string={90} />

      <Tree className="deco-tree" />
      <Gingerbread className="deco-ginger" />
    </div>
  );
}

function Bauble({ className, color, string }) {
  const id = "bg-" + className.replace(/\s/g, "-");
  const [c1, c2, c3] = color === "gold" ? ["#fff1c4", "#e2b864", "#8a5a1e"] : ["#ff8a80", "#c0182a", "#4a0610"];
  return (
    <svg className={className} viewBox={`0 0 60 ${string + 70}`} width="60" height={string + 70}>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={c1} />
          <stop offset="0.45" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </radialGradient>
      </defs>
      <line x1="30" y1="0" x2="30" y2={string + 6} stroke="#e2b864" strokeWidth="1.2" opacity="0.7" />
      <rect x="23" y={string + 4} width="14" height="9" rx="2" fill="#e2b864" />
      <circle cx="30" cy={string + 36} r="24" fill={`url(#${id})`} />
      <path d={`M14 ${string + 36} Q30 ${string + 28} 46 ${string + 36}`} stroke="#f7dd9e" strokeWidth="1.2" fill="none" opacity="0.6" />
      <path d={`M14 ${string + 42} Q30 ${string + 50} 46 ${string + 42}`} stroke="#f7dd9e" strokeWidth="1.2" fill="none" opacity="0.6" />
      <ellipse cx="22" cy={string + 26} rx="6" ry="4" fill="#fff" opacity="0.35" transform={`rotate(-30 22 ${string + 26})`} />
    </svg>
  );
}

function Tree({ className }) {
  return (
    <svg className={className} viewBox="0 0 200 270">
      <g fill="none" stroke="#e2b864" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M100 38 L62 100 H82 L44 162 H68 L28 228 H172 L132 162 H156 L118 100 H138 Z" />
        <path d="M90 228 V256 H110 V228" />
      </g>
      {/* Guirlandes */}
      <g fill="none" stroke="#f7dd9e" strokeWidth="1.2" strokeDasharray="2 5" strokeLinecap="round" opacity="0.8">
        <path d="M74 96 Q102 112 128 92" />
        <path d="M58 156 Q100 178 144 152" />
        <path d="M42 220 Q100 246 160 216" />
      </g>
      {/* Boules */}
      <g>
        <circle cx="88" cy="104" r="4.5" fill="#c0182a" />
        <circle cx="118" cy="100" r="4" fill="#e2b864" />
        <circle cx="76" cy="164" r="4.5" fill="#e2b864" />
        <circle cx="104" cy="170" r="5" fill="#c0182a" />
        <circle cx="134" cy="160" r="4" fill="#f7dd9e" />
        <circle cx="62" cy="228" r="5" fill="#c0182a" />
        <circle cx="96" cy="238" r="4.5" fill="#e2b864" />
        <circle cx="132" cy="232" r="5" fill="#c0182a" />
      </g>
      {/* Étoile */}
      <path
        className="tree-star"
        d="M100 10 L106 26 L123 26 L109 36 L114 52 L100 42 L86 52 L91 36 L77 26 L94 26 Z"
        fill="#f7dd9e" stroke="#e2b864" strokeWidth="1"
      />
    </svg>
  );
}

function Gingerbread({ className }) {
  const dough = "#b8743a";
  const edge = "#7a451c";
  const icing = "#fff8ee";
  return (
    <svg className={className} viewBox="0 0 140 170">
      {/* Contour */}
      <g stroke={edge} strokeLinecap="round" fill={edge}>
        <line x1="70" y1="70" x2="22" y2="88" strokeWidth="32" />
        <line x1="70" y1="70" x2="118" y2="88" strokeWidth="32" />
        <line x1="62" y1="110" x2="40" y2="152" strokeWidth="34" />
        <line x1="78" y1="110" x2="100" y2="152" strokeWidth="34" />
        <rect x="44" y="56" width="52" height="66" rx="22" strokeWidth="4" />
        <circle cx="70" cy="36" r="27" />
      </g>
      {/* Pâte */}
      <g stroke={dough} strokeLinecap="round" fill={dough}>
        <line x1="70" y1="70" x2="22" y2="88" strokeWidth="26" />
        <line x1="70" y1="70" x2="118" y2="88" strokeWidth="26" />
        <line x1="62" y1="110" x2="40" y2="152" strokeWidth="28" />
        <line x1="78" y1="110" x2="100" y2="152" strokeWidth="28" />
        <rect x="46" y="58" width="48" height="62" rx="20" strokeWidth="0" />
        <circle cx="70" cy="36" r="24" strokeWidth="0" />
      </g>
      {/* Glaçage */}
      <g fill="none" stroke={icing} strokeWidth="2.6" strokeLinecap="round">
        <path d="M16 80 q4 5 0 10 q-4 5 0 10" />
        <path d="M124 80 q-4 5 0 10 q4 5 0 10" />
        <path d="M30 150 q5 -4 10 0 q5 4 10 0" />
        <path d="M90 150 q5 -4 10 0 q5 4 10 0" />
        <path d="M60 44 q10 8 20 0" />
      </g>
      <g fill={icing}>
        <circle cx="61" cy="31" r="3.2" />
        <circle cx="79" cy="31" r="3.2" />
      </g>
      {/* Boutons */}
      <circle cx="70" cy="74" r="4.5" fill="#c0182a" />
      <circle cx="70" cy="90" r="4.5" fill="#e2b864" />
      <circle cx="70" cy="106" r="4.5" fill="#c0182a" />
      {/* Nœud papillon */}
      <path d="M70 60 l-11 -6 v12 z M70 60 l11 -6 v12 z" fill="#c0182a" />
      <circle cx="70" cy="60" r="3" fill="#8a0d1a" />
    </svg>
  );
}
