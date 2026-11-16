// Identifiant de l'extension construite, lu dans extension/manifest.json comme le fait build.mjs.

import { readFileSync } from "node:fs";
import { extensionIdFromKey } from "../../src/core/extension-id.ts";

const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8")) as { key: string };
export const EXTENSION_ID = extensionIdFromKey(manifest.key);
