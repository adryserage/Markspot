# Markspot

Tu marques un endroit d'une page web et tu y laisses une note. Claude Code lit la note, corrige le code, vérifie dans le navigateur et répond sur la page.

Tout reste sur ton poste : aucune donnée envoyée ailleurs, aucune télémétrie.

## État

Version 0.1, en construction. La boucle complète marche : tu annotes dans Chrome ou Brave, Claude Code lit la note avec ses deux images, corrige, puis la résout, et la pastille passe à « Réglée » avec sa réponse. Essayé sous Linux (Chrome) et sous Windows (Brave) ; l'installation sous macOS n'a pas encore été essayée sur une vraie machine.

Chaque fonction est décrite dans [docs/fonctions.md](docs/fonctions.md).

## Essayer l'annotation seule

Cette version n’a besoin ni du programme local ni de Claude Code. Elle ne dépend pas du système d’exploitation.

```sh
npm install
node build.mjs --trial ./markspot-essai
```

Dans Chrome, ouvre `chrome://extensions`, active le mode développeur, clique sur « Charger l'extension non empaquetée » et choisis le dossier `markspot-essai`. Sur une page, appuie sur Alt+C ou clique sur l'icône Markspot. Si Alt+C ne fait rien, règle le raccourci dans `chrome://extensions/shortcuts`.

Pour donner tes notes à Claude Code sans le programme local : clic droit sur l'icône Markspot, « Exporter les notes ». Tu obtiens un fichier JSON avec chaque note et ses deux images, à enregistrer là où Claude Code peut le lire.

Pour mettre l'essai à jour, reconstruis le dossier puis clique « Recharger » dans `chrome://extensions`. Ne supprime pas l'extension : ses notes partiraient avec elle.

## Comment ça marche

1. Dans Chrome, tu appuies sur Alt+C, tu cliques sur un élément ou tu traces une zone, puis tu écris ton commentaire.
2. Markspot garde l'adresse, l'élément (sélecteur, texte, styles calculés), la taille de l'écran et deux images : le gros plan de la zone et l'écran entier avec la zone encadrée.
3. La boîte de commentaire s'ouvre sur la capture : tu peux dessiner dessus (flèche, rectangle, stylo) pour montrer précisément ce qui cloche.
4. Dans Claude Code, tu demandes « règle mes annotations ». Claude lit chaque note avec ses images, trouve le fichier source, corrige et vérifie.
5. Sur la page, la pastille passe à « Réglée » et affiche la réponse de Claude.

Pendant le mode annotation, le menu en haut à droite liste les notes de la page, et des boutons express à côté règlent, exportent, envoient à Claude ou effacent en un clic. Le détail est dans [docs/fonctions.md](docs/fonctions.md#le-menu-des-notes).

Une note « En attente » n'a pas encore été reçue par le programme local : c'est le cas de toutes les notes tant que Markspot n'est pas installé sur le poste (version d'essai). Elles partent toutes seules à la première connexion.

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

Ouvre un nouveau terminal pour que la fonction `claude` soit prise. Ensuite, dans Chrome ou Brave : ouvre `chrome://extensions` (ou `brave://extensions`), active le mode développeur, clique sur « Charger l'extension non empaquetée » et choisis le dossier `extension/` du dépôt. Ouvre une page et appuie sur Alt+C : l'extension se connecte au programme local. `node dist/cli.js doctor` vérifie le tout.

`install` fait, dans l'ordre :

1. le réglage (`config.json`) ;
2. le lanceur du programme local, avec le chemin complet de Node ;
3. la déclaration du programme local pour chaque navigateur installé : un fichier dans le dossier `NativeMessagingHosts` du navigateur sous macOS et Linux, une clé de registre sous Windows (Chrome et Brave la partagent) ;
4. la clé qui signe les envois « Envoyer à Claude » (voir « Deux postes ») ;
5. une fonction `claude` dans les fichiers de démarrage de ton shell (`~/.zshrc`, `~/.bashrc`, et le profil PowerShell sous Windows), entre deux lignes `# >>> markspot >>>` et `# <<< markspot <<<` : chaque session Claude Code que tu lances avec `claude` peut écouter Markspot (voir « Envoyer les notes à Claude ») ;
6. le serveur MCP dans Claude Code (`claude mcp add --scope user markspot`) ;
7. le skill « règle mes annotations » (lien dans `~/.claude/skills/markspot`).

On peut le relancer : une étape déjà faite n'est pas refaite. `uninstall` défait chaque étape.

Options :

- `--browser chrome`, `--browser brave` ou `--browser all` (par défaut) ;
- `--chrome-profile <dossier>` pour un Chrome lancé avec `--user-data-dir` ;
- `--cdp http://127.0.0.1:9222` pour un Chrome lancé avec un port de débogage : `install` y charge alors l'extension tout seul.

Les notes sont rangées dans `%LOCALAPPDATA%\markspot` sous Windows, `~/Library/Application Support/markspot` sous macOS et `~/.local/share/markspot` sous Linux.

## Envoyer les notes à Claude

Dans la page, le bouton « Envoyer à Claude » envoie les notes ouvertes à une session Claude Code. La liste « Envoyer à » montre les sessions qui écoutent, avec le nom de leur projet (le nom du dossier de la session). Le choix est gardé par site, et « Rafraîchir » relit la liste. Un envoi attend 24 heures que la session choisie écoute.

Une session écoute de deux façons.

### Mode écoute (par défaut)

Dis « écoute mes annotations » à la session. Claude lance `markspot listen --name <projet>` en tâche de fond : l'attente ne coûte rien, et la commande se termine quand des notes arrivent. Claude les règle, puis relance l'écoute. Il faut le redire dans chaque nouvelle session. Si Claude attend avec l'outil `markspot_wait_for_annotations` plutôt qu'avec la commande, la session apparaît aussi dans « Envoyer à » : pendant l'attente et 10 minutes après.

### Réveil automatique (aperçu de recherche)

Après `install`, rien à retenir : quand tu lances `claude` dans un terminal, Markspot demande « Markspot écoute cette session ? [O/n] ». Entrée ou rien pendant 5 secondes : oui. `n` lance Claude sans Markspot. Si une session écoute déjà ce projet (même nom de dossier) sur ce poste, la question ne vient pas et la nouvelle session démarre sans Markspot. `claude -p`, `claude mcp …`, `claude --version` et les scripts ne sont pas touchés. Tes options passent telles quelles, ton mode de permission compris. Pour lancer Claude sans cette fonction : `command claude` (sh, zsh) ; `install --no-shell` ne l'ajoute pas. Fish et cmd.exe ne sont pas pris.

Tu peux aussi lancer Claude Code avec `markspot claude` au lieu de `claude` (sous Windows : `%LOCALAPPDATA%\markspot\bin\markspot.bat claude` ; sous Linux : `~/.local/share/markspot/bin/markspot claude`). Les options suivantes passent à `claude`. Comme la session se réveille sans toi, `markspot claude` la lance avec `--permission-mode default` (Claude demande avant chaque commande), sauf si tu choisis toi-même un mode (`--permission-mode` ou `--dangerously-skip-permissions`). La session apparaît alors d'elle-même dans « Envoyer à », même inactive, et se réveille quand tu envoies des notes, sans `markspot listen`.

Cette commande utilise les canaux de Claude Code, encore en aperçu de recherche. Pour un serveur qui n'est pas un plugin approuvé par Anthropic, Claude Code ne les ouvre qu'avec le drapeau `--dangerously-load-development-channels server:markspot`, que `markspot claude` ajoute pour toi :

- au lancement, Claude Code affiche un avertissement et demande de confirmer « I am using this for local development » ;
- le drapeau est prévu pour le développement : sa forme peut changer d'une version de Claude Code à l'autre ;
- la voie normale, `--channels`, n'accepte que les plugins approuvés par Anthropic. Markspot ne l'est pas, donc le mode écoute reste le mode par défaut ;
- il faut une session interactive (pas `claude -p`) et une connexion claude.ai ou une clé de la Console ; dans une organisation Team ou Enterprise, un administrateur doit activer les canaux.

Le message poussé dans la session contient seulement le numéro, l'identifiant et le commentaire de chaque note. Claude lit la page et les images avec `markspot_get_annotation`, comme dans le mode écoute.

Claude Code ne confirme pas la réception : l'envoi reste donc en attente jusqu'à ce que Claude ouvre une des notes. Si rien ne se passe pendant 2 minutes (avertissement refusé, canaux désactivés par l'administrateur), l'envoi revient dans la file et la session disparaît de « Envoyer à » jusqu'à son prochain appel d'outil. Dis alors « écoute mes annotations » à la session : `markspot listen` prendra l'envoi.

## Deux postes, un seul dossier de notes

Pour annoter sur un poste et laisser Claude Code régler les notes depuis un autre, les deux lisent le même dossier de notes, partagé sur le réseau. Partage seulement ce dossier (par exemple un partage Samba `markspot-notes` dont le chemin est `~/.local/share/markspot`). Sur le poste qui ne garde pas le dossier, installe avec `--data-dir` et un chemin absolu vers le partage, par exemple sous Windows :

```sh
node dist/cli.js install --browser all --data-dir \\serveur\markspot-notes
```

Le lanceur et la déclaration du programme local restent sur le poste ; seules les notes passent par le partage.

Les deux postes signent leurs envois « Envoyer à Claude » avec la même clé : une session n'accepte que les envois signés et datés de moins de 25 heures, et jamais deux fois le même, pour qu'un fichier déposé ou recopié sur le partage ne puisse pas la réveiller. `install` crée la clé sur le premier poste. Sur le second, recopie-la une fois :

1. sur le premier poste, `markspot key` affiche la clé ; enregistre-la dans un fichier (par exemple sur une clé USB) ;
2. sur le second, `markspot install --key-file <ce fichier>`, puis supprime le fichier.

La clé est rangée hors du dossier des notes (`~/.config/markspot/dispatch.key` sous Linux, `%LOCALAPPDATA%\markspot-key\dispatch.key` sous Windows). Partage seulement le dossier des notes, pas tout ton dossier personnel : sinon la clé passe aussi par le partage, et une personne qui peut y écrire peut fabriquer un envoi.

## Ajouter un navigateur

Les navigateurs basés sur Chromium (Edge, Vivaldi, Arc…) se déclarent dans `src/cli/browsers.ts` : une entrée qui dit où le navigateur cherche le programme local sur chaque système. `install`, `uninstall` et `doctor` la prennent d'eux-mêmes. Ajoute son test dans `tests/unit/browsers.test.ts`.

## Sécurité

- Aucun processus n'écoute sur le réseau. Chrome ne laisse que l'extension Markspot, reconnue par son identifiant fixe, parler à l'hôte.
- Sous macOS et Linux, les fichiers sont créés avec les droits 0600 et les dossiers avec 0700. Sur un partage réseau, ce sont les droits du partage qui comptent : toute personne qui peut y écrire peut y déposer une note, que Claude lira comme une demande à évaluer.
- Sur un site en développement (Vue, Svelte, React), la note garde le nom du composant et le chemin de son fichier source tel que l'outil de build le donne. Ce chemin peut contenir ton nom d'utilisateur ; il reste dans le dossier des notes et dans l'export.
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
