import { useEffect, useState } from "react";
import { BASE } from "../lib/utils.js";

// Images facultatives : déposées dans public/images/ avec le nom indiqué et
// l'une de ces extensions. Si aucun fichier n'existe, rien ne s'affiche.
/** Noms des fichiers attendus dans public/images/ (extension libre : png, webp, jpg, gif) */
export const IMAGES = {
  question: "lepers-question", // quiz : pendant la question, personne n'a encore trouvé
  found: "lepers-trouve",      // quiz : dès qu'un joueur a trouvé
  blindQuestion: "nagui-question", // blind test : pendant le morceau, personne n'a encore trouvé
  blindFound: "nagui-trouve",      // blind test : dès qu'un joueur a trouvé
  quizParty: "lepers-content",     // quiz : lancé avec les confettis au classement final
  blindParty: "nagui-content",     // blind test : lancé avec les confettis au classement final
  nobody: "personne",          // question terminée sans bonne réponse
  ranking: "classement",       // gif sous le classement final
};

const EXTS = ["png", "webp", "jpg", "jpeg", "gif"];
const found = new Map();    // nom -> url trouvée, ou null si absente
const pending = new Map();  // nom -> Promise

function tryLoad(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(true);
    img.onerror = () => res(false);
    img.src = url;
  });
}

/** Cherche le premier fichier existant pour ce nom (une seule fois par nom) */
export function resolveImage(name) {
  if (found.has(name)) return Promise.resolve(found.get(name));
  if (!pending.has(name)) {
    pending.set(name, (async () => {
      for (const ext of EXTS) {
        const url = `${BASE}images/${name}.${ext}`;
        if (await tryLoad(url)) { found.set(name, url); return url; }
      }
      found.set(name, null);
      return null;
    })());
  }
  return pending.get(name);
}

/** Précharge des images pour qu'elles apparaissent sans délai au bon moment */
export const preloadImages = (names) => names.forEach(resolveImage);

export default function OptionalImage({ name, className = "", alt = "" }) {
  const [src, setSrc] = useState(() => found.get(name) ?? null);
  useEffect(() => {
    let alive = true;
    resolveImage(name).then((u) => alive && setSrc(u));
    return () => { alive = false; };
  }, [name]);
  if (!src) return null;
  return (
    <div className={"opt-img " + className}>
      <img key={src} src={src} alt={alt} />
    </div>
  );
}
