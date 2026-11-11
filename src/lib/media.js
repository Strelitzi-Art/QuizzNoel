// Lecture des extraits du blind test : vidéo YouTube (son seul, vidéo cachée) ou fichier audio.
import { BASE } from "./utils.js";

/* ---------------- Liens YouTube ---------------- */

const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|music\.youtube\.com\/watch\?(?:[^#]*&)?v=)([A-Za-z0-9_-]{11})/;

/** Renvoie l'identifiant de la vidéo YouTube, ou null */
export function youtubeId(link) {
  const s = String(link || "").trim();
  const m = s.match(YT_RE);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

/** Temps de départ contenu dans le lien (?t=90, ?t=1m30s, &start=90), en secondes */
export function youtubeStart(link) {
  const m = String(link || "").match(/[?&#](?:t|start)=([0-9hms]+)/);
  if (!m) return null;
  const v = m[1];
  if (/^\d+s?$/.test(v)) return parseInt(v, 10);
  const h = /(\d+)h/.exec(v), mi = /(\d+)m/.exec(v), se = /(\d+)s/.exec(v);
  return (h ? +h[1] * 3600 : 0) + (mi ? +mi[1] * 60 : 0) + (se ? +se[1] : 0);
}

export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const YT_ERRORS = {
  2: "Lien YouTube invalide",
  5: "Cette vidéo ne peut pas être lue ici",
  100: "Vidéo YouTube introuvable ou privée",
  101: "Le propriétaire de cette vidéo interdit sa lecture hors de YouTube : choisis une autre version (lyrics, audio…)",
  150: "Le propriétaire de cette vidéo interdit sa lecture hors de YouTube : choisis une autre version (lyrics, audio…)",
};

let ytReady = null;
function loadYouTubeApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytReady = null; reject(new Error("Impossible de charger YouTube (connexion ?)")); };
    document.head.appendChild(s);
  });
  return ytReady;
}

let ytPlayerPromise = null;
let ytErrorHandler = null;
function getYouTubePlayer() {
  if (ytPlayerPromise) return ytPlayerPromise;
  ytPlayerPromise = loadYouTubeApi().then((YT) => new Promise((resolve) => {
    // Lecteur hors de la vue : on n'entend que le son, la vidéo ne révèle pas la réponse
    const holder = document.createElement("div");
    holder.className = "yt-holder";
    holder.setAttribute("aria-hidden", "true");
    const el = document.createElement("div");
    holder.appendChild(el);
    document.body.appendChild(holder);
    const p = new YT.Player(el, {
      width: 320, height: 180,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => resolve(p),
        onError: (e) => ytErrorHandler?.(YT_ERRORS[e.data] || `Erreur YouTube (${e.data})`),
      },
    });
  }));
  ytPlayerPromise.catch(() => { ytPlayerPromise = null; });
  return ytPlayerPromise;
}

/* ---------------- Lecteur unifié ---------------- */

/**
 * new TrackPlayer({ onUpdate({ playing, t, err }), onLimit() })
 *  play(track, from, limit) : joue `track.link` à partir de `from` secondes et s'arrête à `limit` (null = sans fin)
 */
export class TrackPlayer {
  constructor({ onUpdate, onLimit } = {}) {
    this.onUpdate = onUpdate;
    this.onLimit = onLimit;
    this.limit = null;
    this.link = null;
    this.kind = null;      // "yt" | "audio"
    this.audio = null;
    this.yt = null;
    this.state = { playing: false, t: 0, err: "", loading: false };
    this.token = 0;
    this.timer = setInterval(() => this.tick(), 200);
  }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.onUpdate?.(this.state);
  }

  get currentTime() {
    if (this.kind === "yt" && this.yt) return this.yt.getCurrentTime?.() || 0;
    if (this.kind === "audio" && this.audio) return this.audio.currentTime;
    return 0;
  }
  get playing() {
    if (this.kind === "yt" && this.yt) return this.yt.getPlayerState?.() === 1;
    if (this.kind === "audio" && this.audio) return !this.audio.paused;
    return false;
  }

  tick() {
    if (!this.kind) return;
    const t = this.currentTime;
    const playing = this.playing;
    if (this.limit != null && t >= this.limit && playing) {
      this.pause();
      this.onLimit?.();
    }
    if (playing !== this.state.playing || Math.abs(t - this.state.t) > 0.1) this.emit({ playing: this.playing, t });
  }

  async play(track, from = 0, limit = null) {
    const token = ++this.token;
    this.limit = limit;
    const link = String(track.link || "").trim();
    const id = youtubeId(link);
    this.emit({ err: "", loading: true });
    try {
      if (id) {
        this.stopAudio();
        this.kind = "yt";
        ytErrorHandler = (msg) => { if (token === this.token) this.emit({ err: msg, loading: false, playing: false }); };
        const p = await getYouTubePlayer();
        if (token !== this.token) return;
        this.yt = p;
        if (this.link !== link) p.loadVideoById({ videoId: id, startSeconds: from });
        else { p.seekTo(from, true); p.playVideo(); }
      } else {
        this.yt?.pauseVideo?.();
        this.kind = "audio";
        if (!this.audio) {
          this.audio = new Audio();
          this.audio.addEventListener("error", () => this.emit({ err: `Fichier audio introuvable : ${this.link}`, playing: false, loading: false }));
        }
        const a = this.audio;
        if (this.link !== link) a.src = /^https?:\/\//i.test(link) ? link : `${BASE}audio/${link.split("/").map(encodeURIComponent).join("/")}`;
        const go = () => { a.currentTime = from; a.play().catch((e) => this.emit({ err: "Lecture impossible : " + e.message })); };
        if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
      }
      this.link = link;
      this.emit({ loading: false });
    } catch (e) {
      if (token === this.token) this.emit({ err: e.message, loading: false });
    }
  }

  pause() {
    if (this.kind === "yt") this.yt?.pauseVideo?.();
    if (this.kind === "audio") this.audio?.pause();
  }
  /** Reprend la lecture ; renvoie false si l'extrait est déjà terminé */
  resume() {
    if (this.limit != null && this.currentTime >= this.limit - 0.05) return false;
    if (this.kind === "yt") this.yt?.playVideo?.();
    if (this.kind === "audio") this.audio?.play().catch(() => {});
    return true;
  }
  /** Lecture libre (après la réponse : on écoute la suite) */
  playFull() {
    this.limit = null;
    if (this.kind === "yt") this.yt?.playVideo?.();
    if (this.kind === "audio") this.audio?.play().catch(() => {});
  }
  isLoaded(track) { return !!this.kind && this.link === String(track?.link || "").trim(); }
  stopAudio() { this.audio?.pause(); }
  stop() { this.limit = null; this.pause(); }
  destroy() { clearInterval(this.timer); this.stop(); }
}
