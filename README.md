# Markspot

Tu marques un endroit d'une page web et tu y laisses une note. Claude Code lit la note, corrige le code, vérifie dans le navigateur et répond sur la page.

Tout reste sur ton poste : aucune donnée envoyée ailleurs, aucune télémétrie.

## État

Version 0.1, en construction. La boucle complète marche : tu annotes dans Chrome ou Brave, Claude Code lit la note avec ses deux images, corrige, puis la résout, et la pastille passe à « réglée » avec sa réponse. L'installation sous Windows et macOS n'a pas encore été essayée sur une vraie machine.

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
3. Tu peux dessiner sur la capture (flèche, rectangle, stylo) pour montrer précisément ce qui cloche.
4. Dans Claude Code, tu demandes « règle mes annotations ». Claude lit chaque note avec ses images, trouve le fichier source, corrige et vérifie.
5. Sur la page, la pastille passe à « réglée » et affiche la réponse de Claude.

Pendant le mode annotation, le menu en haut à droite liste les notes de la page : un clic va à la note, « Modifier » change un commentaire, et « Effacer les notes réglées » retire celles que Claude a déjà réglées.

Trois pièces font le travail :

- une extension Chrome (Manifest V3) ;
- un programme local, `markspot host`, que Chrome lance lui-même par native messaging. Il est le seul à écrire les annotations. Il n'ouvre aucun port réseau ;
- un serveur MCP, `markspot mcp`, que chaque session Claude Code lance pour lire et résoudre les annotations.

Les annotations sont des fichiers JSON et PNG dans `~/.local/share/markspot`.

## Installer

Markspot marche sous Windows, macOS et Linux, avec Chrome et Brave. Il faut Node 22.18 ou plus récent et Claude Code.

```sh
git clone https://github.com/adryserage/Markspot
cd Markspot
npm install
npm run build
node dist/cli.js install
```

Ensuite, dans Chrome ou Brave : ouvre `chrome://extensions` (ou `brave://extensions`), active le mode développeur, clique sur « Charger l'extension non empaquetée » et choisis le dossier `extension/` du dépôt. Ouvre une page et appuie sur Alt+C : l'extension se connecte au programme local. `node dist/cli.js doctor` vérifie le tout.

`install` fait, dans l'ordre :

1. le réglage (`config.json`) ;
2. le lanceur du programme local, avec le chemin complet de Node ;
3. la déclaration du programme local pour chaque navigateur installé : un fichier dans le dossier `NativeMessagingHosts` du navigateur sous macOS et Linux, une clé de registre sous Windows (Chrome et Brave la partagent) ;
4. le serveur MCP dans Claude Code (`claude mcp add --scope user markspot`) ;
5. le skill « règle mes annotations » (lien dans `~/.claude/skills/markspot`).

On peut le relancer : une étape déjà faite n'est pas refaite. `uninstall` défait chaque étape.

Options :

- `--browser chrome`, `--browser brave` ou `--browser all` (par défaut) ;
- `--chrome-profile <dossier>` pour un Chrome lancé avec `--user-data-dir` ;
- `--cdp http://127.0.0.1:9222` pour un Chrome lancé avec un port de débogage : `install` y charge alors l'extension tout seul.

Les notes sont rangées dans `%LOCALAPPDATA%\markspot` sous Windows, `~/Library/Application Support/markspot` sous macOS et `~/.local/share/markspot` sous Linux.

## Ajouter un navigateur

Les navigateurs basés sur Chromium (Edge, Vivaldi, Arc…) se déclarent dans `src/cli/browsers.ts` : une entrée qui dit où le navigateur cherche le programme local sur chaque système. `install`, `uninstall` et `doctor` la prennent d'eux-mêmes. Ajoute son test dans `tests/unit/browsers.test.ts`.

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

Apache 2.0. Voir les fichiers LICENSE et NOTICE (les polices Atkinson Hyperlegible sont sous licence SIL OFL 1.1).
