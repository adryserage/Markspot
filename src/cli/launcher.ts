// Le lanceur que le navigateur exécute pour démarrer l'hôte. Il porte les chemins absolus
// de node et de cli.js : un navigateur lancé depuis le menu n'a pas toujours le PATH du shell.
// Pur, testé dans tests/unit/browsers.test.ts.

import type { Platform } from "../core/paths.ts";

export interface Launcher {
  fileName: string;
  content: string;
  mode: number;
}

/** Guillemets simples pour sh : seule l'apostrophe demande un traitement. */
export const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export function launcherFor(platform: Platform, nodePath: string, cliPath: string): Launcher {
  if (platform === "win32") {
    // cmd.exe : guillemets doubles, % doublé pour ne pas être lu comme une variable. Fins de ligne CRLF.
    const quote = (v: string) => `"${v.replaceAll("%", "%%")}"`;
    return {
      fileName: "markspot-host.bat",
      content: ["@echo off", `${quote(nodePath)} ${quote(cliPath)} host %*`, ""].join("\r\n"),
      mode: 0o700,
    };
  }
  return {
    fileName: "markspot-host",
    content: `#!/bin/sh\nexec ${shQuote(nodePath)} ${shQuote(cliPath)} host "$@"\n`,
    mode: 0o700,
  };
}
