// Valeurs injectées par build.mjs (esbuild `define`). L'identifiant vient de la clé
// publique de extension/manifest.json : une seule source, rien à recopier à la main.

declare const __MARKSPOT_EXTENSION_ID__: string;
declare const __MARKSPOT_VERSION__: string;

export const EXTENSION_ID = __MARKSPOT_EXTENSION_ID__;
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
export const VERSION = __MARKSPOT_VERSION__;
