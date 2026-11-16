// La vidéo de démo, d'un bout à l'autre : construit l'extension, tourne les prises, monte.
//   node scripts/video/make.ts <en|fr> [--trial]
// Écrit store/video/markspot-demo-<lang>.mp4. Par défaut, il faut le programme local installé
// (markspot install) : ses notes vont dans un dossier jetable, les vraies ne sont pas touchées.
// --trial : extension d'essai, sans programme local ; la scène où Claude répond reste une
// carte provisoire et les pastilles sont « en attente ».
// Dossier de travail : MARKSPOT_VIDEO_WORK, sinon <tmp>/markspot-video/<lang>. ffmpeg : FFMPEG.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { film } from "./film.ts";
import { render } from "./render.ts";

const [lang] = process.argv.slice(2);
assert.ok(lang === "en" || lang === "fr", "usage: node scripts/video/make.ts <en|fr> [--trial]");
const trial = process.argv.includes("--trial");
const work = process.env.MARKSPOT_VIDEO_WORK ?? join(tmpdir(), "markspot-video", lang);

// Hors du dépôt : un navigateur ne charge pas une extension depuis un partage réseau.
const extensionDir = join(work, "extension");
const built = spawnSync(process.execPath, ["build.mjs", trial ? "--trial" : "--out", extensionDir], { stdio: "inherit" });
assert.equal(built.status, 0, "the extension build failed");

await rm(join(work, "footage"), { recursive: true, force: true });
await film(extensionDir, lang, join(work, "footage"), !trial);
await render(lang, work, join("store", "video", `markspot-demo-${lang}.mp4`));
