// Messages entre l'extension et l'hôte natif.
// Trames JSON précédées de leur longueur sur 4 octets little-endian (format de Chrome).
// Chrome refuse un message de plus de 1 Mo de l'hôte vers l'extension.

export const HOST_NAME = "com.markspot.host";
export const MAX_FRAME_TO_EXTENSION = 1024 * 1024;
export const MAX_FRAME_TO_HOST = 64 * 1024 * 1024;

export type ExtensionToHost = { type: "ping" };

export type HostToExtension =
  | { type: "pong"; version: string; node: string }
  | { type: "rejected"; reason: string };

/** Frontière côté hôte : la trame vient d'un processus qu'on ne contrôle pas. */
export function parseExtensionMessage(raw: unknown): ExtensionToHost | null {
  if (typeof raw !== "object" || raw === null) return null;
  const type = (raw as { type?: unknown }).type;
  if (type === "ping") return { type: "ping" };
  return null;
}
