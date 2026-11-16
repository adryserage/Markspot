// Identifiant Chrome d'une extension à partir de la clé publique du manifeste (champ « key ») :
// sha256 de la clé DER, 32 premiers chiffres hexadécimaux transposés en a-p.

import { createHash } from "node:crypto";

export function extensionIdFromKey(base64Key: string): string {
  return createHash("sha256")
    .update(Buffer.from(base64Key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}
