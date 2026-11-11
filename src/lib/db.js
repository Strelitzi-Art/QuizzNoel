// Couche d'accès aux données : Firebase Realtime Database, ou mode démo (localStorage).
// API commune : get, set, update, remove, on(path, cb) -> unsubscribe, now()
import { useEffect, useState } from "react";

let db = null;
export const getDB = () => db;

export async function initDB(fbConfig) {
  db = fbConfig && fbConfig.databaseURL && fbConfig.apiKey ? await firebaseDB(fbConfig) : localDB();
  return db;
}

/** Abonnement temps réel : undefined = en chargement, null = vide */
export function useDb(path) {
  const [state, setState] = useState({ path, value: undefined });
  useEffect(() => {
    if (!path) return;
    return db.on(path, (v) => setState({ path, value: v }));
  }, [path]);
  if (!path) return undefined;
  return state.path === path ? state.value : undefined;
}

async function firebaseDB(cfg) {
  const { initializeApp } = await import("firebase/app");
  const D = await import("firebase/database");
  const app = initializeApp(cfg);
  const fdb = D.getDatabase(app);
  let offset = 0;
  D.onValue(D.ref(fdb, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
  const r = (p) => D.ref(fdb, p);
  return {
    kind: "firebase",
    get: async (p) => (await D.get(r(p))).val(),
    set: (p, v) => D.set(r(p), v),
    update: (p, obj) => D.update(r(p), obj),
    remove: (p) => D.remove(r(p)),
    on: (p, cb) => D.onValue(r(p), (s) => cb(s.val()), (err) => console.error(p, err)),
    now: () => Date.now() + offset,
  };
}

function localDB() {
  const KEY = "quizz-demo-db";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let data = load();
  const listeners = new Set();
  const parts = (p) => String(p).split("/").filter(Boolean);
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  // Imite Firebase : pas de null ni d'objets/tableaux vides
  function prune(o) {
    if (o == null || typeof o !== "object") return o;
    if (Array.isArray(o)) {
      const a = o.map(prune);
      return a.every((x) => x == null) ? null : a;
    }
    for (const k of Object.keys(o)) {
      const v = prune(o[k]);
      if (v == null) delete o[k]; else o[k] = v;
    }
    return Object.keys(o).length ? o : null;
  }
  function getAt(p) {
    let o = data;
    for (const k of parts(p)) {
      if (o == null || typeof o !== "object") return null;
      o = o[k];
    }
    return o === undefined ? null : clone(o);
  }
  function setAt(p, v) {
    const ks = parts(p);
    if (!ks.length) { data = clone(v) || {}; return; }
    let o = data;
    for (let i = 0; i < ks.length - 1; i++) {
      if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {};
      o = o[ks[i]];
    }
    if (v == null) delete o[ks[ks.length - 1]];
    else o[ks[ks.length - 1]] = clone(v);
  }
  function commit() {
    data = prune(data) || {};
    localStorage.setItem(KEY, JSON.stringify(data));
    notify();
  }
  function notify() {
    for (const l of listeners) {
      const v = getAt(l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(v); }
    }
  }
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) { data = load(); notify(); }
  });

  return {
    kind: "demo",
    get: async (p) => getAt(p),
    set: async (p, v) => { setAt(p, v); commit(); },
    update: async (p, obj) => {
      for (const [k, v] of Object.entries(obj)) setAt([...parts(p), ...parts(k)].join("/"), v);
      commit();
    },
    remove: async (p) => { setAt(p, null); commit(); },
    on: (p, cb) => {
      const l = { path: p, cb, last: undefined };
      listeners.add(l);
      queueMicrotask(() => {
        if (!listeners.has(l)) return;
        const v = getAt(p);
        l.last = JSON.stringify(v);
        cb(v);
      });
      return () => listeners.delete(l);
    },
    now: () => Date.now(),
  };
}
