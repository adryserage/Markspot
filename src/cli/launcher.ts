// Le lanceur que le navigateur exécute pour démarrer l'hôte. Il porte les chemins absolus
// de node et de cli.js : un navigateur lancé depuis le menu n'a pas toujours le PATH du shell.
// Pur, testé dans tests/unit/browsers.test.ts.

import type { Platform } from "../core/paths.ts";

export interface Launcher {
  fileName: string;
  content: string;
  mode: number;
}

/**
 * Le node à graver dans les lanceurs. Node installé par mise vit dans …/mise/installs/node/<x.y.z>/,
 * et mise tient à jour un dossier par version majeure (…/node/26) : ce chemin suit les mises à jour
 * de la majeure sans dépendre du dossier courant, contrairement au raccourci (shim) de mise, qui
 * prendrait le Node demandé par le projet où tourne `markspot listen`. Pur : exists est passé.
 */
export function stableNodePath(execPath: string, exists: (path: string) => boolean): string {
  const match = /^(.*[\\/]mise[\\/]installs[\\/]node[\\/])(\d+)\.\d+\.\d+([\\/].+)$/.exec(execPath);
  if (!match) return execPath;
  const [, installs, major, rest] = match;
  const majorPath = `${installs}${major}${rest}`;
  return exists(majorPath) ? majorPath : execPath;
}

/** Guillemets simples pour sh : seule l'apostrophe demande un traitement. */
export const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * kind « host » : lancé par le navigateur (markspot-host) ; « cli » : la commande markspot
 * elle-même, que Claude Code lance pour écouter (markspot listen).
 */
export function launcherFor(platform: Platform, nodePath: string, cliPath: string, kind: "host" | "cli" = "host"): Launcher {
  const base = kind === "host" ? "markspot-host" : "markspot";
  const sub = kind === "host" ? " host" : "";
  if (platform === "win32") {
    // cmd.exe : guillemets doubles, % doublé pour ne pas être lu comme une variable. Fins de ligne CRLF.
    const quote = (v: string) => `"${v.replaceAll("%", "%%")}"`;
    return {
      fileName: `${base}.bat`,
      content: ["@echo off", `${quote(nodePath)} ${quote(cliPath)}${sub} %*`, ""].join("\r\n"),
      mode: 0o700,
    };
  }
  return {
    fileName: base,
    content: `#!/bin/sh\nexec ${shQuote(nodePath)} ${shQuote(cliPath)}${sub} "$@"\n`,
    mode: 0o700,
  };
}
