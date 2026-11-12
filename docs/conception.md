# Markspot phase 1 : conception retenue

Base : candidat 2 (fable). Greffes des candidats 1 (opus), 3 (sonnet) et 4 (haiku). Le juge croisé (fable) a choisi la même base.

## Décision de synthèse

- Base : candidat 2. Il fait la phase 1 avec une seule transition (ouvert vers réglé), le plus petit jeu de types, et c'est le seul où un script de la page ne peut ni lire ni fabriquer une annotation (racine shadow fermée, `isTrusted`). Partir du candidat 1 aurait obligé à retirer réouverture, archivage, purge et journal d'événements.
- Greffe du candidat 4 : à la résolution, le premier écrivain gagne (`link()` exclusif). Même réponse : `unchanged`. Réponse différente : `already_resolved`, avec la réponse en place. Remplace l'écrasement silencieux du candidat 2.
- Greffe du candidat 1 : `redactUrl` (valeurs des paramètres sensibles remplacées), droits 0700 sur les dossiers et 0600 sur les fichiers.
- Greffe du candidat 3 : `source.trust` et la règle de clôture : un commentaire de confiance `untrusted` (future version hébergée) est rendu comme une donnée encadrée, jamais comme une consigne.
- Greffe du candidat 3 : l'installateur est une liste d'étapes `{ satisfied, apply, revert }`, donc `install` se relance sans effet et `uninstall` défait chaque étape. `doctor` rejoue `satisfied` et le ping de l'hôte (candidat 1).
- Greffe du candidat 4 : le texte d'ancre n'est jamais lu dans un champ sensible et il est borné à 80 caractères.
- Rejeté : journal d'événements (candidats 1 et 3), trop lourd pour une seule transition ; le dossier par annotation laisse la place d'en ajouter un plus tard sans migration. File `inbox/` pour `clear` (candidat 4) : un `clear` appliqué en retard efface des notes créées entre-temps.
- Ajouts du propriétaire : deux images par annotation (gros plan de la zone et écran visible avec la zone encadrée), styles calculés de l'élément, et fichier source quand le framework l'expose en mode développement.
- Choix du propriétaire : native messaging plutôt qu'un serveur HTTP avec jeton ; données dans `~/.local/share/markspot` ; aucun masquage des captures en phase 1 (reporté, issue à part). La vignette avant envoi reste : l'utilisateur voit ce que Claude recevra.
- Erreurs corrigées : `commands` est une clé du manifeste, pas une permission. Une portée `hub:<ws>/<projet>` contient `/` : la portée passe par `scopeDir()`, qui l'encode en un seul nom de dossier.

## Lien extension vers stockage : native messaging

Aucun processus n'écoute sur le réseau, donc il n'y a ni port à choisir ni jeton à transmettre, et deux sessions ne peuvent pas se disputer un port. Chrome lance un seul hôte (`markspot host`) par port natif, ce qui fait l'écrivain unique des annotations. `allowed_origins` et l'identifiant fixe de l'extension (clé `key` du manifeste) font l'authentification. Les serveurs MCP (un par session Claude) ne parlent ni à l'hôte ni à l'extension : ils lisent le dossier et écrivent seulement `resolution.json`. L'hôte voit ce fichier par `fs.watch` et pousse l'état à la page.

Qui écrit quoi :

| Fichier | Écrivain | Quand |
|---|---|---|
| `local/<id>/annotation.json`, `zone.png`, `context.png` | hôte | une fois, par `rename` de `.staging/<id>/` |
| `local/<id>/resolution.json` | un MCP | une fois, `link()` exclusif ; le premier gagne |
| suppression de `local/<id>/` | un MCP (`clear`) | `rename` vers `.trash/`, puis effacement |

## Types (src/core/model.ts)

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };

export type AnnotationId = Brand<string, "AnnotationId">; // ULID créé par l'extension ; nom de dossier, donc parseAnnotationId bloque toute traversée
export type ScopeId = Brand<string, "ScopeId">;           // "local" en phase 1 ; plus tard "hub:<ws>/<projet>", encodé par scopeDir()
export type IsoTime = Brand<string, "IsoTime">;           // ISO 8601 UTC
export type PageUrl = Brand<string, "PageUrl">;           // passé par redactUrl avant stockage
export type PageKey = Brand<string, "PageKey">;           // origine + chemin, dérivé, jamais stocké
export type PageRect = Brand<Rect, "PageRect">;           // px CSS depuis le haut du document (stocké)
export type ViewportRect = Brand<Rect, "ViewportRect">;   // px CSS depuis la fenêtre (capture seulement)
export type Png = Brand<string, "Png">;                   // PNG en base64, produit par capture.ts seulement

export type Author =
  | { kind: "user"; id: string; name: string }    // phase 1 : { id: "local", name: "local" }
  | { kind: "agent"; id: string; name: string };  // phase 1 : { id: "claude-code", name: "Claude" }

export type Source =
  | { kind: "extension"; trust: "owner" };         // version hébergée : { kind: "hub-widget"; trust: "untrusted" }

export interface ElementAnchor {
  selector: string;                    // plus court sélecteur CSS unique
  tag: string; role: string | null;
  text: string;                        // 80 caractères au plus, jamais lu dans un champ sensible
  attributes: Record<string, string>;  // id, class, name, data-*, aria-label, href (redactUrl) ; jamais value
  styles: ComputedStyles;              // vraies valeurs, pour les problèmes visuels
  sourceHint: SourceHint | null;       // fichier source si le framework l'expose, sinon null
}

/** Sous-ensemble fixe de getComputedStyle, une seule liste (STYLE_PROPS) dont le type est dérivé. */
export const STYLE_PROPS = [
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "color", "background-color", "border", "border-radius", "box-shadow", "opacity",
  "display", "position", "width", "height", "margin", "padding", "gap",
  "flex-direction", "justify-content", "align-items", "overflow", "z-index",
] as const;
export type ComputedStyles = Record<(typeof STYLE_PROPS)[number], string>;

/** Lu dans le monde MAIN de la page, en mode développement seulement. La page peut le falsifier :
 *  c'est un indice pour la recherche, jamais une preuve. */
export interface SourceHint {
  framework: "react" | "vue" | "svelte" | "angular";
  component: string | null;            // nom du composant
  file: string | null;                 // chemin tel que le framework le donne (Vue __file, Svelte __svelte_meta)
  line: number | null;
  column: number | null;
}

export interface Mark {
  kind: "element" | "region";          // une zone garde le plus petit élément qui la contient
  anchor: ElementAnchor;
  rect: PageRect;
  rectInAnchor: Rect;                  // pour replacer la pastille si la mise en page bouge
}

export interface Viewport { width: number; height: number; devicePixelRatio: number; scrollX: number; scrollY: number }

export interface NewAnnotation {       // ce que l'extension envoie
  id: AnnotationId; scope: ScopeId; createdAt: IsoTime;
  author: Author; source: Source;
  page: { url: PageUrl; title: string };
  mark: Mark; viewport: Viewport;
  comment: string;                     // 1 à 4000 caractères
  captures: {
    zone: CaptureMeta;                 // gros plan : exactement la zone marquée
    context: CaptureMeta;              // écran visible entier, zone encadrée, réduit à 1600 px de large au plus
  };
}

export interface CaptureMeta { rect: PageRect; width: number; height: number } // le masquage (reporté) ajoutera un champ et passera schemaVersion à 2
export type CaptureKind = keyof NewAnnotation["captures"]; // "zone" | "context" : fichiers zone.png et context.png

export interface Annotation extends NewAnnotation { schemaVersion: 1; seq: number } // seq = numéro de pastille, donné par l'hôte
export interface Resolution { schemaVersion: 1; annotationId: AnnotationId; resolvedAt: IsoTime; author: Author; reply: string }
export interface Thread { annotation: Annotation; resolution: Resolution | null } // modèle de lecture, jamais stocké tel quel

export type ThreadState = "open" | "resolved";
export const stateOf = (t: Thread): ThreadState => (t.resolution ? "resolved" : "open"); // aucun champ state stocké

export function parseAnnotationId(raw: unknown): AnnotationId | null;
export function pageKeyOf(url: PageUrl): PageKey;
export function redactUrl(raw: string): PageUrl;  // token, key, code, secret, password, session, auth… -> "[masqué]"
export function scopeDir(scope: ScopeId): string; // un seul nom de dossier sûr
```

## Protocole natif (src/core/protocol.ts)

Trames JSON avec un préfixe de 4 octets (format de Chrome). 1 Mo au plus de l'hôte vers l'extension : le PNG ne va que dans l'autre sens.

```ts
export type ExtensionToHost =
  | { type: "sync" }                                              // tout, puis les changements
  | { type: "create"; annotation: NewAnnotation; pngs: Record<CaptureKind, Png> };

export type HostToExtension =
  | { type: "thread"; thread: Thread }                            // nouveau ou changé, idempotent
  | { type: "removed"; id: AnnotationId }
  | { type: "synced" }
  | { type: "created"; id: AnnotationId; seq: number }
  | { type: "rejected"; id: AnnotationId | null; reason: string };

export function parseExtensionMessage(raw: unknown): ExtensionToHost | null; // frontière : zod, tailles, id
```

## Stockage (src/store/store.ts, seul module qui touche au dossier)

```ts
export interface StoreConfig { dataDir: string; scope: ScopeId } // ~/.config/markspot/config.json, sinon ~/.local/share/markspot
export function loadConfig(): Promise<StoreConfig>;

export interface ThreadFilter { state?: ThreadState; urlPrefix?: string }
export interface ThreadReader {
  list(filter?: ThreadFilter): Promise<Thread[]>; // trié par seq
  get(id: AnnotationId): Promise<Thread | null>;
  capture(id: AnnotationId, kind: CaptureKind): Promise<Uint8Array | null>;
}

export interface HostStore extends ThreadReader {   // donné à l'hôte seulement
  create(a: NewAnnotation, pngs: Record<CaptureKind, Uint8Array>): Promise<Thread>; // idempotent sur a.id ; les deux images ou rien
  watch(onChange: (c: ThreadChange) => void): { close(): void };
}
export interface AgentStore extends ThreadReader {  // donné aux MCP seulement
  resolve(id: AnnotationId, reply: string, by: Author): Promise<ResolveOutcome>;
  clear(filter: { state: ThreadState | "all"; urlPrefix?: string }): Promise<AnnotationId[]>; // state obligatoire
}

export type ThreadChange = { kind: "upserted"; thread: Thread } | { kind: "removed"; id: AnnotationId };
export type ResolveOutcome =
  | { kind: "resolved"; thread: Thread }
  | { kind: "unchanged"; thread: Thread }          // même réponse déjà là
  | { kind: "already_resolved"; thread: Thread }   // une autre session a répondu avant
  | { kind: "not_found" };

export function openHostStore(c: StoreConfig): Promise<HostStore>;   // vide .staging et .trash au démarrage
export function openAgentStore(c: StoreConfig): Promise<AgentStore>;
```

## Outils MCP (src/mcp/server.ts, SDK v2 `@modelcontextprotocol/server`, zod 4)

| Outil | Entrée | Sortie | Indices |
|---|---|---|---|
| `markspot_list_annotations` | `state` (open par défaut, resolved, all), `url` (préfixe), `limit`, `offset` | liste paginée : id, seq, état, adresse, commentaire, ancre | lecture seule, idempotent |
| `markspot_get_annotation` | `id` | texte (adresse, ancre, styles calculés, fichier source s'il est connu, fenêtre, commentaire encadré comme donnée) + deux images PNG (gros plan, puis contexte) | lecture seule, idempotent |
| `markspot_resolve_annotation` | `id`, `reply` (1 à 4000) | « Réglée #4 », ou la réponse déjà en place | écriture, idempotent |
| `markspot_clear_annotations` | `state` (obligatoire), `url` | nombre supprimé | destructif, idempotent |

## Arborescence

```
markspot/                       un paquet npm, un binaire : markspot <mcp|host|install|uninstall|doctor>
├── package.json                bin -> dist/cli.js, pas de champ exports
├── tsconfig.json  build.mjs    esbuild : dist/cli.js (node) + extension/dist/ (navigateur)
├── LICENSE  README.md  CLAUDE.md  .gitignore
├── src/
│   ├── core/model.ts           types, schémas zod, stateOf, pageKeyOf, redactUrl, scopeDir (pur)
│   ├── core/protocol.ts        messages extension <-> hôte, schémas, limites
│   ├── store/store.ts          seul code qui touche au dossier de données
│   ├── host/host.ts            hôte natif : trames, contrôle d'origine, handle(msg, store), watch -> push
│   ├── mcp/server.ts           les 4 outils markspot_*, renderThread
│   └── cli/cli.ts, install.ts  sous-commandes ; étapes { satisfied, apply, revert } et doctor
├── extension/
│   ├── manifest.json           MV3, key fixe, commande Alt+C, permissions nativeMessaging, scripting, tabs, storage ; pas de content_scripts
│   ├── icons/
│   └── src/
│       ├── background.ts       service worker : Alt+C, pause par l'icône, réinjection sur les pages qui ont des pastilles
│       ├── link.ts             port natif, sync, cache par page, reconnexion
│       ├── capture.ts          captureVisibleTab, découpe du gros plan, contexte réduit et encadré : seul producteur de Png
│       ├── source-hint.ts      fonction injectée dans le monde MAIN : lit React, Vue, Svelte, Angular en mode développement
│       └── overlay/            racine shadow fermée : surbrillance, sélection, boîte, pastilles ; anchor.ts (ancre et styles) ; overlay.css
├── skill/SKILL.md              « règle mes annotations »
└── tests/
    ├── unit/                   model, store (création double, coupure avant rename, résolution concurrente), host (trames réelles)
    ├── fixtures/               page avec bouton, lien et champ de formulaire ; petit serveur 127.0.0.1
    ├── e2e/                    connectOverCDP 9223 : annoter ; boucle complète annoter -> MCP lit -> corrige -> résout -> pastille réglée
    └── smoke-mcp.ts            client MCP stdio : outils listés avec leurs indices
```

Hors du dépôt, écrit par `markspot install` et retiré par `uninstall` : `~/.config/markspot/config.json`, le lanceur de l'hôte (chemin absolu de node), le manifeste `com.markspot.host.json` dans `~/.config/chrome-claude/NativeMessagingHosts/`, l'extension (par `Extensions.loadUnpacked` sur 9223, repli manuel dans `chrome://extensions`), `claude mcp add --scope user markspot`, le lien `~/.claude/skills/markspot`. Les lignes de `ROUTAGE.json`, `NAVIGATEUR.md` et `Projets/CLAUDE.md` sont propres à ce poste : faites à la main, hors de l'installateur du projet libre.

## Flux

1. Chrome démarre. Le service worker ouvre `connectNative` ; Chrome lance `markspot host`, qui vérifie l'origine, ouvre le stockage et répond au `sync` avec toutes les annotations.
2. Alt+C : le service worker injecte l'overlay dans l'onglet. Surbrillance au survol ; clic = élément, glissé = zone. Seuls les événements `isTrusted` comptent.
3. L'overlay relève l'ancre et les styles calculés ; le service worker lit l'indice de fichier source dans le monde MAIN. L'overlay se cache et demande la capture. Le service worker fait un seul `captureVisibleTab` et en tire le gros plan et le contexte encadré.
4. La boîte de commentaire montre la vignette (ce que Claude recevra). L'utilisateur écrit et valide.
5. Service worker -> hôte : `create`. L'hôte écrit dans `.staging/<id>/` puis renomme en `local/<id>/`, et répond `created` avec le numéro. La pastille apparaît, état ouvert.
6. Dans Claude Code : « règle mes annotations ». Le skill appelle `markspot_list_annotations`, puis `markspot_get_annotation` (texte + image) pour chacune.
7. Claude part du fichier source s'il est donné, sinon le trouve par le texte, les attributs et le sélecteur. Il lit le problème visuel sur les deux images et les styles calculés, corrige, recharge avec le MCP chrome-devtools et capture l'élément.
8. `markspot_resolve_annotation` : le MCP crée `resolution.json` (le premier gagne).
9. L'hôte voit le fichier (`fs.watch`) et pousse `thread` au service worker, qui met à jour les onglets de cette page : la pastille passe à « réglée », un clic montre la réponse.
10. Chrome fermé : les étapes 6 à 8 marchent quand même ; le prochain `sync` rattrape l'affichage.

## Compromis acceptés

- On accepte un processus node qui vit tant que Chrome est ouvert, en échange de la poussée immédiate des résolutions vers la page.
- On accepte une liste en O(n) fichiers lus, sans index, en échange d'aucun fichier partagé à verrouiller.
- On accepte qu'en phase 1 les captures ne soient pas masquées : ce qui est à l'écran (champ mot de passe affiché en clair, code, numéro de carte, jeton) va dans l'image et jusqu'au modèle. La vignette avant envoi permet d'annuler. Le masquage est une issue à part.
- On accepte que les essais lisent l'overlay par `self.markspot.inspect(tabId)` dans le service worker, puisque la racine shadow est fermée.

## Risques et premier pas

- L'échange de messages natif n'est pas encore prouvé sur Chrome 157. Seuls `src/host/` et `extension/src/link.ts` connaissent le transport : si la preuve échoue, le reste ne change pas.
- `Extensions.loadUnpacked` n'a été testé qu'en headless.
- Fichier source : Vue (`__vueParentComponent.type.__file`) et Svelte (`__svelte_meta.loc`) donnent fichier et ligne en développement. React 19 a retiré `_debugSource` : il donne le nom du composant, rarement le fichier. En production, aucun framework ne donne rien, et la recherche par texte et attributs prend le relais.
- Une page peut falsifier l'indice lu dans le monde MAIN : il reste un indice, rendu à Claude comme une donnée.
- Premier pas : un hôte réduit à l'écho et une extension de dix lignes, pour prouver un aller-retour `connectNative` sur le Chrome dédié.
