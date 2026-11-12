// Dossiers de Markspot selon le système. Pur : la plateforme, l'environnement et le
// dossier personnel sont passés en paramètres, pour tester les trois systèmes partout.

import { posix, win32 } from "node:path";

export type Platform = "linux" | "darwin" | "win32";

export interface Paths {
  /** Réglages (config.json). */
  configDir: string;
  /** Notes, captures et lanceur de l'hôte. */
  dataDir: string;
  /**
   * Clé qui signe les envois « Envoyer à Claude ». Jamais dans le dossier des notes, qui peut
   * être partagé : sous Windows et macOS, dans un dossier voisin.
   */
  keyFile: string;
}

/** La liste des envois déjà transmis par ce poste, à côté de la clé (hors du partage). */
export const consumedFileOf = (keyFile: string) => keyFile.replace(/dispatch\.key$/, "dispatch-consumed.json");

export function pathsFor(platform: Platform, env: Record<string, string | undefined>, home: string): Paths {
  switch (platform) {
    case "win32": {
      const local = env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local");
      const dir = win32.join(local, "markspot");
      return { configDir: dir, dataDir: dir, keyFile: win32.join(local, "markspot-key", "dispatch.key") };
    }
    case "darwin": {
      const support = posix.join(home, "Library", "Application Support");
      const dir = posix.join(support, "markspot");
      return { configDir: dir, dataDir: dir, keyFile: posix.join(support, "markspot-key", "dispatch.key") };
    }
    case "linux": {
      const configDir = posix.join(env.XDG_CONFIG_HOME ?? posix.join(home, ".config"), "markspot");
      return {
        configDir,
        dataDir: posix.join(env.XDG_DATA_HOME ?? posix.join(home, ".local", "share"), "markspot"),
        keyFile: posix.join(configDir, "dispatch.key"),
      };
    }
  }
}

export function currentPlatform(): Platform {
  const platform = process.platform;
  if (platform === "win32" || platform === "darwin") return platform;
  return "linux";
}
