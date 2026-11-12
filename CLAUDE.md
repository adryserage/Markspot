# Markspot

## Projet

Outil open source d'annotation visuelle pour Claude Code : extension Chrome, hôte natif, serveur MCP local et skill. Projet Plane `MARK`. Dépôt `adryserage/markspot`, privé jusqu'à l'accord du propriétaire.

## Commandes

- Installer les dépendances : `npm install`
- Construire : `npm run build` (écrit `dist/cli.js` et `extension/dist/`)
- Vérifier les types : `npm run typecheck`
- Tests unitaires : `npm test`, ou un seul fichier : `node --test tests/unit/host.test.ts`
- Installer sur ce poste : `node dist/cli.js install --chrome-profile ~/.config/chrome-claude --cdp http://127.0.0.1:9223` (une fois ; les réglages restent dans `~/.config/markspot/config.json`)
- Vérifier l'installation et l'aller-retour extension vers hôte : `node dist/cli.js doctor`
- Retirer : `node dist/cli.js uninstall`

## Structure

- `src/core/` : types et protocole, sans dépendance à Node ni à Chrome. `build.ts` reçoit l'identifiant de l'extension et la version au build.
- `src/host/host.ts` : hôte natif (trames de 4 octets, contrôle de l'origine).
- `src/cli/` : binaire `markspot` ; `install.ts` contient les étapes `{ satisfied, apply, revert }` d'install, d'uninstall et de doctor ; `cdp.ts` parle au port de débogage de Chrome.
- `extension/` : manifeste MV3 (le champ `key` fixe l'identifiant) et `src/background.ts`.
- `tests/unit/` : tests `node:test`, lancés directement en TypeScript.
- `docs/conception.md` : conception de la phase 1 (types, flux, choix).

## Règles du projet

- L'identifiant de l'extension se calcule dans `build.mjs` à partir de `extension/manifest.json`. Ne le recopie nulle part ailleurs. La clé privée reste hors du dépôt (`~/.config/markspot/extension-key.pem`).
- La version de `extension/manifest.json` doit être celle de `package.json` : le build échoue sinon.
- Versions exactes dans `package.json`, sans `^`.
- Imports relatifs avec l'extension `.ts` (Node lance les tests sans compilation).
- Le Chrome dédié est partagé avec les autres sessions : pas de `content_scripts` statique, et préviens les sessions actives avant d'y recharger l'extension.
