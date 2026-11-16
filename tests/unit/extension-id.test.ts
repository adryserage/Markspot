import assert from "node:assert/strict";
import { test } from "node:test";
import { extensionIdFromKey } from "../../src/cli/extension-id.ts";

test("the extension id matches the one Chrome gave for a known public key", () => {
  // Clé du manifeste jusqu'à la 0.2.0 ; Chrome l'a chargée sous cet identifiant.
  const key =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApDyVvDBmDHqd0gTGvVV6HQx2wm89bu/QbTNdxqP+xCJe/zvD2rltFdOvOWBxuJdXw6Qmi43ZY1+ZJ1dXfHjYsbpw+ZeUSFGiHtx8mzoJl6KeuxqjlVLHSdFzBuILxUP52YSO4UARvPWdwUIqlneW2AqG8OUsjRUSyklPZlPOvPNRBKwfKtpTJ6NLS2SQTtYiYg5+9Mb8C7Qwcf1sndLUeNiCJHdQ/QWHPgj97TH2bT0sKG+Rm8uTpcgsDJbmOpUWDz4pL+olM9gjl3w/R7GdlUI8UvjW7RiGadTrJ9FDAspX/VHzw2O1H9K5Bc37tTgvuIYhz+DanBWFVXAvzDBcawIDAQAB";
  assert.equal(extensionIdFromKey(key), "alimncmfokmnolijpmaikdbjhgbcblle");
});
