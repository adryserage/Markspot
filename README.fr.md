# Markspot

English: [README.md](README.md)

Tu marques un endroit d'une page web et tu y laisses une note. Claude Code lit la note, corrige le code, vérifie le résultat dans le navigateur et répond sur la page, à côté de ta note.

Chaque fonction est décrite dans le [guide des fonctions](docs/fonctions.md).

## État

Version 0.1. Markspot marche avec Chrome et Brave sous Linux et sous Windows. L'installation sous macOS n'a pas encore été essayée sur une vraie machine.

La boucle complète marche : tu annotes dans le navigateur, Claude Code lit la note avec ses deux images, corrige le code, puis résout la note, et la pastille passe à « Réglée » avec la réponse de Claude.

## Installer

Il faut Node 22.18 ou plus récent et Claude Code.

```sh
npm install -g markspot
markspot install
```

`install` ne peut pas charger l'extension dans le navigateur tout seul : il finit par une ligne « to do » qui donne le dossier de l'extension. Ce dossier est `extension`, dans le paquet installé, soit `$(npm root -g)/markspot/extension`. Charge-le une fois :

1. Ouvre `chrome://extensions` (ou `brave://extensions`) et active le mode développeur.
2. Clique sur « Charger l'extension non empaquetée » et choisis ce dossier.
3. Ouvre un nouveau terminal, pour que ton shell prenne la fonction `claude` ajoutée par `install`.
4. Ouvre une page web et appuie sur Alt+C : l'extension se connecte au programme local.
5. Lance `markspot doctor` pour vérifier chaque étape.

Si Alt+C ne fait rien, règle le raccourci dans `chrome://extensions/shortcuts`.

### Depuis les sources

```sh
git clone https://github.com/adryserage/Markspot
cd Markspot
npm install
npm run build
node dist/cli.js install
```

Charge ensuite le dossier `extension/` du dépôt comme plus haut. Depuis un clone, `node dist/cli.js` remplace `markspot` dans toutes les commandes de cette page.

### Ce que fait install

`install` fait, dans l'ordre :

1. Le réglage : il écrit `config.json` avec les options passées.
2. La clé d'envoi : il crée la clé qui signe les envois « Envoyer à Claude » (voir [Deux postes, un seul dossier de notes](#deux-postes-un-seul-dossier-de-notes)). Il ne remplace jamais une clé déjà là.
3. Le lanceur du programme local : un petit script qui lance le programme avec le chemin complet de Node, car un navigateur lancé depuis un menu n'a pas toujours le `PATH` du shell.
4. La commande markspot : un second lanceur, `markspot`, que les sessions Claude Code utilisent pour `markspot listen`.
5. La déclaration du programme local pour chaque navigateur : sous Linux et macOS, un fichier dans le dossier `NativeMessagingHosts` du navigateur (un navigateur absent est sauté) ; sous Windows, une clé de registre que Chrome et Brave partagent.
6. L'extension : avec `--cdp`, `install` la charge lui-même dans ce Chrome. Sinon, cette étape est la ligne « to do » ci-dessus, et elle compte comme faite dès que l'extension s'est connectée au programme local.
7. Le shell : une fonction `claude` dans les fichiers de démarrage de ton shell (`~/.zshrc`, `~/.bashrc`, et sous Windows les profils PowerShell), entre une ligne `# >>> markspot >>>` et une ligne `# <<< markspot <<<`. Chaque session Claude Code lancée avec `claude` peut alors écouter Markspot (voir [Réveil automatique](#réveil-automatique-aperçu-de-recherche)). Fish et cmd.exe ne sont pas pris.
8. Le serveur MCP : `claude mcp add --scope user markspot`.
9. Le skill : un lien de `~/.claude/skills/markspot` vers le skill du paquet.

On peut relancer `install` : une étape déjà faite n'est pas refaite. `markspot uninstall` défait chaque étape, et `markspot doctor` vérifie chacune, puis vérifie qu'on peut écrire dans le dossier des notes.

### Options

- `--browser chrome`, `--browser brave`, `--browser chrome,brave` ou `--browser all` (par défaut).
- `--chrome-profile <dossier>` pour un Chrome lancé avec `--user-data-dir`.
- `--cdp http://127.0.0.1:9222` pour un Chrome lancé avec un port de débogage : `install` y charge l'extension, et `doctor` vérifie l'aller-retour entre l'extension et le programme local.
- `--data-dir <chemin absolu>` pour garder les notes dans un autre dossier, par exemple un partage réseau.
- `--key-file <fichier>` pour reprendre la clé d'envoi de l'autre poste.
- `--no-shell` ne touche pas aux fichiers de démarrage du shell. `--shell` remet la fonction `claude` après un `--no-shell`.

`install` garde ces options dans `config.json` : le prochain `install`, `doctor` ou `uninstall` les reprend.

## Comment ça marche

1. Dans le navigateur, tu appuies sur Alt+C (ou tu cliques sur l'icône Markspot), tu cliques sur un élément ou tu traces une zone, puis tu écris ton commentaire.
2. Markspot garde l'adresse de la page, l'élément (sélecteur, texte visible, attributs utiles, styles calculés), la taille de l'écran et deux images : le gros plan de la zone et l'écran entier avec la zone encadrée.
3. La boîte de commentaire s'ouvre sur la capture : tu peux dessiner dessus (flèche, rectangle, stylo) pour montrer ce qui cloche.
4. Dans Claude Code, tu dis « règle mes annotations ». Claude lit chaque note avec ses images, trouve le fichier source, corrige et vérifie dans le navigateur.
5. Sur la page, la pastille passe à « Réglée » et affiche la réponse de Claude.

Trois pièces font le travail :

- une extension Chrome (Manifest V3) ;
- un programme local, `markspot host`, que le navigateur lance lui-même par native messaging. Il est le seul à écrire les notes, et il n'ouvre aucun port réseau ;
- un serveur MCP, `markspot mcp`, que chaque session Claude Code lance pour lire et résoudre les notes.

Les notes sont des fichiers JSON et PNG dans `~/.local/share/markspot` sous Linux, `~/Library/Application Support/markspot` sous macOS et `%LOCALAPPDATA%\markspot` sous Windows.

Une note reste « En attente » tant que le programme local ne l'a pas reçue, par exemple quand Markspot n'est pas encore installé sur le poste. Les notes en attente partent toutes seules à la prochaine connexion.

## Envoyer les notes à Claude

Dans la page, le bouton « Envoyer à Claude » envoie les notes ouvertes à une session Claude Code. La liste « Envoyer à » montre les sessions qui écoutent, par le nom de leur projet (le nom du dossier de la session). Le choix est gardé par site, et « Rafraîchir » relit la liste. Un envoi attend jusqu'à 24 heures que la session choisie écoute.

Une session écoute de deux façons.

### Mode écoute (par défaut)

Dis « écoute mes annotations » à la session. Claude lance `markspot listen --name <projet>` en tâche de fond. L'attente ne coûte rien, et la commande se termine quand des notes arrivent. Claude les règle, puis relance l'écoute. Il faut le redire dans chaque nouvelle session.

Si Claude attend avec l'outil `markspot_wait_for_annotations` plutôt qu'avec la commande, la session apparaît aussi dans « Envoyer à », pendant l'attente et 10 minutes après.

### Réveil automatique (aperçu de recherche)

Après `install`, rien à retenir. Quand tu lances `claude` dans un terminal, Markspot demande :

```text
Markspot écoute cette session ? [O/n] (oui dans 5 s)
```

Entrée, une autre touche ou rien pendant 5 secondes : oui. `n` lance Claude sans Markspot, et Ctrl+C ne lance rien. La question est en français quand la locale du terminal commence par `fr`, en anglais sinon (« Should Markspot listen to this session? [Y/n] (yes in 5 s) »).

- La question ne vient pas si une session écoute déjà ce projet (même nom de dossier) sur ce poste. La nouvelle session démarre alors sans Markspot.
- `claude -p`, `claude mcp …`, `claude --version` et les scripts ne sont pas touchés.
- Tes options passent telles quelles à `claude`, ton mode de permission compris.
- Pour lancer Claude sans cette fonction : `command claude` (sh, zsh), ou installe avec `--no-shell`.

Tu peux aussi lancer Claude Code avec `markspot claude` au lieu de `claude`. Les options suivantes passent à `claude`. Comme la session se réveille sans toi, `markspot claude` la lance avec `--permission-mode default` (Claude demande avant chaque commande), sauf si tu choisis toi-même un mode avec `--permission-mode` ou `--dangerously-skip-permissions`.

Dans les deux cas, la session apparaît d'elle-même dans « Envoyer à », même inactive, et se réveille quand tu envoies des notes. Elle n'a pas besoin de `markspot listen`.

Cette fonction utilise les canaux de Claude Code, encore en aperçu de recherche. Pour un serveur qui n'est pas un plugin approuvé par Anthropic, Claude Code n'ouvre les canaux qu'avec le drapeau `--dangerously-load-development-channels server:markspot`, que Markspot ajoute pour toi :

- au lancement, Claude Code affiche un avertissement et demande de confirmer « I am using this for local development » ;
- le drapeau est prévu pour le développement : sa forme peut changer d'une version de Claude Code à l'autre ;
- la voie normale, `--channels`, n'accepte que les plugins approuvés par Anthropic. Markspot ne l'est pas, donc le mode écoute reste le mode par défaut ;
- il faut une session interactive (pas `claude -p`) et une connexion claude.ai ou une clé de la Console. Dans une organisation Team ou Enterprise, un administrateur doit activer les canaux.

Le message poussé dans la session contient seulement le numéro, l'identifiant et le commentaire de chaque note. Claude lit les données de la page et les images avec `markspot_get_annotation`, comme dans le mode écoute.

Claude Code ne confirme pas la réception : l'envoi reste donc en attente jusqu'à ce que Claude ouvre une de ses notes. Si rien ne se passe pendant 2 minutes (avertissement refusé, canaux désactivés par l'administrateur), l'envoi revient dans la file et la session disparaît de « Envoyer à » jusqu'à son prochain appel d'outil. Dis alors « écoute mes annotations » à la session : `markspot listen` prendra l'envoi.

## Langue

L'extension est en anglais par défaut, et aussi en français. Clic droit sur l'icône Markspot dans la barre d'outils, puis « Langue » (« Language » en anglais) : « Auto (langue du navigateur) » prend le français si le navigateur est en français et l'anglais sinon, « English » et « Français » fixent la langue. Le choix est gardé dans le navigateur.

La question que pose `claude` au lancement suit la locale du terminal (`LC_ALL`, `LC_MESSAGES`, puis `LANG`).

## Deux postes, un seul dossier de notes

Pour annoter sur un poste et laisser Claude Code régler les notes depuis un autre, les deux lisent le même dossier de notes, partagé sur le réseau. Partage seulement ce dossier (par exemple un partage Samba `markspot-notes` dont le chemin est `~/.local/share/markspot`). Sur le poste qui ne garde pas le dossier, installe avec `--data-dir` et un chemin absolu vers le partage, par exemple sous Windows :

```sh
markspot install --data-dir \\serveur\markspot-notes
```

Les lanceurs et la déclaration du programme local restent sur chaque poste. Seules les notes passent par le partage.

Les deux postes signent leurs envois « Envoyer à Claude » avec la même clé. Une session n'accepte que les envois signés, datés de moins de 25 heures et jamais vus, pour qu'un fichier déposé ou recopié sur le partage ne puisse pas la réveiller. `install` crée la clé sur le premier poste. Recopie-la une fois sur le second :

1. Sur le premier poste, `markspot key` affiche la clé. Enregistre-la dans un fichier (sur une clé USB, par exemple).
2. Sur le second, lance `markspot install --key-file <ce fichier>`, puis supprime le fichier.

La clé est rangée hors du dossier des notes : `~/.config/markspot/dispatch.key` sous Linux, `~/Library/Application Support/markspot-key/dispatch.key` sous macOS et `%LOCALAPPDATA%\markspot-key\dispatch.key` sous Windows. Partage seulement le dossier des notes, jamais tout ton dossier personnel : la clé passerait aussi par le partage, et une personne qui peut y écrire pourrait fabriquer un envoi.

## Ajouter un navigateur

Les navigateurs basés sur Chromium (Edge, Vivaldi, Arc…) se déclarent dans `src/cli/browsers.ts` : une entrée qui dit où le navigateur cherche le programme local sur chaque système. `install`, `uninstall` et `doctor` la prennent d'eux-mêmes. Ajoute son test dans `tests/unit/browsers.test.ts`.

## Confidentialité et sécurité

- Markspot lui-même n'envoie rien hors de ton poste : ni télémétrie, ni serveur. Les notes et les captures n'arrivent au modèle que par ta propre session Claude Code, quand elle les lit.
- Aucun processus n'écoute sur le réseau. Le navigateur ne laisse que l'extension Markspot, reconnue par son identifiant fixe, parler au programme local.
- Les captures ne sont pas encore masquées ([issue #22](https://github.com/adryserage/Markspot/issues/22)). Ce que l'écran montre au moment de la capture (un mot de passe affiché en clair, un jeton) va dans l'image et jusqu'au modèle. L'aperçu dans la boîte de commentaire permet d'annuler. Le texte tapé dans un champ de formulaire n'est jamais gardé dans les données de la note.
- Sur un site tiers, les scripts de la page peuvent lire ce que tu tapes dans la boîte de commentaire ([issue #23](https://github.com/adryserage/Markspot/issues/23)).
- Sur un site en développement (Vue, Svelte, React), la note garde le nom du composant et le chemin de son fichier source tel que l'outil de build le donne. Ce chemin peut contenir ton nom d'utilisateur. Il reste dans le dossier des notes et dans l'export.
- Sous macOS et Linux, les fichiers sont créés avec les droits 0600 et les dossiers avec 0700. Sur un partage réseau, ce sont les droits du partage qui comptent : toute personne qui peut y écrire peut y déposer une note. Claude traite chaque commentaire comme une demande à évaluer.
- La clé d'envoi signe les envois « Envoyer à Claude ». Garde-la secrète, et hors de tout dossier partagé (voir [Deux postes, un seul dossier de notes](#deux-postes-un-seul-dossier-de-notes)).

## Développer

```sh
npm install
npm run build       # dist/cli.js et extension/dist/
npm run typecheck   # tsc --noEmit
npm test            # tests unitaires (node --test)
npm run smoke       # le serveur MCP construit et markspot listen
npm run e2e         # essais de bout en bout sur un Chrome dédié, CDP sur 127.0.0.1:9223
npm run e2e:real    # une vraie session Claude Code de bout en bout (coûte quelques tours)
```

`npm run e2e` ne construit pas : lance `npm run build` avant. `MARKSPOT_CDP` choisit un autre port de débogage.

La conception est dans [docs/conception.md](docs/conception.md).

## Licence

Apache 2.0. Voir les fichiers LICENSE et NOTICE (les polices Atkinson Hyperlegible sont sous licence SIL OFL 1.1).
