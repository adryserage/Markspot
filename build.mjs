// Construit dist/cli.js (Node) et extension/dist/ (navigateur).
// L'identifiant de l'extension est calculé ici à partir de la clé publique du manifeste.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));

/** Chrome : sha256 de la clé publique DER, 32 premiers chiffres hexadécimaux transposés en a-p. */
const extensionId = createHash("sha256")
  .update(Buffer.from(manifest.key, "base64"))
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

if (manifest.version !== pkg.version) {
  throw new Error(`extension/manifest.json version ${manifest.version} differs from package.json ${pkg.version}`);
}

const define = {
  __MARKSPOT_EXTENSION_ID__: JSON.stringify(extensionId),
  __MARKSPOT_VERSION__: JSON.stringify(pkg.version),
};

await build({
  entryPoints: ["src/cli/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  define,
});

await build({
  entryPoints: ["extension/src/background.ts"],
  outdir: "extension/dist",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome120",
  define,
});

console.log(`built markspot ${pkg.version}, extension id ${extensionId}`);
