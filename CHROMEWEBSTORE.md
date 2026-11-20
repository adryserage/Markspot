# Fiche du Chrome Web Store

Tout ce qu'il faut remplir dans le tableau de bord développeur du Chrome Web Store pour Markspot. Les textes à coller sont en anglais, la langue principale de la fiche ; ils sont dans des blocs de code pour garder leurs retours à la ligne (la boutique n'affiche pas le Markdown).

Dernière mise à jour : 2026-11-20. Version publiée sur le Chrome Web Store : 0.5.0, https://chromewebstore.google.com/detail/okaabbekcogbhighojhlcbmdohahonie

## Paquet

1. `npm run build`, puis `npm run store` : écrit `store/markspot-<version>.zip`, dont le manifeste n'a pas de champ `key` (la boutique le refuse).
2. `npm run icons` refait les PNG de `extension/icons/` à partir des SVG de `extension/icons/src/`.
3. Captures, avec le programme local installé : `node build.mjs --out <dossier local>` puis `node scripts/store-screenshot.ts <dossier local>` (ajoute `en` ou `fr` pour une seule langue). Brave ne charge pas l'extension depuis un lecteur réseau : le dossier doit être sur un disque local.
4. Vidéos de démo : `node scripts/video/make.ts en`, puis `fr`, avec le programme local installé (environ 2 minutes chacune). Elles sortent dans `store/video/`. Avec `--trial`, la scène de la réponse de Claude devient une carte provisoire.

## Identifiant de l'extension

L'identifiant est `okaabbekcogbhighojhlcbmdohahonie`, celui que la boutique a donné à l'élément. Le champ `key` de `extension/manifest.json` est la clé publique affichée dans l'onglet « Package » de l'élément (« View public key »). Ne la change pas : le programme local (`markspot host`) n'accepte que l'identifiant calculé depuis cette clé, et `npm run build` l'affiche à chaque build.

Mettre à jour un poste : `npm install -g markspot@<version>` puis `markspot install`. `install` réécrit chaque étape qui a changé, dont la déclaration du programme local. N'utilise pas `markspot uninstall` pour une mise à jour : il supprime aussi les notes.

## Fiche

Nom :

```
Markspot
```

Description courte (132 caractères au plus) :

```
Mark a spot on a web page and leave a note: Claude Code reads it, fixes the code and answers on the page.
```

Description détaillée :

```
Markspot lets you point at what is wrong on a web page and hand it to Claude Code.

Press Alt+C, click the element that needs work and write what you want changed. Markspot saves the note with the page address, the element's details and two screenshots: a close-up and the whole screen with the area framed. You can draw an arrow, a rectangle or a free line on the screenshot.

In Claude Code, say "fix my annotations". Claude reads each note, finds the source file, fixes it and resolves the note. The pin on the page turns to "Resolved" and shows Claude's reply. The "Send to Claude" button sends your open notes to a Claude Code session that is listening.

Markspot needs its free local program, installed from npm:
npm install -g markspot
markspot install
It requires Node.js 22.18 or later and Claude Code.

Your notes stay on your computer. Markspot has no account, no server and no telemetry, and the extension makes no network requests. Notes reach the model only when your own Claude Code session reads them.

Open source under the Apache 2.0 license. Source, documentation and issues: https://github.com/adryserage/Markspot

What's new in each version: https://github.com/adryserage/Markspot/releases
```

Catégorie : `Developer Tools`.

Langue : English. Le français est déjà dans l'extension (`_locales/fr`) ; la boutique peut recevoir une fiche traduite plus tard.

Objet unique (« Single purpose ») :

```
Markspot lets the user mark an element on a web page and leave a note with screenshots, so that the user's own Claude Code session can read the note and fix the page's code.
```

## Images

| Image | Taille | Fichier | État |
| --- | --- | --- | --- |
| Icône de la boutique | 128×128 | `extension/icons/icon-128.png` | prête |
| Captures 1 à 5, en anglais : boîte de commentaire avec une flèche, surbrillance au survol, note réglée avec la réponse de Claude, menu des notes, page d'export | 1280×800 | `store-assets/screenshot-1.png` à `screenshot-5.png` | prêtes |
| Captures 1 à 5, en français (fiche en français) | 1280×800 | `store-assets/fr/screenshot-1.png` à `screenshot-5.png` | prêtes |
| Vidéo de démo, en anglais (vidéo internationale) et en français (vidéo localisée) | 1920×1080, 44,5 s | `store/video/markspot-demo-en.mp4` et `markspot-demo-fr.mp4`, en ligne : anglaise https://www.youtube.com/watch?v=Qc0xEFUuMCg, française https://www.youtube.com/watch?v=bbS5UQcl3ec | en ligne |
| Petite vignette promotionnelle | 440×280 | à faire | conseillée |

## Justification des permissions

À coller dans l'onglet « Privacy practices », un champ par permission.

`activeTab` :

```
When the user clicks the Markspot icon, presses Alt+C or picks a Markspot menu item, Markspot turns on annotation mode in that tab only, and captures a screenshot of the visible tab for the note the user is writing. Markspot never runs on a tab the user has not acted on.
```

`scripting` :

```
Injects the annotation interface (highlight, comment box, pins) into the tab the user activated, and reads the name of the page component under the marked element on sites in development, so the note tells Claude Code which source file to fix.
```

`storage` :

```
Keeps the user's notes and their screenshots until the local Markspot program has received them, and keeps the interface language the user chose.
```

`unlimitedStorage` :

```
Each note holds two PNG screenshots. When the local program is not running, several notes wait in the browser, and their screenshots can go past the default 10 MB storage limit. Without this permission, notes would be lost.
```

`contextMenus` :

```
Adds two items to the menu of the Markspot toolbar icon: "Export notes" to open the export page, and "Language" to choose the interface language.
```

`nativeMessaging` :

```
Sends each note to the Markspot program installed on the user's computer (npm package "markspot"), which saves it in a local folder that the user's Claude Code session reads. The program also sends back Claude's replies so they show on the page. No data leaves the computer through this channel.
```

Code distant : non. Tout le code de l'extension est dans le paquet.

## Confidentialité

URL de la politique : `https://github.com/adryserage/Markspot/blob/main/PRIVACY.md` (en ligne après la fusion de la PR qui l'ajoute).

Formulaire de données. Le développeur ne reçoit aucune donnée. L'extension traite toutefois le contenu des pages annotées et le garde sur l'ordinateur ; cocher la catégorie évite un écart entre le formulaire et la politique :

- Website content : oui (texte et captures des éléments annotés, gardés en local).
- Toutes les autres catégories : non.

Certifications, toutes cochées : les données ne sont pas vendues ; elles ne servent à rien d'autre que la fonction de l'extension ; elles ne servent pas à évaluer la solvabilité.

## Développeur

- Éditeur et adresse de contact : à choisir au moment de créer le compte développeur. L'adresse est publique sur la fiche et reçoit les avis de Google.
- Assistance : `https://github.com/adryserage/Markspot/issues`
- Site : `https://github.com/adryserage/Markspot`
- Visibilité : publique, toutes les régions.
