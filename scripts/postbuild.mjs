// Après le build : duplique index.html pour que toutes les URL fonctionnent sur GitHub Pages
//   /accueil/        -> dist/accueil/index.html
//   /quizz/config/   -> dist/quizz/config/index.html
//   /quizz/<pseudo>/ -> dist/404.html (GitHub Pages sert 404.html pour les chemins inconnus)
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const src = "dist/index.html";
for (const dir of ["dist/accueil", "dist/quizz/config"]) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, `${dir}/index.html`);
}
copyFileSync(src, "dist/404.html");
writeFileSync("dist/.nojekyll", "");
console.log("✓ Routes GitHub Pages générées (accueil, quizz/config, 404)");
