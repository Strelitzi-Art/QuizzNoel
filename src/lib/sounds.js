// Sons de buzzer : tous définis dans la config, à partir d'extraits YouTube.
//  - le son de signal de l'écran du maître du jeu (joué à chaque buzz, uniquement sur cet écran)
//  - la liste des sons proposés aux joueurs (le son choisi sort uniquement du téléphone du joueur)
import { SoundBank, PhoneSound, youtubeId, youtubeStart } from "./media.js";
import { parseTime } from "./quiz.js";

const COLORS = ["#ff7eb6", "#7ee0ff", "#b6ff7e", "#ffb86b", "#d6a6ff", "#ffe36b", "#6bffd0", "#ff8f8f", "#9fb4ff", "#ffc2a8"];
const MAX_CLIP = 8; // secondes

/** Début / fin d'un extrait, en secondes (3 s par défaut, 8 s au maximum) */
function clip(x) {
  const start = parseTime(x.start) ?? youtubeStart(x.link) ?? 0;
  let end = parseTime(x.end) ?? start + 3;
  if (end <= start) end = start + 3;
  return { start, end: Math.min(end, start + MAX_CLIP) };
}

/** Liste des sons proposés aux joueurs, à partir de la config */
export function buildSoundCatalog(cfg) {
  return (cfg.sounds || [])
    .filter((x) => x.name.trim() && youtubeId(x.link))
    .map((x, i) => ({
      id: "c-" + x.id, name: x.name.trim().slice(0, 18), icon: (x.icon || "").trim() || "🎵",
      color: COLORS[i % COLORS.length], link: x.link.trim(), ...clip(x),
    }));
}

/** Extrait YouTube { link, start, end } prêt à jouer (ou null) */
export function buildClip(obj, id) {
  if (!obj || !youtubeId(obj.link)) return null;
  return { id, link: obj.link.trim(), ...clip(obj) };
}
/** Son de signal de l'écran du maître du jeu (ou null s'il n'y en a pas) */
export const buildSignal = (settings) => buildClip(settings?.hostSignal, "signal");

let catalog = [];
/** Liste des sons de la partie en cours (envoyée par l'écran de jeu) */
export function setSoundCatalog(list) { catalog = Array.isArray(list) ? list.filter(Boolean) : []; }
export const getSoundCatalog = () => catalog;
export const soundById = (id) => catalog.find((s) => s.id === id) || null;

/** Premier son libre (null s'il n'y a aucun son dans la config) */
export function firstFreeSound(taken) {
  if (!catalog.length) return null;
  const t = new Set(taken);
  return (catalog.find((s) => !t.has(s.id)) || catalog[Math.floor(Math.random() * catalog.length)]).id;
}

/* ---- Écran du maître du jeu : le son de signal ---- */
let bank = null;
const getBank = () => (bank ||= new SoundBank());
export const primeClip = (c) => { if (c) getBank().prime([c]); };
export const playClip = (c) => { if (c) getBank().play(c); };
export const primeSignal = primeClip;
export const playSignal = playClip;

/* ---- Téléphone du joueur : son propre son ---- */
let phone = null;
export const phoneSound = () => (phone ||= new PhoneSound());
