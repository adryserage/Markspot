import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { removeLeftovers } from "../../src/cli/install.ts";

async function file(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "x");
}

test("uninstall removes the notes and Markspot's folders, keeps foreign files and a shared notes folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "markspot-uninstall-"));
  try {
    // Disposition Linux : config et clé d'envoi dans ~/.config/markspot, notes ailleurs.
    const configDir = join(root, "config", "markspot");
    const dataDir = join(root, "share", "markspot");
    const shared = join(root, "share-network", "notes");
    await file(join(dataDir, "local", "01J", "annotation.json"));
    await file(join(dataDir, "host-status.json"));
    await file(join(configDir, "dispatch-consumed", "abc"));
    await file(join(configDir, "extension-key.pem"));
    await file(join(shared, "local", "01K", "annotation.json"));

    const lines: string[] = [];
    await removeLeftovers({ configDir, dataDir, keyFile: join(configDir, "dispatch.key") }, shared, (l) => lines.push(l));

    assert.equal(existsSync(dataDir), false, "the notes folder is gone");
    assert.equal(existsSync(join(configDir, "dispatch-consumed")), false, "consumed dispatches are gone");
    assert.equal(existsSync(join(configDir, "extension-key.pem")), true, "a file Markspot did not create stays");
    assert.equal(existsSync(join(shared, "local", "01K", "annotation.json")), true, "a --data-dir folder stays");
    assert.ok(lines.some((l) => l.startsWith("kept") && l.includes(shared)), "the kept shared folder is reported");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall leaves nothing behind when the folders hold only Markspot files", async () => {
  const root = await mkdtemp(join(tmpdir(), "markspot-uninstall-"));
  try {
    // Disposition Windows : config et notes dans le même dossier, clé dans un dossier voisin.
    const dir = join(root, "markspot");
    const keyDir = join(root, "markspot-key");
    await file(join(dir, "config.json"));
    await file(join(dir, "local", "01J", "zone.png"));
    await file(join(keyDir, "dispatch-consumed", "abc"));

    await removeLeftovers({ configDir: dir, dataDir: dir, keyFile: join(keyDir, "dispatch.key") }, undefined, () => {});

    assert.equal(existsSync(dir), false);
    assert.equal(existsSync(keyDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
