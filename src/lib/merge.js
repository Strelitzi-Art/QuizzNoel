// Fusion de configurations : permet à plusieurs personnes de modifier la config en même temps.
// Principe (fusion "à trois") : on compare ma version et celle en ligne à la version de départ.
//  - ce que j'ai modifié ou ajouté est gardé,
//  - ce que les autres ont modifié ou ajouté (et que je n'ai pas touché) est gardé aussi,
//  - une suppression n'efface pas un élément que quelqu'un d'autre vient de modifier.
import { normalizeConfig } from "./quiz.js";

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byId = (list) => new Map((list || []).map((x) => [x.id, x]));

function mergeValue(base, mine, theirs) {
  return same(mine, base) ? theirs : mine;
}

function mergeFields(base = {}, mine = {}, theirs = {}, skip = []) {
  const out = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (skip.includes(k)) continue;
    out[k] = mergeValue(base[k], mine[k], theirs[k]);
  }
  return out;
}

/** Fusion d'une liste d'éléments identifiés par `id` (ordre : le mien, puis les nouveautés des autres) */
function mergeList(base = [], mine = [], theirs = [], mergeItem) {
  const B = byId(base), M = byId(mine), T = byId(theirs);
  const pick = (id) => {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (b && !m) return t && !same(t, b) ? t : null;      // supprimé chez moi (sauf si modifié ailleurs)
    if (b && !t) return m && !same(m, b) ? m : null;      // supprimé ailleurs (sauf si je l'ai modifié)
    if (!b && m && !t) return m;                          // ajouté par moi
    if (!b && t && !m) return t;                          // ajouté par quelqu'un d'autre
    return mergeItem ? mergeItem(b || m, m, t) : mergeValue(b, m, t);
  };
  const out = [];
  const seen = new Set();
  for (const x of [...mine, ...theirs]) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const v = pick(x.id);
    if (v) out.push(v);
  }
  return out;
}

export function mergeConfigs(base, mine, theirs) {
  base = normalizeConfig(base); mine = normalizeConfig(mine); theirs = normalizeConfig(theirs);
  return {
    gamePassword: mergeValue(base.gamePassword, mine.gamePassword, theirs.gamePassword),
    settings: mergeFields(base.settings, mine.settings, theirs.settings),
    categories: mergeList(base.categories, mine.categories, theirs.categories, (b, m, t) => ({
      ...mergeFields(b, m, t, ["questions"]),
      questions: mergeList(b.questions, m.questions, t.questions),
    })),
    sounds: mergeList(base.sounds, mine.sounds, theirs.sounds),
    blind: mine.blind.map((m, i) => {
      const b = base.blind[i], t = theirs.blind[i];
      return { ...mergeFields(b, m, t, ["tracks"]), tracks: mergeList(b.tracks, m.tracks, t.tracks) };
    }),
  };
}
