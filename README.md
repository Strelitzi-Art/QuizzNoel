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

## Équipes

Dans la config, coche **Jouer en équipes** et choisis le nombre d'équipes (2 à 6) et leurs noms.
Dans le salon d'attente de l'écran de jeu, clique sur un joueur pour le changer d'équipe, ou sur **Répartir au hasard**.
Les joueurs sans équipe sont répartis automatiquement au lancement, tout comme ceux qui arrivent en cours de partie.
Une bonne réponse rapporte le point à l'équipe, et une seule fois par question : les coéquipiers ne peuvent plus répondre.

## Blind test

Dans le salon d'attente, choisis **Quiz** ou **Blind test** avant de lancer. Les points des deux jeux ne se cumulent pas.

Il y a trois manches, chacune peut être désactivée :
1. **Artiste & titre** ;
2. **Film, série ou jeu vidéo** d'où vient la musique ;
3. **La suite des paroles** : l'extrait se coupe net et il faut trouver la suite.

**Ajouter un morceau :** colle le **lien YouTube**, indique le début et la fin de l'extrait (`45` ou `1:05`), puis la réponse.
Si le lien contient déjà un temps (`?t=90`), il est repris comme début. Pour la manche 3, la « fin » correspond au moment de la coupure.
**▶ Tester** joue l'extrait directement dans la config, et le menu de chaque morceau permet de le **déplacer dans une autre manche**.
Seul le son est joué, la vidéo reste cachée pour ne pas dévoiler la réponse. Certaines vidéos, souvent les clips officiels, interdisent la lecture hors de YouTube : le test te le signale, prends alors une version « lyrics » ou « audio ».
Un lien vers un fichier audio (`https://…/chanson.mp3`) ou un fichier placé dans `public/audio/` fonctionne aussi.

**Vérification des réponses :** quand un joueur buzze et répond à voix haute, le maître du jeu tape ce qu'il a dit (pour la manche 1, deux champs : artiste et titre). Le maître du jeu n'a donc pas besoin de connaître les réponses par cœur.
Trois modes, à choisir dans la config :
- **automatique** (par défaut) : le jeu valide ou refuse tout seul ;
- **le jeu teste, le maître du jeu confirme** : le jeu donne son avis, puis tu cliques sur Valider ou Refuser ;
- **manuel** : uniquement les boutons Bonne / Mauvaise réponse.

Les fautes de frappe sont tolérées : 1 lettre par mot jusqu'à 5 lettres, 2 au-delà (la marge se calcule sur le plus long des deux mots). Un espace oublié ou en trop est aussi toléré, comme « starwars » pour « Star Wars » ou « jai » pour « j'ai ».
Pour les paroles, il faut tous les mots, dans l'ordre, sans mot en trop. Le nombre de mots à trouver s'affiche sous forme de cases sur l'écran et sur les téléphones.
Plusieurs réponses acceptées : sépare-les par `|` (`Star Wars | La Guerre des étoiles`). Dans tous les modes, les petits liens « accepter / refuser » permettent au maître du jeu de trancher lui-même.

**Sons de buzzer :** dans le salon d'attente, chaque joueur (ou chaque équipe) choisit son son sur son téléphone. Chaque son ne peut être pris qu'une fois.
Ceux qui n'ont rien choisi reçoivent un son libre au lancement. Le son retentit sur l'écran du maître du jeu à chaque buzz, avec une explosion de couleur et le nom du joueur.
Il y a 14 sons intégrés, et tu peux créer les tiens dans la config (section **Sons de buzzer**) : un nom, un emoji, un lien YouTube, puis le début et la fin du passage (3 secondes environ, 8 au maximum).
**▶ Tester** permet de l'écouter. Une case permet de ne proposer que tes sons personnalisés.
Sur l'écran de jeu, chaque son personnalisé est préchargé en sourdine, pour partir sans délai au moment du buzz.

**Déroulé :** pendant l'extrait, un vinyle tourne sur l'écran principal (clique dessus pour mettre en pause ou relancer) et chaque joueur a un gros bouton **BUZZ**.
Au premier buzz, la musique se met en pause. Le joueur répond à voix haute et le maître du jeu clique sur **✓ Bonne réponse** (touche `V`) ou **✗ Mauvaise réponse** (touche `X`).
Ceux qui ont buzzé ensuite forment une file, classée par vitesse. Après un refus, c'est au suivant de répondre. Quand la file est vide, l'extrait reprend.
Par défaut, un joueur refusé ne peut plus buzzer sur ce morceau (réglable). Si personne ne trouve : **Révéler la réponse**, puis **Morceau suivant**.

## Remplir la config à plusieurs

Toutes les personnes qui ont le mot de passe de configuration peuvent la modifier en même temps, depuis des ordinateurs différents.
À l'enregistrement, les modifications sont **fusionnées** : les ajouts de chacun sont conservés, et une suppression n'efface pas un élément que quelqu'un d'autre vient de modifier.
Si tu n'as rien en cours, les ajouts des autres apparaissent en direct. Sinon, un message te prévient qu'ils seront fusionnés à l'enregistrement.

## Images personnalisées (facultatif)

Dépose tes fichiers dans `public/images/`. L'extension est libre (png, webp, jpg ou gif). Ils s'affichent automatiquement, et tant qu'un fichier est absent, rien ne s'affiche à sa place.

| Fichier | Quand |
|---|---|
| `lepers-question` | Pendant une question, tant que personne n'a trouvé (à gauche de la question) |
| `lepers-trouve` | Dès qu'un joueur a trouvé |
| `personne` | Question terminée sans bonne réponse |
| `classement` | Sous le classement final (écran principal et portables) |
| `background.jpg` | Fond du site |

Les PNG à fond transparent rendent le mieux pour le présentateur. Pour l'afficher à droite au lieu de la gauche, remplace `order: 0` par `order: 3` dans `.presenter` (`src/styles/host.css`).

## Développement local

```bash
npm install
npm run dev      # http://localhost:5173
```

## Sécurité : ce qu'il faut savoir

Les mots de passe ne sont jamais stockés en clair. Chacun est transformé (SHA-256) en une clé secrète qui sert d'adresse aux données, et les règles Firebase interdisent de lister ces adresses. Sans le mot de passe, on ne peut donc pas trouver la partie ni la config. Les joueurs ne reçoivent pas non plus les bonnes réponses : c'est l'écran du maître du jeu qui les vérifie.

Limite : il n'y a pas de serveur. Un joueur qui a le mot de passe et qui s'y connaît pourrait donc modifier les données de la partie (son score, par exemple) avec les outils du navigateur. C'est largement suffisant pour une soirée ou un stream, mais ce n'est pas fait pour des enjeux sérieux.

Garde **un seul** écran `/accueil/` ouvert pendant une partie, car c'est lui qui compte les points.
