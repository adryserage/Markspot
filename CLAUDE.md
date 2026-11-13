# Markspot

## Projet

Outil open source d'annotation visuelle pour Claude Code : extension Chrome, hôte natif, serveur MCP local et skill. Projet Plane `MARK`. Dépôt public `adryserage/Markspot` (Apache 2.0), paquet npm `markspot`.

## Commandes

- Installer les dépendances : `npm install`
- Construire : `npm run build` (écrit `dist/cli.js` et `extension/dist/`)
- Vérifier les types : `npm run typecheck`
- Tests unitaires : `npm test`, ou un seul fichier : `node --test tests/unit/host.test.ts`
- Tests de bout en bout sur le Chrome dédié (CDP 127.0.0.1:9223) : `npm run build && npm run e2e`, qui lance `annotate.e2e.ts` (annoter la page d'essai, vérifier le stockage, puis l'effacer) et `edit-delete.e2e.ts` (modifier et supprimer une note) ; captures dans `tests/e2e/artifacts/`
- Essai réel avec une vraie session Claude Code (à la main, coûte quelques tours) : `npm run e2e:real`
- Version d'essai sans hôte natif, pour le poste Windows : `node build.mjs --trial` (écrit `~/markspot-essai`, vu en `Z:\markspot-essai`)
- Installer sur ce poste : `node dist/cli.js install --chrome-profile ~/.config/chrome-claude --cdp http://127.0.0.1:9223` (une fois ; les réglages restent dans `~/.config/markspot/config.json`). Ajoute aussi le serveur MCP `markspot` à Claude Code et le skill dans `~/.claude/skills/markspot`.
- Essai du serveur MCP construit : `npm run smoke`
- Vérifier l'installation et l'aller-retour extension vers hôte : `node dist/cli.js doctor`
- Retirer : `node dist/cli.js uninstall`

## Structure

- `src/core/` : types et protocole, sans dépendance à Node ni à Chrome. `build.ts` reçoit l'identifiant de l'extension et la version au build. `i18n.ts` : textes de l'interface en anglais (source) et en français ; une clé ajoutée en anglais doit l'être en français (vérifié par `tsc`).
- `src/host/host.ts` : hôte natif (trames de 4 octets, contrôle de l'origine, file série des requêtes, poussées des changements).
- `src/store/store.ts` : seul module qui touche au dossier des notes (un dossier par note, résolution par lien exclusif).
- `src/mcp/` : serveur MCP (`server.ts`), rendu des notes pour Claude (`render.ts`) et canal qui réveille la session lancée par `markspot claude` (`channel.ts`).
- `skill/SKILL.md` : skill « règle mes annotations » (« fix my annotations »), en anglais.
- `src/cli/` : binaire `markspot` ; `install.ts` contient les étapes `{ satisfied, apply, revert }` d'install, d'uninstall et de doctor ; `browsers.ts` dit où chaque navigateur cherche l'hôte, par système ; `launcher.ts` écrit le lanceur sh ou .bat ; `shell.ts` écrit le bloc `claude` des fichiers de démarrage du shell ; `launch.ts` est ce que ce bloc lance (question, puis claude avec ou sans canal) ; `cdp.ts` parle au port de débogage de Chrome.
- `extension/` : manifeste MV3 (le champ `key` fixe l'identifiant). `src/background.ts` (raccourci, messages, port natif), `src/capture.ts` (deux images), `src/local-store.ts` (stockage dans le navigateur, remplacé par l'hôte à MARK-5), `src/overlay/` (interface dans la page, racine shadow fermée : `overlay.ts`, `menu.ts` pour le menu des notes, `drawing-pad.ts` pour le dessin), `src/export.*` (page d'export ouverte par le menu de l'icône ; format dans `src/core/export.ts`). `src/lang.ts` lit la langue choisie dans le menu de l'icône ; `_locales/` traduit le manifeste.
- `tests/unit/` : tests `node:test`, lancés directement en TypeScript. `tests/e2e/` : Playwright `connectOverCDP` sur le Chrome dédié. `tests/fixtures/` : page d'essai et son petit serveur.
- `docs/conception.md` : conception de la phase 1 (types, flux, choix).
- `README.md` (en anglais, affiché sur npm) et `README.fr.md` (en français) : même contenu, à tenir à jour ensemble.
- `docs/features.md` (en anglais) et `docs/fonctions.md` (en français) : guide de chaque fonction, pour les utilisateurs, avec les libellés de l'interface dans sa langue. À tenir à jour ensemble avec chaque fonction ajoutée ou changée.

## Règles du projet

- L'identifiant de l'extension se calcule dans `build.mjs` à partir de `extension/manifest.json`. Ne le recopie nulle part ailleurs. La clé privée reste hors du dépôt (`~/.config/markspot/extension-key.pem`).
- La version de `extension/manifest.json` doit être celle de `package.json` : le build échoue sinon.
- Versions exactes dans `package.json`, sans `^`.
- Imports relatifs avec l'extension `.ts` (Node lance les tests sans compilation).
- Le Chrome dédié est partagé avec les autres sessions : pas de `content_scripts` statique, et préviens les sessions actives avant d'y recharger l'extension.
