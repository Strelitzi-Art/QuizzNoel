// Logique du quiz : configuration par défaut, vérification des réponses, paquet de questions
import { rid } from "./utils.js";
import { SITE_TITLE } from "../firebaseConfig.js";

export const DEFAULT_SETTINGS = {
  title: SITE_TITLE,
  scoring: true,        // compter les points (classement et vainqueur à la fin)
  mode: "all",          // "all" : tous ceux qui trouvent marquent | "first" : seul le premier marque
  points: 1,            // points par bonne réponse
  firstBonus: 0,        // bonus pour le premier à trouver
  timer: 0,             // secondes par question (0 = pas de chrono)
  attempts: 0,          // essais par question en texte libre (0 = illimité)
  tolerance: true,      // tolère 1–2 fautes de frappe
  shuffle: true,        // mélange les questions
  maxQuestions: 0,      // nombre max de questions (0 = toutes)
  autoReveal: true,     // affiche la bonne réponse quand la question se ferme
  lateJoin: true,       // autorise à rejoindre une partie déjà lancée
  showPassword: true,   // affiche le mot de passe joueurs sur l'écran du maître du jeu
  hideScores: false,    // points masqués au démarrage
  // Équipes
  teams: false,         // jouer en équipes (une bonne réponse = un point pour l'équipe)
  teamCount: 2,         // 2 à 6 équipes
  teamNames: ["Équipe Rouge", "Équipe Or", "Équipe Sapin", "Équipe Neige", "Équipe Étoile", "Équipe Cannelle"],
  // Blind test
  blindLockout: true,   // un joueur refusé ne peut plus buzzer sur ce morceau
  blindShuffle: true,   // mélange les morceaux à l'intérieur de chaque manche
};

export const TEAM_COLORS = ["#e5484d", "#e2b864", "#46a771", "#7fb4ff", "#c89bff", "#ff9f5a"];

/** Les 3 manches du blind test */
export const BLIND_ROUNDS = [
  { kind: "artist", name: "Artiste & titre", prompt: "Trouvez l'artiste et le titre", a1: "Artiste", a2: "Titre" },
  { kind: "source", name: "Film, série ou jeu vidéo", prompt: "De quel film, série ou jeu vient cette musique ?", a1: "Film / série / jeu", a2: "Titre de la chanson (optionnel)" },
  { kind: "lyrics", name: "La suite des paroles", prompt: "Trouvez la suite des paroles", a1: "Suite des paroles", a2: "Artiste – titre (optionnel)" },
];

/** "1:23" -> 83, "45" -> 45, "" -> null */
export function parseTime(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "number") return v;
  const parts = String(v).trim().replace(",", ".").split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
export function formatTime(sec) {
  if (sec == null || sec === "") return "";
  const m = Math.floor(sec / 60), s = Math.round((sec % 60) * 10) / 10;
  return m ? `${m}:${String(s).padStart(2, "0")}` : String(s);
}

export function newTrack() {
  return { id: rid(4), link: "", start: "", end: "", answer: "", answer2: "" };
}

export function isValidTrack(t, kind) {
  const start = parseTime(t.start) ?? 0, end = parseTime(t.end);
  if (!t.link.trim() || !t.answer.trim()) return false;
  if (end != null && end <= start) return false;
  if (kind === "lyrics" && end == null) return false; // il faut savoir où couper
  return true;
}

function blindAnswerText(kind, t) {
  const a = t.answer.trim(), b = (t.answer2 || "").trim();
  if (kind === "artist") return b ? `${a} — ${b}` : a;
  return b ? `${a} (${b})` : a;
}

export function buildBlindDeck(cfg) {
  const s = cfg.settings;
  const deck = [];
  cfg.blind.forEach((round, ri) => {
    if (!round.enabled) return;
    const meta = BLIND_ROUNDS[ri];
    let tracks = round.tracks.filter((t) => isValidTrack(t, meta.kind));
    if (s.blindShuffle) tracks = shuffled(tracks);
    for (const t of tracks) {
      const start = parseTime(t.start) ?? 0;
      const end = parseTime(t.end) ?? start + 20;
      deck.push({
        type: "blind", round: ri + 1, kind: meta.kind, roundName: round.name || meta.name, prompt: meta.prompt,
        link: t.link.trim(), start, end, answerText: blindAnswerText(meta.kind, t),
      });
    }
  });
  return deck;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const toArr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : v && typeof v === "object" ? Object.values(v) : []);

export function newQuestion(type = "text") {
  return { id: rid(4), type, text: "", answers: "", choices: ["", "", "", ""], correct: 0, image: "" };
}

export function normalizeConfig(c) {
  c = c || {};
  return {
    gamePassword: c.gamePassword || "",
    settings: (() => {
      const st = { ...DEFAULT_SETTINGS, ...(c.settings || {}) };
      const names = toArr(st.teamNames);
      st.teamNames = DEFAULT_SETTINGS.teamNames.map((d, i) => names[i] || d);
      st.teamCount = Math.min(6, Math.max(2, Number(st.teamCount) || 2));
      return st;
    })(),
    categories: toArr(c.categories).map((cat) => ({
      id: cat.id || rid(4),
      name: cat.name || "Sans nom",
      enabled: cat.enabled !== false,
      questions: toArr(cat.questions).map((q) => {
        const choices = toArr(q.choices).map(String);
        while (choices.length < 2) choices.push("");
        return {
          id: q.id || rid(4),
          type: q.type === "qcm" ? "qcm" : "text",
          text: q.text || "",
          answers: q.answers || "",
          choices,
          correct: Number(q.correct) || 0,
          image: q.image || "",
        };
      }),
    })),
    blind: BLIND_ROUNDS.map((meta, i) => {
      const r = toArr(c.blind)[i] || {};
      return {
        name: (r.name === "Film ou jeu vidéo" ? "" : r.name) || meta.name,
        enabled: r.enabled !== false,
        tracks: toArr(r.tracks).map((t) => ({
          id: t.id || rid(4), link: t.link || t.file || "", start: t.start ?? "", end: t.end ?? "",
          answer: t.answer || "", answer2: t.answer2 || "",
        })),
      };
    }),
  };
}

export function sampleConfig() {
  return normalizeConfig({
    gamePassword: "",
    categories: [{
      id: rid(4),
      name: "Culture générale (exemple)",
      questions: [
        { type: "text", text: "Quelle est la capitale de l'Australie ?", answers: "Canberra" },
        { type: "text", text: "Combien de pattes a une araignée ?", answers: "8|huit" },
        { type: "qcm", text: "Quelle planète est surnommée la planète rouge ?", choices: ["Vénus", "Mars", "Jupiter", "Saturne"], correct: 1 },
        { type: "text", text: "Qui a peint La Joconde ?", answers: "Léonard de Vinci|De Vinci|Vinci|Leonardo da Vinci" },
        { type: "qcm", text: "En quelle année l'homme a-t-il marché sur la Lune pour la première fois ?", choices: ["1965", "1969", "1972", "1975"], correct: 1 },
      ],
    }],
  });
}

export function isValidQuestion(q) {
  if (!q.text.trim()) return false;
  if (q.type === "qcm") {
    const filled = q.choices.filter((c) => c.trim());
    return filled.length >= 2 && (q.choices[q.correct] || "").trim() !== "";
  }
  return q.answers.split("|").some((a) => a.trim());
}

export function buildDeck(cfg) {
  const s = cfg.settings;
  let deck = [];
  for (const cat of cfg.categories) {
    if (!cat.enabled) continue;
    for (const q of cat.questions) {
      if (!isValidQuestion(q)) continue;
      if (q.type === "qcm") {
        // On retire les choix vides en gardant la bonne réponse
        const good = q.choices[q.correct];
        const choices = q.choices.filter((c) => c.trim());
        deck.push({ type: "qcm", text: q.text, choices, correct: choices.indexOf(good), image: q.image || "", cat: cat.name });
      } else {
        deck.push({ type: "text", text: q.text, answers: q.answers, image: q.image || "", cat: cat.name });
      }
    }
  }
  if (s.shuffle) deck = shuffled(deck);
  if (s.maxQuestions > 0) deck = deck.slice(0, s.maxQuestions);
  return deck;
}

export function answerText(q) {
  if (!q) return "";
  if (q.type === "blind") return q.answerText || "";
  if (q.type === "qcm") return q.choices[q.correct] ?? "";
  return (q.answers || "").split("|").map((a) => a.trim()).filter(Boolean)[0] || "";
}

const ARTICLES = /^(le|la|les|l|un|une|des|du|de|d|the|a|an) /;

export function normalizeAnswer(s) {
  let n = String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe").replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const stripped = n.replace(ARTICLES, "");
  if (stripped) n = stripped;
  return n;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function checkAnswer(q, value, tolerance = true) {
  if (q.type === "qcm") return Number(value) === q.correct;
  const given = normalizeAnswer(value);
  if (!given) return false;
  return (q.answers || "").split("|").some((raw) => {
    const good = normalizeAnswer(raw);
    if (!good) return false;
    if (given === good) return true;
    if (!tolerance || /^\d+$/.test(good)) return false;
    const max = good.length >= 9 ? 2 : good.length >= 5 ? 1 : 0;
    return max > 0 && levenshtein(given, good) <= max;
  });
}

/** Import rapide : "Question ; réponse | variante"  ou QCM : "Question ; *bonne ; mauvaise ; mauvaise" */
export function parseQuickAdd(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 2 || !parts[0]) continue;
    const q = newQuestion();
    q.text = parts[0];
    const rest = parts.slice(1).filter(Boolean);
    const star = rest.findIndex((p) => p.startsWith("*"));
    if (rest.length >= 2 && star >= 0) {
      q.type = "qcm";
      q.choices = rest.map((p) => p.replace(/^\*/, "").trim());
      q.correct = star;
    } else {
      q.answers = rest.join(" | ");
    }
    out.push(q);
  }
  return out;
}
