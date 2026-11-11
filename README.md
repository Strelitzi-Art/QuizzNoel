# Le Grand Quizz

Quiz multijoueur en temps réel (React + CSS, hébergé sur GitHub Pages, synchronisé via Firebase).

| Adresse | Rôle |
|---|---|
| `/` | Les joueurs rejoignent la partie depuis leur portable (pseudo + mot de passe) |
| `/accueil/` | Écran du maître du jeu (à mettre sur la TV) : salon, questions, « Ont trouvé », scores, podium |
| `/quizz/<pseudo>/` | Écran du joueur sur son portable |
| `/quizz/config/` | Catégories, questions et réglages de la prochaine partie |

Sur GitHub Pages, ces chemins sont précédés du nom du repo : `https://<ton-pseudo>.github.io/<repo>/accueil/`.

---

## 1. Créer la base de données Firebase (gratuit, ~5 min)

GitHub Pages ne sert que des fichiers statiques : il faut un service temps réel pour que les portables et l'écran se parlent. Firebase Realtime Database est gratuit pour cet usage.

1. Va sur https://console.firebase.google.com → **Ajouter un projet** (Google Analytics n'est pas nécessaire).
2. Menu **Créer → Realtime Database → Créer une base de données** → région *europe-west1* → démarrer en **mode verrouillé**.
3. Onglet **Règles** : colle le contenu du fichier `database.rules.json` puis **Publier**.
4. Roue dentée → **Paramètres du projet** → section *Vos applications* → icône **`</>`** (Web) → donne un nom → **Enregistrer**.
5. Copie l'objet `firebaseConfig` affiché dans `src/firebaseConfig.js`.
   Vérifie que `databaseURL` est bien rempli (sinon copie l'URL affichée en haut de la page Realtime Database).

> Tant que `databaseURL` est vide, le site tourne en **mode démo** : tout reste dans le navigateur. Pratique pour tester avec plusieurs onglets, mais les portables ne pourront pas se connecter.

## 2. Mettre en ligne sur GitHub Pages

1. Crée un repo sur GitHub (par exemple `quizz`) et pousse ces fichiers sur la branche `main`.
2. Dans le repo : **Settings → Pages → Source : GitHub Actions**.
3. À chaque push, l'action `.github/workflows/deploy.yml` construit le site et le publie (onglet **Actions** pour suivre). Ça prend environ 1 minute.

Le chemin du repo est détecté automatiquement. Si tu utilises un domaine perso, crée une variable `BASE_PATH` = `/` dans **Settings → Secrets and variables → Actions → Variables**.

## 3. Préparer une partie

1. Ouvre `/quizz/config/` et choisis un **mot de passe de configuration**. La première fois, il crée ta config avec une catégorie d'exemple.
2. Renseigne le **mot de passe des joueurs**, coche les catégories à utiliser, ajoute tes questions, puis clique sur **Enregistrer**.
3. Ouvre `/accueil/` sur l'écran principal (même mot de passe que la config). Le QR code, l'adresse et le mot de passe joueurs s'affichent.
4. Les joueurs scannent, entrent pseudo + mot de passe et apparaissent à l'écran → **Lancer la partie**.

### Types de questions
- **Texte libre** : plusieurs réponses acceptées séparées par `|` (ex : `Léonard de Vinci | De Vinci`). Les majuscules, les accents, la ponctuation et les articles (le, la, les…) sont ignorés. En option, 1 à 2 fautes de frappe sont tolérées.
- **QCM** : de 2 à 6 choix, un seul essai par joueur. Après la révélation, l'écran affiche le nombre de votes pour chaque choix.
- **Ajout rapide** : une ligne par question, `Question ; réponse | variante` ou `Question ; *bonne ; mauvaise ; mauvaise`.
- **Import/Export JSON** pour sauvegarder ou partager tes catégories.

### Réglages disponibles
Seul le premier marque ou tous ceux qui trouvent · points par bonne réponse · bonus au premier · chrono · nombre d'essais · nombre de questions · mélange · tolérance aux fautes · révélation automatique de la réponse · arrivée en cours de partie · mot de passe affiché à l'écran · points masqués au départ.

### Pendant la partie (écran maître du jeu)
**Révéler la réponse**, **Clore la question**, **Question suivante**, **Terminer la partie** (podium et classement), **Masquer/Afficher les points** dans la barre du bas. À la fin : **Rejouer avec les mêmes joueurs** ou **Nouvelle partie**. Dans le salon, la croix à côté d'un pseudo retire le joueur.

## Développement local

```bash
npm install
npm run dev      # http://localhost:5173
```

## Sécurité : ce qu'il faut savoir

Les mots de passe ne sont jamais stockés en clair. Chacun est transformé (SHA-256) en une clé secrète qui sert d'adresse aux données, et les règles Firebase interdisent de lister ces adresses. Sans le mot de passe, on ne peut donc pas trouver la partie ni la config. Les joueurs ne reçoivent pas non plus les bonnes réponses : c'est l'écran du maître du jeu qui les vérifie.

Limite : il n'y a pas de serveur. Un joueur qui a le mot de passe et qui s'y connaît pourrait donc modifier les données de la partie (son score, par exemple) avec les outils du navigateur. C'est largement suffisant pour une soirée ou un stream, mais ce n'est pas fait pour des enjeux sérieux.

Garde **un seul** écran `/accueil/` ouvert pendant une partie, car c'est lui qui compte les points.
