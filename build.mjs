// Construit dist/cli.js (Node) et l'extension.
//   node build.mjs                 extension complète dans extension/dist/ (hôte natif)
//   node build.mjs --trial [dir]   extension d'essai complète dans dir (défaut ~/markspot-essai),
//                                  sans hôte natif : les notes restent dans le navigateur
// L'identifiant de l'extension est calculé ici à partir de la clé publique du manifeste.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));

const trialIndex = process.argv.indexOf("--trial");
const trial = trialIndex !== -1;
const extensionRoot = trial ? resolve(process.argv[trialIndex + 1] ?? join(homedir(), "markspot-essai")) : "extension";

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
  __MARKSPOT_NATIVE__: JSON.stringify(!trial),
};

if (!trial) {
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
}

const dist = join(extensionRoot, "dist");
const browser = { bundle: true, platform: "browser", target: "chrome130", define, loader: { ".css": "text" } };
await build({ ...browser, entryPoints: ["extension/src/background.ts"], outfile: join(dist, "background.js"), format: "esm" });
await build({ ...browser, entryPoints: ["extension/src/overlay/overlay.ts"], outfile: join(dist, "overlay.js"), format: "iife" });
await build({ ...browser, entryPoints: ["extension/src/export.ts"], outfile: join(dist, "export.js"), format: "esm" });
for (const page of ["export.html", "export.css"]) await copyFile(join("extension/src", page), join(dist, page));

await mkdir(join(dist, "fonts"), { recursive: true });
for (const weight of [400, 700]) {
  await copyFile(
    `node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${weight}-normal.woff2`,
    join(dist, "fonts", `atkinson-${weight}.woff2`),
  );
}
// La licence SIL OFL demande que son texte accompagne chaque copie des polices.
await copyFile("node_modules/@fontsource/atkinson-hyperlegible/LICENSE", join(dist, "fonts", "OFL.txt"));

if (trial) {
  const trialManifest = {
    ...manifest,
    name: "Markspot (essai)",
    permissions: manifest.permissions.filter((p) => p !== "nativeMessaging"),
  };
  await writeFile(join(extensionRoot, "manifest.json"), JSON.stringify(trialManifest, null, 2) + "\n");
}

console.log(`built markspot ${pkg.version}${trial ? ` (trial, in ${extensionRoot})` : ""}, extension id ${extensionId}`);
