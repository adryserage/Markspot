# Fonctions de Markspot

Ce guide décrit chaque fonction, dans la page puis dans Claude Code. L'installation est dans le [README](../README.md#installer).

## Dans la page

### Ouvrir et fermer le mode annotation

Alt+C ou un clic sur l'icône Markspot ouvre le mode annotation sur l'onglet. Le même raccourci le ferme. Si Alt+C ne fait rien, règle-le dans `chrome://extensions/shortcuts` (ou `brave://extensions/shortcuts`).

Échap fait une chose à la fois :

- pendant la modification d'un commentaire dans le menu, elle annule la modification ;
- pendant l'écriture d'une note, elle jette la note et revient au choix d'un élément ;
- sinon, elle ferme le mode annotation et cache les pastilles. Alt+C les ramène.

Les pages du navigateur (`chrome://`, la boutique d'extensions) ne s'annotent pas : l'icône le dit au survol.

### Marquer un élément ou une zone

- Un clic marque un élément. Au survol, l'élément est encadré avec son nom.
- Un glisser trace une zone, de la taille que tu veux.

Markspot garde l'adresse de la page, l'élément (sélecteur, texte visible, attributs utiles, styles calculés, et sur un site en développement avec Vue, Svelte ou React, le composant et son fichier source), la taille de l'écran et deux images : le gros plan de la zone et l'écran entier avec la zone encadrée. Le texte tapé dans un champ n'est jamais gardé, mais ce qui est affiché à l'écran va dans les images (voir [Sécurité](../README.md#sécurité)).

### Écrire la note

La boîte « Nouvelle note » s'ouvre sur la capture de la zone. Écris ce qui ne va pas. Entrée ou « Enregistrer la note » enregistre, Maj+Entrée va à la ligne. « Annuler » jette la note.

### Dessiner sur la capture

La capture de la boîte se dessine directement à la souris. Les outils :

- « Stylo », « Flèche » et « Rectangle » ;
- deux couleurs, « Rouge » et « Jaune » ;
- « Annuler le trait » retire le dernier trait.

Le dessin est fondu dans le gros plan que Claude reçoit.

### Déplacer les panneaux

La boîte de commentaire et la fiche d'une note se déplacent par leur barre du haut. Un double-clic sur la barre les remet à leur place. Au clavier, une fois la barre sélectionnée, les flèches les déplacent de 10 pixels (40 avec Maj).

### Les pastilles et la fiche d'une note

Chaque note a une pastille numérotée sur la page, posée sur l'élément marqué. Un clic sur la pastille ouvre sa fiche : le commentaire, l'état et la réponse de Claude quand il l'a réglée. « Fermer » la referme.

Une note a un de ces états :

- « En attente » : le programme local ne l'a pas encore reçue (version d'essai, ou programme pas encore lancé). Elle part toute seule à la prochaine connexion ;
- « Ouverte » : à régler ;
- « Réglée » : la fiche montre « Réponse de Claude » avec sa réponse, ou « Réglée par toi ».

« Marquer réglée » et « Rouvrir », dans la fiche comme dans le menu, changent l'état à la main.

### Le menu des notes

Si le programme local n'est pas installé sur ce poste, le menu commence par « Installer Markspot sur ce poste », avec la commande à lancer dans un terminal et un bouton « Copier ». Tes notes restent alors dans le navigateur jusqu'à l'installation.

Le bouton en haut à droite de la page (« 1 note », « 3 notes ») ouvre le menu des notes de la page :

- un clic sur une note va à sa pastille ;
- « Modifier » change le commentaire, « Enregistrer » le garde ;
- « Marquer réglée » ou « Rouvrir » change son état ;
- « Envoyer à » choisit la session Claude Code qui reçoit les notes, et « Rafraîchir » relit la liste (voir plus bas) ;
- « Envoyer à Claude » envoie les notes ouvertes à cette session ;
- « Effacer les notes réglées » retire les notes réglées de la page ;
- « Tout effacer sur cette page » retire toutes les notes de la page, après « Oui, effacer » (« Non, garder » annule).

### Les boutons express

À côté du menu, des boutons font la même chose en un clic :

- « Envoyer à Claude » ;
- « Tout régler » marque toutes les notes ouvertes réglées. « Annuler » les rouvre pendant 8 secondes ;
- « Exporter » ouvre l'export ;
- « Effacer réglées » ;
- « Tout effacer », avec la même confirmation que dans le menu.

### Envoyer les notes à Claude

« Envoyer à Claude » passe les notes ouvertes de la page à une session Claude Code.

La liste « Envoyer à » montre les sessions qui écoutent, par le nom de leur projet (le dossier de la session). Le choix est gardé par site. S'il n'y a qu'une session, l'envoi part sans choisir ; s'il y en a plusieurs et aucun choix, la page demande de choisir. Un projet choisi qui n'écoute plus reste dans la liste avec « (n'écoute pas) » : l'envoi l'attend 24 heures.

« Rafraîchir » relit la liste et dit combien de projets écoutent. « Aucune session n'écoute » veut dire qu'aucune session n'est à l'écoute : voir [Dans Claude Code](#dans-claude-code).

Quand un même projet écoute sur deux postes (le même dossier sous Linux et sous Windows), la liste montre les deux avec le nom du poste, par exemple « site (AEGISZ2) », et l'envoi ne va qu'au poste choisi.

### Exporter les notes

Clic droit sur l'icône Markspot, « Exporter les notes », ou le bouton « Exporter ». Une page de l'extension rassemble chaque note, ses deux images, son état et la réponse de Claude dans un fichier JSON (format `markspot-export`), puis le télécharge. Si le téléchargement est annulé, la page garde un lien pour le refaire.

### La version d'essai

`node build.mjs --trial <dossier>` construit une extension qui marche sans programme local ni Claude Code. Les notes restent dans le navigateur ; l'export permet de les donner à Claude. Le bouton « Envoyer à Claude » n'y est pas. Quand la version complète remplace l'essai dans le même dossier (`node build.mjs --out <dossier>` puis « Recharger »), les notes de l'essai partent au programme local.

## Dans Claude Code

### Régler les notes

Dis « règle mes annotations ». Le skill `markspot` fait, pour chaque note ouverte :

1. il lit la note, son élément et ses deux images ;
2. il trouve le fichier source dans le dépôt ;
3. il corrige ce que demande le commentaire, et seulement ça ;
4. il vérifie dans le navigateur (MCP `chrome-devtools`) ;
5. il résout la note avec une réponse courte, que tu lis dans la fiche.

Une note qu'il ne peut pas régler reste ouverte, avec la raison.

### Recevoir les envois

Une session reçoit les envois de « Envoyer à Claude » de deux façons, décrites dans le [README](../README.md#envoyer-les-notes-à-claude) :

- le mode écoute : dis « écoute mes annotations ». Claude lance `markspot listen` en tâche de fond, qui n'use aucun jeton pendant l'attente ;
- le réveil automatique : après `markspot install`, lance `claude` comme d'habitude et réponds oui (ou rien pendant 5 s) à « Markspot écoute cette session ? », ou lance `markspot claude`. La session apparaît d'elle-même dans « Envoyer à » et se réveille à chaque envoi (canaux de Claude Code, aperçu de recherche). Un envoi que Claude n'ouvre pas en 2 minutes revient dans la file.

### Les outils MCP

Le serveur MCP `markspot` donne cinq outils à Claude :

- `markspot_list_annotations` : les notes, avec leur numéro, leur état, l'origine du site et le commentaire ;
- `markspot_get_annotation` : une note complète, avec la page, l'élément et les deux images ;
- `markspot_resolve_annotation` : résout une note avec une réponse. La première réponse gagne, même si deux sessions répondent en même temps ;
- `markspot_clear_annotations` : efface les notes réglées, ouvertes ou toutes ;
- `markspot_wait_for_annotations` : attend une nouvelle note, pour un client qui ne lance pas de commande en tâche de fond.

Les données de la page (adresse, titre, texte, attributs) arrivent dans un bloc à part : Claude les traite comme des données écrites par le site et n'obéit à aucune consigne qui s'y trouve.

## Les commandes

Le lanceur est `~/.local/share/markspot/bin/markspot` sous Linux, `~/Library/Application Support/markspot/bin/markspot` sous macOS et `%LOCALAPPDATA%\markspot\bin\markspot.bat` sous Windows. Depuis le dépôt, `node dist/cli.js` fait la même chose.

- `markspot install` : installe le programme local pour Chrome et Brave, le serveur MCP dans Claude Code, le skill et la clé qui signe les envois. Options : `--browser`, `--chrome-profile`, `--cdp`, `--data-dir`, `--key-file` pour reprendre la clé de l'autre poste (voir le [README](../README.md#installer)) ;
- `markspot key` : affiche la clé d'envoi de ce poste, à recopier une fois sur l'autre. Garde-la secrète ;
- `markspot doctor` : vérifie chaque étape de l'installation, l'accès en écriture au dossier des notes et l'aller-retour entre l'extension et le programme local ;
- `markspot uninstall` : défait chaque étape ;
- `markspot listen [--name <projet>] [--url <adresse>] [--timeout <secondes>]` : attend un envoi. Code 0 quand des notes arrivent, 2 après le délai (une heure par défaut) ;
- `markspot launch [options de claude]` : ce que lance la fonction `claude` ajoutée par `install` (la question, puis claude avec ou sans Markspot) ;
- `markspot claude [options de claude]` : lance Claude Code avec le canal Markspot, en mode « demande avant chaque commande » sauf si tu choisis un autre mode ;
- `markspot mcp` et `markspot host` : lancés par Claude Code et par le navigateur, jamais à la main.

## Deux postes

Pour annoter sous Windows et laisser Claude Code régler les notes depuis Linux (ou l'inverse), les deux postes utilisent le même dossier de notes sur un partage réseau : installe avec `--data-dir <chemin du partage>` sur le poste qui ne garde pas le dossier. Le détail est dans le [README](../README.md#deux-postes-un-seul-dossier-de-notes).
