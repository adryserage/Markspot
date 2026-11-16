// Construit dist/cli.js (Node) et l'extension.
//   node build.mjs                 extension complète dans extension/dist/ (hôte natif)
//   node build.mjs --trial [dir]   extension d'essai complète dans dir (défaut ~/markspot-essai),
//                                  sans hôte natif : les notes restent dans le navigateur
//   node build.mjs --out <dir>     extension complète (avec hôte natif) dans dir, par exemple le
//                                  dossier déjà chargé dans un navigateur : « Recharger » suffit et
//                                  les notes de l'essai partent au programme local
//   node build.mjs --store         paquet du Chrome Web Store : store/markspot-<version>.zip,
//                                  manifeste sans « key » (la boutique la refuse)
// L'identifiant de l'extension est calculé ici à partir de la clé publique du manifeste.

import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { build } from "esbuild";
import { extensionIdFromKey } from "./src/core/extension-id.ts";

const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));

const trialIndex = process.argv.indexOf("--trial");
const trial = trialIndex !== -1;
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1 ? process.argv[outIndex + 1] : undefined;
if (outIndex !== -1 && !outDir) throw new Error("--out needs a folder");
const store = process.argv.includes("--store");
const storeDir = resolve("store", `markspot-${pkg.version}`);
const extensionRoot = trial
  ? resolve(process.argv[trialIndex + 1] ?? join(homedir(), "markspot-essai"))
  : store
    ? storeDir
    : outDir
      ? resolve(outDir)
      : "extension";

const extensionId = extensionIdFromKey(manifest.key);

if (manifest.version !== pkg.version) {
  throw new Error(`extension/manifest.json version ${manifest.version} differs from package.json ${pkg.version}`);
}

const define = {
  __MARKSPOT_EXTENSION_ID__: JSON.stringify(extensionId),
  __MARKSPOT_VERSION__: JSON.stringify(pkg.version),
  __MARKSPOT_NATIVE__: JSON.stringify(!trial),
};

if (store) await rm(storeDir, { recursive: true, force: true });

if (!trial && !store) {
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

// Le manifeste a default_locale et des icônes : Chrome refuse de charger l'extension sans eux.
if (extensionRoot !== "extension") {
  await cp("extension/_locales", join(extensionRoot, "_locales"), { recursive: true });
  await mkdir(join(extensionRoot, "icons"), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await copyFile(`extension/icons/icon-${size}.png`, join(extensionRoot, "icons", `icon-${size}.png`));
  }
}

if (outDir && !trial) {
  await writeFile(join(extensionRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if (store) {
  const { key: _key, ...storeManifest } = manifest;
  await writeFile(join(extensionRoot, "manifest.json"), JSON.stringify(storeManifest, null, 2) + "\n");
  await writeFile(`${storeDir}.zip`, await zip(extensionRoot));
}

if (trial) {
  const trialManifest = {
    ...manifest,
    name: "Markspot (essai)",
    permissions: manifest.permissions.filter((p) => p !== "nativeMessaging"),
  };
  await writeFile(join(extensionRoot, "manifest.json"), JSON.stringify(trialManifest, null, 2) + "\n");
}

const where = trial
  ? ` (trial, in ${extensionRoot})`
  : store
    ? ` (Chrome Web Store package ${storeDir}.zip)`
    : outDir
      ? ` (in ${extensionRoot})`
      : "";
console.log(`built markspot ${pkg.version}${where}, extension id ${extensionId}`);

/** ZIP minimal (deflate, sans dépendance) des fichiers de dir, chemins relatifs à dir. */
async function zip(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(relative(dir, file).split("\\").join("/"));
    const data = await readFile(file);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    // Date DOS fixe (1er janvier 2026) : le même contenu donne le même ZIP.
    const time = 0;
    const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
