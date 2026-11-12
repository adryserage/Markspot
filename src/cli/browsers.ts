// Où chaque navigateur cherche l'hôte natif, par système. Pour ajouter un navigateur
// basé sur Chromium (Edge, Vivaldi, Arc…), ajoute une entrée à BROWSERS : install,
// uninstall et doctor la prennent d'eux-mêmes. Pur, testé dans tests/unit/browsers.test.ts.

import { posix, win32 } from "node:path";
import type { Platform } from "../core/paths.ts";
import { HOST_NAME } from "../core/protocol.ts";

/**
 * dir : dossier NativeMessagingHosts où poser le manifeste ; root dit si le navigateur
 *       est installé (son dossier de profil existe).
 * registry : clé HKCU dont la valeur par défaut est le chemin du manifeste (Windows).
 */
export type HostLocation =
  | { kind: "dir"; path: string; root: string }
  | { kind: "registry"; key: string };

interface Browser {
  label: string;
  locations(platform: Platform, home: string): HostLocation[];
}

const CHROME_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

function macDir(home: string, ...vendor: string[]): HostLocation {
  const root = posix.join(home, "Library", "Application Support", ...vendor);
  return { kind: "dir", path: posix.join(root, "NativeMessagingHosts"), root };
}

function linuxDir(home: string, ...vendor: string[]): HostLocation {
  const root = posix.join(home, ".config", ...vendor);
  return { kind: "dir", path: posix.join(root, "NativeMessagingHosts"), root };
}

export const BROWSERS = {
  chrome: {
    label: "Google Chrome",
    locations: (platform, home) => {
      switch (platform) {
        case "win32":
          return [{ kind: "registry", key: CHROME_KEY }];
        case "darwin":
          return [macDir(home, "Google", "Chrome")];
        case "linux":
          return [linuxDir(home, "google-chrome")];
      }
    },
  },
  brave: {
    label: "Brave",
    locations: (platform, home) => {
      switch (platform) {
        // Brave lit la clé de Chrome sous Windows (code de Chromium, sans surcharge dans Brave).
        case "win32":
          return [{ kind: "registry", key: CHROME_KEY }];
        // Sources contradictoires sous macOS : on écrit dans les deux dossiers.
        case "darwin":
          return [macDir(home, "BraveSoftware", "Brave-Browser"), macDir(home, "Google", "Chrome")];
        case "linux":
          return [linuxDir(home, "BraveSoftware", "Brave-Browser")];
      }
    },
  },
} satisfies Record<string, Browser>;

export type BrowserId = keyof typeof BROWSERS;
export const BROWSER_IDS = Object.keys(BROWSERS) as BrowserId[];

export function isBrowserId(value: string): value is BrowserId {
  return value in BROWSERS;
}

/** Emplacements à écrire, sans doublon. customProfile : profil lancé avec --user-data-dir. */
export function hostTargets(
  browsers: readonly BrowserId[],
  platform: Platform,
  home: string,
  customProfile?: string,
): HostLocation[] {
  const all: HostLocation[] = browsers.flatMap((id) => BROWSERS[id].locations(platform, home));
  if (customProfile) {
    const join = platform === "win32" ? win32.join : posix.join;
    all.push({ kind: "dir", path: join(customProfile, "NativeMessagingHosts"), root: customProfile });
  }
  const seen = new Set<string>();
  return all.filter((l) => {
    const key = l.kind === "dir" ? `dir:${l.path}` : `reg:${l.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
