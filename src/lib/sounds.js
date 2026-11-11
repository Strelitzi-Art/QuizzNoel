// Sons de buzzer : 14 sons intégrés, fabriqués par le navigateur (Web Audio),
// + les sons personnalisés de la config (extraits YouTube).
import { SoundBank, youtubeId, youtubeStart } from "./media.js";
import { parseTime } from "./quiz.js";

export const SOUNDS = [
  { id: "buzzer", name: "Buzzer TV", icon: "📺", color: "#ff6b6b" },
  { id: "cloche", name: "Cloche", icon: "🔔", color: "#f7dd9e" },
  { id: "grelots", name: "Grelots", icon: "🛷", color: "#ffd166" },
  { id: "klaxon", name: "Klaxon", icon: "📯", color: "#ff9f5a" },
  { id: "laser", name: "Laser", icon: "⚡", color: "#7fb4ff" },
  { id: "boing", name: "Boing", icon: "🌀", color: "#c89bff" },
  { id: "dingdong", name: "Ding-dong", icon: "🛎️", color: "#ffe08a" },
  { id: "pouet", name: "Pouet", icon: "🦆", color: "#ffb3c7" },
  { id: "gong", name: "Gong", icon: "🥁", color: "#e5484d" },
  { id: "arcade", name: "Arcade", icon: "👾", color: "#46e0a0" },
  { id: "harpe", name: "Harpe", icon: "🎶", color: "#9fe3ff" },
  { id: "alarme", name: "Alarme", icon: "🚨", color: "#ff5a5a" },
  { id: "fanfare", name: "Fanfare", icon: "🎺", color: "#ffc94a" },
  { id: "bulles", name: "Bulles", icon: "🫧", color: "#8ee6ff" },
  { id: "etoiles", name: "Étoiles", icon: "✨", color: "#fff1c4" },
];
const CUSTOM_COLORS = ["#ff7eb6", "#7ee0ff", "#b6ff7e", "#ffb86b", "#d6a6ff", "#ffe36b", "#6bffd0", "#ff8f8f"];
const MAX_CLIP = 8; // secondes

/** Construit la liste des sons proposés aux joueurs à partir de la config */
export function buildSoundCatalog(cfg) {
  const custom = (cfg.sounds || [])
    .filter((x) => x.name.trim() && youtubeId(x.link))
    .map((x, i) => {
      const start = parseTime(x.start) ?? youtubeStart(x.link) ?? 0;
      let end = parseTime(x.end) ?? start + 3;
      if (end <= start) end = start + 3;
      return {
        id: "c-" + x.id, name: x.name.trim().slice(0, 18), icon: (x.icon || "").trim() || "🎵",
        color: CUSTOM_COLORS[i % CUSTOM_COLORS.length], link: x.link.trim(), start, end: Math.min(end, start + MAX_CLIP),
      };
    });
  return [...custom, ...(cfg.settings?.builtinSounds === false && custom.length ? [] : SOUNDS)];
}

let catalog = SOUNDS;
/** Liste des sons de la partie en cours (envoyée par l'écran de jeu) */
export function setSoundCatalog(list) { catalog = Array.isArray(list) && list.length ? list : SOUNDS; }
export const getSoundCatalog = () => catalog;
export const soundById = (id) => catalog.find((s) => s.id === id) || SOUNDS.find((s) => s.id === id) || null;

let bank = null;
const getBank = () => (bank ||= new SoundBank());
/** Précharge les sons personnalisés (écran du maître du jeu) */
export const primeCustomSounds = (list) => getBank().prime((list || []).filter((x) => x.link));

let ctx = null;
let out = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createDynamicsCompressor();
    const vol = ctx.createGain();
    vol.gain.value = 0.9;
    out.connect(vol).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
/** À appeler lors d'un clic : débloque le son du navigateur pour la suite */
export const unlockSounds = () => ac();

function tone(c, { type = "sine", f, f2, t0 = 0, dur = 0.3, vol = 0.25, attack = 0.005, lp }) {
  const now = c.currentTime + t0;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, now);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  let node = o;
  if (lp) {
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  o.start(now);
  o.stop(now + dur + 0.05);
}

function noise(c, { t0 = 0, dur = 0.1, vol = 0.2, freq = 6000, q = 2 }) {
  const now = c.currentTime + t0;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(now);
}

const NOTE = { C5: 523.25, E5: 659.25, G5: 783.99, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.5 };

const RECIPES = {
  buzzer: (c) => {
    tone(c, { type: "square", f: 110, dur: 0.75, vol: 0.12, lp: 1300, attack: 0.01 });
    tone(c, { type: "sawtooth", f: 116, dur: 0.75, vol: 0.1, lp: 1300, attack: 0.01 });
  },
  cloche: (c) => {
    tone(c, { f: 880, dur: 1.4, vol: 0.3 });
    tone(c, { f: 1778, dur: 0.8, vol: 0.1 });
    tone(c, { f: 2650, dur: 0.5, vol: 0.05 });
  },
  grelots: (c) => {
    for (let i = 0; i < 6; i++) noise(c, { t0: i * 0.07, dur: 0.09, freq: 7000 + (i % 2) * 1500, q: 4, vol: 0.35 });
    tone(c, { f: 2400, dur: 0.4, vol: 0.04 });
  },
  klaxon: (c) => {
    tone(c, { type: "square", f: 349, dur: 0.45, vol: 0.1, lp: 2200 });
    tone(c, { type: "square", f: 440, dur: 0.45, vol: 0.1, lp: 2200 });
  },
  laser: (c) => {
    tone(c, { type: "square", f: 1800, f2: 150, dur: 0.35, vol: 0.08, lp: 3000 });
    tone(c, { f: 1600, f2: 120, dur: 0.35, vol: 0.15 });
  },
  boing: (c) => tone(c, { type: "triangle", f: 140, f2: 620, dur: 0.5, vol: 0.35 }),
  dingdong: (c) => {
    tone(c, { f: NOTE.E6, dur: 0.7, vol: 0.25 });
    tone(c, { f: NOTE.C6, t0: 0.35, dur: 1, vol: 0.25 });
  },
  pouet: (c) => {
    tone(c, { type: "sawtooth", f: 280, f2: 240, dur: 0.18, vol: 0.18, lp: 1400 });
    tone(c, { type: "sawtooth", f: 280, f2: 220, t0: 0.22, dur: 0.25, vol: 0.18, lp: 1400 });
  },
  gong: (c) => {
    tone(c, { f: 98, dur: 2.5, vol: 0.4, attack: 0.01 });
    tone(c, { f: 270, dur: 1.5, vol: 0.12 });
    tone(c, { f: 530, dur: 0.8, vol: 0.06 });
  },
  arcade: (c) => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone(c, { type: "square", f, t0: i * 0.07, dur: 0.1, vol: 0.08 })),
  harpe: (c) => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.B5, NOTE.D6].forEach((f, i) => tone(c, { type: "triangle", f, t0: i * 0.06, dur: 0.9, vol: 0.18 })),
  alarme: (c) => {
    tone(c, { type: "sawtooth", f: 150, dur: 0.6, vol: 0.12, lp: 1800 });
    tone(c, { type: "square", f: 153, dur: 0.6, vol: 0.08, lp: 1800 });
  },
  fanfare: (c) => {
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f) => tone(c, { type: "sawtooth", f, dur: 0.15, vol: 0.07, lp: 2600 }));
    [NOTE.E5, NOTE.G5, NOTE.C6].forEach((f) => tone(c, { type: "sawtooth", f, t0: 0.16, dur: 0.45, vol: 0.07, lp: 2600 }));
  },
  bulles: (c) => [0, 0.1, 0.2].forEach((t0, i) => tone(c, { f: 400 + i * 120, f2: 1300 + i * 200, t0, dur: 0.09, vol: 0.22 })),
  etoiles: (c) => {
    for (let i = 0; i < 8; i++) tone(c, { f: 2000 + Math.random() * 2200, t0: i * 0.05, dur: 0.3, vol: 0.07 });
  },
};

export function playSound(id) {
  const snd = soundById(id);
  if (snd?.link) return getBank().play(snd);
  const c = ac();
  if (!c) return;
  (RECIPES[id] || RECIPES.cloche)(c);
}

/** Premier son libre, en évitant ceux déjà pris */
export function firstFreeSound(taken) {
  const t = new Set(taken);
  return (catalog.find((s) => !t.has(s.id)) || catalog[Math.floor(Math.random() * catalog.length)]).id;
}
