# Journal des versions

English: [CHANGELOG.md](CHANGELOG.md)

## 0.4.0 (2026-11-17)

### Ajouts

- Un sous-menu « Réveil automatique » dans le menu du clic droit sur l'icône de la barre d'outils, avec « Demander à chaque fois », « Toujours » et « Jamais ». Il choisit si `claude` demande « Markspot écoute cette session ? », démarre avec Markspot ou démarre sans. Le choix est gardé dans le dossier des notes : deux postes qui partagent ce dossier suivent le même choix. Le sous-menu n'apparaît que lorsque l'extension est reliée au programme local. ([#29](https://github.com/adryserage/Markspot/pull/29))
- L'extension est sur le [Chrome Web Store](https://chromewebstore.google.com/detail/okaabbekcogbhighojhlcbmdohahonie). La ligne « to do » de `markspot install` y renvoie, et donne toujours le dossier de l'extension du paquet pour les betas. ([#31](https://github.com/adryserage/Markspot/pull/31))
- Un aperçu animé en haut des deux README. ([#31](https://github.com/adryserage/Markspot/pull/31))
- Pour les mainteneurs, des scripts qui font les captures du Chrome Web Store et la vidéo de démo, en anglais et en français. ([#30](https://github.com/adryserage/Markspot/pull/30))

### Changements

- Les README installent l'extension depuis le Chrome Web Store, qui la tient à jour, et expliquent comment remplacer une copie chargée avec « Charger l'extension non empaquetée ». ([#31](https://github.com/adryserage/Markspot/pull/31))

### Corrections

- Quand Node vient de mise, les lanceurs gardaient la version exacte de Node et y restaient après une mise à jour de Node par mise. Ils prennent maintenant le dossier de la version majeure de Node, que mise tient à jour. Après une nouvelle version majeure de Node, relance `markspot install`. ([#32](https://github.com/adryserage/Markspot/pull/32))

## 0.3.0 (2026-11-16)

### Changements

- L'extension prend l'identifiant qu'elle a sur le Chrome Web Store. L'ancienne extension ne parle plus au programme local, il faut donc la recharger une fois : lance `markspot install`, retire l'ancienne extension dans `chrome://extensions`, puis charge `$(npm root -g)/markspot/extension` avec « Charger l'extension non empaquetée ». Tes notes restent en place. ([#27](https://github.com/adryserage/Markspot/pull/27))
- `markspot uninstall` supprime aussi les notes, les envois consommés et les dossiers de Markspot. Un dossier de notes choisi avec `--data-dir` reste, car un autre poste peut s'en servir. N'utilise pas `uninstall` pour mettre à jour. ([#26](https://github.com/adryserage/Markspot/pull/26))

### Ajouts

- Des icônes dans la barre d'outils et dans `chrome://extensions`. ([#26](https://github.com/adryserage/Markspot/pull/26))
- Une politique de confidentialité, [PRIVACY.md](PRIVACY.md). ([#26](https://github.com/adryserage/Markspot/pull/26))
- Une section du README sur la mise à jour d'un poste. ([#28](https://github.com/adryserage/Markspot/pull/28))

## 0.2.0 (2026-11-14)

### Changements

- La question que pose `claude` au lancement répond maintenant non par défaut : « Markspot écoute cette session ? [o/N] (non dans 5 s) ». Tape `o` (ou `y`) pour que Markspot écoute la session. Entrée, une autre touche ou 5 secondes sans réponse lance Claude sans Markspot. ([#25](https://github.com/adryserage/Markspot/pull/25))

## 0.1.0 (2026-11-13)

Première version publique.

### Ajouts

- Le mode annotation dans Chrome et Brave. Appuie sur Alt+C, clique sur un élément ou trace une zone, écris un commentaire et dessine sur la capture (flèche, rectangle, stylo).
- Chaque note garde l'adresse de la page, l'élément (sélecteur, texte visible, attributs, styles calculés) et deux images. Sur un site en développement avec Vue, Svelte ou React, elle garde aussi le composant et son fichier source. ([#15](https://github.com/adryserage/Markspot/pull/15))
- Un menu des notes dans la page pour aller à une note, la modifier ou la supprimer, la marquer réglée ou la rouvrir, exporter les notes en JSON et les effacer. Des boutons express à côté font la même chose en un clic. ([#6](https://github.com/adryserage/Markspot/pull/6), [#20](https://github.com/adryserage/Markspot/pull/20))
- La boîte de commentaire et la fiche d'une note se déplacent par leur barre du haut. ([#5](https://github.com/adryserage/Markspot/pull/5))
- Un serveur MCP local et un skill. Dis « règle mes annotations » et Claude lit, corrige et résout les notes, et sa réponse s'affiche sur la page.
- « Envoyer à Claude » envoie les notes ouvertes à la session choisie dans « Envoyer à ». Quand un projet écoute sur deux postes, la liste montre le nom du poste. ([#8](https://github.com/adryserage/Markspot/pull/8), [#9](https://github.com/adryserage/Markspot/pull/9), [#13](https://github.com/adryserage/Markspot/pull/13))
- Le mode écoute. « écoute mes annotations » fait attendre la session avec `markspot listen`, qui n'use aucun jeton pendant l'attente. ([#7](https://github.com/adryserage/Markspot/pull/7), [#18](https://github.com/adryserage/Markspot/pull/18))
- Le réveil automatique. Une session lancée avec `claude` après `markspot install`, ou avec `markspot claude`, se réveille à « Envoyer à Claude » par les canaux de Claude Code, en aperçu de recherche. ([#10](https://github.com/adryserage/Markspot/pull/10), [#17](https://github.com/adryserage/Markspot/pull/17))
- Deux postes peuvent partager un seul dossier de notes (`--data-dir`). Les envois sont signés avec une clé gardée hors de ce dossier (`markspot key`, `--key-file`). ([#7](https://github.com/adryserage/Markspot/pull/7), [#16](https://github.com/adryserage/Markspot/pull/16))
- L'anglais et le français, au choix dans le menu du clic droit sur l'icône de la barre d'outils. ([#21](https://github.com/adryserage/Markspot/pull/21))
- `markspot install`, `doctor` et `uninstall` pour Chrome et Brave. Essayés sous Linux et Windows, pas encore sous macOS. ([#12](https://github.com/adryserage/Markspot/pull/12), [#17](https://github.com/adryserage/Markspot/pull/17))
- Un guide des fonctions en anglais et en français. ([#11](https://github.com/adryserage/Markspot/pull/11), [#24](https://github.com/adryserage/Markspot/pull/24))
