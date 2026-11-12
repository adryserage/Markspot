# Markspot

Tu marques un endroit d'une page web et tu y laisses une note. Claude Code lit la note, corrige le code, vérifie dans le navigateur et répond sur la page.

Tout reste sur ton poste : aucune donnée envoyée ailleurs, aucune télémétrie.

## État

Version 0.1, en construction. Ce qui marche aujourd'hui :

- le mode annotation dans Chrome : Alt+C, surbrillance, clic sur un élément ou zone tracée, commentaire avec la vignette de la capture, pastilles numérotées ;
- l'installation et le lien entre l'extension et le programme local (`markspot doctor` le vérifie).

Les notes restent pour l'instant dans le navigateur. Le stockage en fichiers, le serveur MCP et le skill arrivent ensuite.

## Essayer l'annotation seule

Cette version n’a besoin ni du programme local ni de Claude Code. Elle ne dépend pas du système d’exploitation.

```sh
npm install
node build.mjs --trial ./markspot-essai
```

Dans Chrome, ouvre `chrome://extensions`, active le mode développeur, clique sur « Charger l'extension non empaquetée » et choisis le dossier `markspot-essai`. Sur une page, appuie sur Alt+C ou clique sur l'icône Markspot. Si Alt+C ne fait rien, règle le raccourci dans `chrome://extensions/shortcuts`.

Pour donner tes notes à Claude Code avant l'arrivée du serveur MCP : clic droit sur l'icône Markspot, « Exporter les notes ». Tu obtiens un fichier JSON avec chaque note et ses deux images, à enregistrer là où Claude Code peut le lire.

Pour mettre l'essai à jour, reconstruis le dossier puis clique « Recharger » dans `chrome://extensions`. Ne supprime pas l'extension : ses notes partiraient avec elle.

## Comment ça marche

1. Dans Chrome, tu appuies sur Alt+C, tu cliques sur un élément ou tu traces une zone, puis tu écris ton commentaire.
2. Markspot garde l'adresse, l'élément (sélecteur, texte, styles calculés), la taille de l'écran et deux images : le gros plan de la zone et l'écran entier avec la zone encadrée.
3. Dans Claude Code, tu demandes « règle mes annotations ». Claude lit chaque note avec ses images, trouve le fichier source, corrige et vérifie.
4. Sur la page, la pastille passe à « réglée » et affiche la réponse de Claude.

Trois pièces font le travail :

- une extension Chrome (Manifest V3) ;
- un programme local, `markspot host`, que Chrome lance lui-même par native messaging. Il est le seul à écrire les annotations. Il n'ouvre aucun port réseau ;
- un serveur MCP, `markspot mcp`, que chaque session Claude Code lance pour lire et résoudre les annotations.

Les annotations sont des fichiers JSON et PNG dans `~/.local/share/markspot`.

## Installer

Il faut Node 22.18 ou plus récent et un Chrome lancé avec un port de débogage (`--remote-debugging-port`).

```sh
git clone https://github.com/adryserage/markspot
cd markspot
npm install
npm run build
node dist/cli.js install --chrome-profile ~/.config/google-chrome --cdp http://127.0.0.1:9222
node dist/cli.js doctor
```

`install` écrit le réglage, le lanceur de l'hôte, la déclaration de l'hôte dans le profil Chrome, puis charge l'extension par le port de débogage. On peut le relancer : une étape déjà faite n'est pas refaite. `uninstall` défait chaque étape.

Si Chrome refuse le chargement par le port de débogage, ouvre `chrome://extensions`, active le mode développeur et charge le dossier `extension/` à la main.

## Sécurité

- Aucun processus n'écoute sur le réseau. Chrome ne laisse que l'extension Markspot, reconnue par son identifiant fixe, parler à l'hôte.
- Les fichiers sont créés avec les droits 0600 et les dossiers avec 0700.
- Les captures ne sont pas encore masquées. Ce qui est affiché à l'écran au moment de la capture (un mot de passe affiché en clair, un jeton) va dans l'image et jusqu'au modèle. La vignette montrée avant l'envoi permet d'annuler.

## Développer

```sh
npm run build       # dist/cli.js et extension/dist/
npm run typecheck   # tsc --noEmit
npm test            # tests unitaires (node --test)
```

La conception est dans [docs/conception.md](docs/conception.md).

## Licence

MIT
