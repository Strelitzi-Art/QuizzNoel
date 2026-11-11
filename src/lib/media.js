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

// Un lecteur YouTube caché par "emplacement" : "main" pour la musique, un par son de buzzer personnalisé.
const ytSlots = new Map();     // emplacement -> Promise<YT.Player>
const ytErrors = new Map();    // emplacement -> fonction d'erreur
const ytStates = new Map();    // emplacement -> fonction appelée à chaque changement d'état
function createYouTubePlayer(slot) {
  if (ytSlots.has(slot)) return ytSlots.get(slot);
  const promise = loadYouTubeApi().then((YT) => new Promise((resolve) => {
    // Lecteur hors de la vue : on n'entend que le son, la vidéo ne révèle pas la réponse
    const holder = document.createElement("div");
    holder.className = "yt-holder";
    holder.dataset.slot = slot;
    holder.setAttribute("aria-hidden", "true");
    const el = document.createElement("div");
    holder.appendChild(el);
    document.body.appendChild(holder);
    const p = new YT.Player(el, {
      width: 320, height: 180,
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: {
        onReady: () => resolve(p),
        onError: (e) => ytErrors.get(slot)?.(YT_ERRORS[e.data] || `Erreur YouTube (${e.data})`),
        onStateChange: (e) => ytStates.get(slot)?.(e.data),
      },
    });
  }));
  promise.catch(() => ytSlots.delete(slot));
  ytSlots.set(slot, promise);
  return promise;
}
const getYouTubePlayer = () => createYouTubePlayer("main");
let ytErrorHandler = null;
ytErrors.set("main", (msg) => ytErrorHandler?.(msg));

/* ---------------- Sons de buzzer personnalisés (extraits YouTube) ---------------- */

/**
 * Banque de sons : chaque son a son propre lecteur, préchargé (en muet) au bon endroit,
 * pour se déclencher sans délai au moment du buzz.
 */
export class SoundBank {
  constructor() { this.items = new Map(); }

  /** Précharge une liste de sons { id, link, start, end } */
  prime(list) {
    return Promise.all((list || []).map((snd) => this.load(snd)));
  }

  load(snd) {
    const id = youtubeId(snd.link);
    if (!id) return Promise.resolve(null);
    const key = snd.id + "|" + id + "|" + snd.start;
    const cur = this.items.get(snd.id);
    if (cur && cur.key === key) return cur.ready;
    const slot = "snd-" + snd.id;
    const item = { key, start: Number(snd.start) || 0, end: Number(snd.end) || (Number(snd.start) || 0) + 3, timer: null, primed: false };
    item.ready = createYouTubePlayer(slot).then((p) => new Promise((resolve) => {
      item.player = p;
      // On lance la vidéo en muet pour qu'elle se charge, puis on la remet au début de l'extrait
      ytStates.set(slot, (state) => {
        if (state === 1 && !item.primed) {
          item.primed = true;
          p.pauseVideo();
          p.seekTo(item.start, true);
          p.unMute();
          resolve(p);
        }
      });
      p.mute();
      p.loadVideoById({ videoId: id, startSeconds: item.start });
      setTimeout(() => resolve(p), 4000); // au pire, on n'attend pas plus
    }));
    this.items.set(snd.id, item);
    return item.ready;
  }

  /** Joue le son (entre son début et sa fin) */
  play(snd) {
    const ready = this.items.get(snd.id);
    if (ready?.player && ready.key.startsWith(snd.id + "|")) return this.start(ready);
    return this.load(snd).then(() => this.start(this.items.get(snd.id)));
  }

  start(item) {
    const p = item?.player;
    if (!p) return;
    clearTimeout(item.timer);
    p.unMute();
    p.setVolume?.(100);
    p.seekTo(item.start, true);
    p.playVideo();
    item.timer = setTimeout(() => p.pauseVideo(), Math.max(0.5, item.end - item.start) * 1000);
  }

  stopAll() {
    for (const it of this.items.values()) { clearTimeout(it.timer); it.player?.pauseVideo?.(); }
  }
}

/* ---------------- Musique de fin (classement), en boucle ---------------- */

export class LoopMusic {
  constructor(slot = "end") { this.slot = slot; this.player = null; this.active = false; this.muted = false; this.volume = 100; }

  async start(music) {
    const id = music ? youtubeId(music.link) : null;
    if (!id) return;
    const start = Number(music.start) || 0;
    this.active = true;
    this.volume = Math.max(0, Math.min(100, Number(music.volume ?? 100)));
    const p = await createYouTubePlayer(this.slot);
    if (!this.active) return;
    this.player = p;
    // À la fin de la vidéo, on repart du début choisi : la musique tourne en boucle
    ytStates.set(this.slot, (state) => { if (state === 0 && this.active) { p.seekTo(start, true); p.playVideo(); } });
    if (this.muted) p.mute(); else p.unMute();
    p.setVolume?.(this.volume);
    p.loadVideoById({ videoId: id, startSeconds: start });
  }

  stop() { this.active = false; this.player?.pauseVideo?.(); }

  /** Coupe ou remet le son : la musique continue de tourner */
  setMuted(m) {
    this.muted = m;
    if (!this.player) return;
    if (m) this.player.mute(); else this.player.unMute();
  }
}

/* ---------------- Bip de secours (généré par le téléphone, jamais bloqué après un toucher) ---------------- */

let beepCtx = null;
/** À appeler pendant un toucher : prépare le son du téléphone */
export function readyBeep() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!beepCtx) beepCtx = new AC();
  if (beepCtx.state === "suspended") beepCtx.resume();
}
export function playBeep() {
  if (!beepCtx) return;
  const now = beepCtx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.5, now + i * 0.12 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
    o.connect(g).connect(beepCtx.destination);
    o.start(now + i * 0.12);
    o.stop(now + i * 0.12 + 0.4);
  });
}

/* ---------------- Son du joueur, sur son téléphone ---------------- */

/**
 * Un seul lecteur YouTube sur le téléphone. Dans le salon d'attente, il est affiché :
 * le joueur le touche une fois pour écouter son son, ce qui autorise ensuite le téléphone
 * à le rejouer au moment du buzz (les navigateurs mobiles bloquent sinon le son).
 */
export class PhoneSound {
  constructor() {
    this.snd = null; this.mode = null; this.player = null; this.audio = null; this.timer = null; this.key = null; this.url = null; this.lastError = "";
    this.activated = false; // YouTube : le joueur a touché ▶ sur la vidéo au moins une fois
    this.listeners = new Set();
    this.wantShow = false;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { this.listeners.forEach((fn) => fn()); }
  /** Le son est-il prêt à être joué au buzz ? (fichier audio : toujours ; YouTube : après un toucher sur la vidéo) */
  get ready() { return this.mode === "audio" || (this.mode === "yt" && this.activated); }

  async setSound(snd) {
    this.snd = snd || null;
    if (!snd) { this.mode = null; return; }
    const id = youtubeId(snd.link);
    if (!id) {
      // Fichier audio (mp3…) : le plus fiable sur téléphone
      this.mode = "audio";
      if (!this.audio) { this.audio = new Audio(); this.audio.preload = "auto"; this.audio.playsInline = true; }
      const link = String(snd.link || "").trim();
      const url = /^https?:\/\//i.test(link) ? link : `${BASE}audio/${link.split("/").map(encodeURIComponent).join("/")}`;
      if (this.url !== url) { this.url = url; this.audio.src = url; this.audio.load(); }
      this.applyShow();
      this.notify();
      return;
    }
    this.mode = "yt";
    ytErrors.set("phone", (msg) => { this.lastError = msg; });
    const p = await createYouTubePlayer("phone");
    this.player = p;
    // L'extrait s'arrête tout seul à sa fin, même si le joueur a touché ▶ directement sur la vidéo
    ytStates.set("phone", (state) => {
      if (state !== 1 || !this.snd || this.mode !== "yt") return;
      // Première lecture : la vidéo a été touchée, le téléphone autorise désormais le son
      if (!this.activated) { this.activated = true; this.lastError = ""; this.applyShow(); this.notify(); }
      const { start, end } = this.snd;
      let t = p.getCurrentTime?.() || start;
      if (t < start - 0.5 || t >= end) { p.seekTo(start, true); t = start; }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { p.pauseVideo(); p.seekTo(start, true); }, Math.max(0.3, end - t) * 1000);
    });
    const key = id + "|" + snd.start;
    if (this.key !== key) { this.key = key; p.cueVideoById({ videoId: id, startSeconds: snd.start }); }
    this.notify();
  }

  /** À appeler pendant un toucher : débloque la lecture du fichier audio pour la suite de la partie */
  unlock() {
    if (this.mode !== "audio" || !this.audio) return;
    const a = this.audio;
    if (!a.paused) return;
    this.unlocking = true;
    a.muted = true;
    const done = () => { a.muted = false; this.unlocking = false; };
    a.play().then(() => {
      // Si une vraie lecture a été demandée entre-temps, on ne l'interrompt pas
      if (!this.wantPlay) { a.pause(); a.currentTime = this.snd?.start || 0; }
      done();
    }).catch(done);
  }

  /**
   * Joue l'extrait : à appeler pendant un toucher du joueur (relâchement du doigt).
   * Renvoie une promesse : true si la lecture a vraiment démarré.
   */
  play() {
    const s = this.snd;
    if (!s) return Promise.resolve(false);
    if (this.mode === "audio") readyBeep();
    clearTimeout(this.timer);
    this.lastError = "";
    const token = (this.playToken = (this.playToken || 0) + 1);
    if (this.mode === "audio" && this.audio) {
      const a = this.audio;
      this.wantPlay = true;
      a.muted = false;
      try { a.currentTime = s.start || 0; } catch { /* pas encore chargé */ }
      this.timer = setTimeout(() => { a.pause(); this.wantPlay = false; }, Math.max(0.3, s.end - s.start) * 1000);
      return a.play().then(() => true, (e) => { this.lastError = "Le téléphone a refusé de lire le fichier (" + e.name + ")"; playBeep(); return false; });
    }
    const p = this.player;
    if (!p) { this.lastError = "Le lecteur YouTube n'est pas encore chargé"; playBeep(); return Promise.resolve(false); }
    // Les téléphones refusent qu'une page lance une vidéo YouTube avec le son,
    // mais acceptent toujours qu'elle la lance en muet. On démarre donc en muet,
    // puis on remet le son dès que la vidéo tourne : pas besoin de toucher la vidéo.
    try { p.mute(); p.seekTo(s.start, true); p.playVideo(); } catch (e) { this.lastError = String(e.message || e); playBeep(); return Promise.resolve(false); }
    return new Promise((resolve) => {
      const t0 = Date.now();
      let unmutedAt = 0;
      const fail = (msg) => {
        if (!this.lastError) this.lastError = msg;
        try { p.pauseVideo(); } catch { /* rien */ }
        playBeep();
        resolve(false);
      };
      const check = () => {
        if (token !== this.playToken) return resolve(true); // un nouvel appui a pris le relais
        const st = p.getPlayerState?.();
        if (this.lastError) return fail(this.lastError);
        if (!unmutedAt) {
          if (st === 1) { p.unMute(); p.setVolume?.(100); unmutedAt = Date.now(); }
          else if ((st !== 3 && Date.now() - t0 > 2500) || Date.now() - t0 > 5000)
            return fail("La vidéo YouTube n'a pas démarré (état du lecteur : " + (st ?? "?") + ")");
        } else if (Date.now() - unmutedAt > 500) {
          if (st === 1 && !p.isMuted?.()) { this.activated = true; return resolve(true); }
          return fail("Le téléphone a coupé la vidéo quand le son a été remis (état du lecteur : " + (st ?? "?") + ")");
        }
        setTimeout(check, 80);
      };
      check();
    });
  }

  /** Le son est-il en train de jouer ? (pour le bouton « Tester mon son ») */
  isPlaying() {
    if (this.mode === "audio") return !!this.audio && !this.audio.paused;
    return this.player?.getPlayerState?.() === 1;
  }

  /** Le petit lecteur YouTube n'est affiché que pour un son YouTube, dans le salon d'attente */
  show(on) { this.wantShow = !!on; this.applyShow(); }
  applyShow() {
    const el = document.querySelector('.yt-holder[data-slot="phone"]');
    if (!el) return;
    el.classList.remove("show"); // la vidéo n'est jamais montrée au joueur
  }
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
