// Dossiers de Markspot selon le système. Pur : la plateforme, l'environnement et le
// dossier personnel sont passés en paramètres, pour tester les trois systèmes partout.

import { posix, win32 } from "node:path";

export type Platform = "linux" | "darwin" | "win32";

export interface Paths {
  /** Réglages (config.json). */
  configDir: string;
  /** Notes, captures et lanceur de l'hôte. */
  dataDir: string;
}

export function pathsFor(platform: Platform, env: Record<string, string | undefined>, home: string): Paths {
  switch (platform) {
    case "win32": {
      const local = env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local");
      const dir = win32.join(local, "markspot");
      return { configDir: dir, dataDir: dir };
    }
    case "darwin": {
      const dir = posix.join(home, "Library", "Application Support", "markspot");
      return { configDir: dir, dataDir: dir };
    }
    case "linux":
      return {
        configDir: posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "markspot"),
        dataDir: posix.join(env.XDG_DATA_HOME ?? posix.join(home, ".local", "share"), "markspot"),
      };
  }
}

export function currentPlatform(): Platform {
  const platform = process.platform;
  if (platform === "win32" || platform === "darwin") return platform;
  return "linux";
}
