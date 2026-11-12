// Essai de `markspot listen` construit : un envoi déposé pendant l'attente le fait sortir
// avec la note ; sans envoi, il sort au délai avec le code 2.
// Lancer : npm run build && node tests/smoke-listen.ts

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_SCOPE, STYLE_PROPS, type NewAnnotation } from "../src/core/model.ts";
import { NewAnnotationSchema } from "../src/core/schema.ts";
import { openHostStore } from "../src/store/store.ts";

function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], { env });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("exit", (code) => resolve({ code, out }));
  });
}

const home = await mkdtemp(join(tmpdir(), "markspot-listen-"));
try {
  const dataDir = join(home, "data");
  await mkdir(join(home, ".config", "markspot"), { recursive: true });
  await writeFile(join(home, ".config", "markspot", "config.json"), JSON.stringify({ dataDir }));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, "share") };

  const store = await openHostStore({ dataDir, scope: LOCAL_SCOPE });
  const rect = { x: 1, y: 2, width: 3, height: 4 };
  const note = NewAnnotationSchema.parse({
    id: "01JD8000000000000000000009",
    scope: "local",
    createdAt: "2026-11-12T08:15:00.000Z",
    author: { kind: "user", id: "local", name: "local" },
    source: { kind: "extension", trust: "owner" },
    page: { url: "http://localhost:3000/prix", title: "Prix" },
    mark: {
      kind: "element",
      anchor: { selector: "#acheter", tag: "button", role: null, text: "Acheter", attributes: {}, styles: Object.fromEntries(STYLE_PROPS.map((p) => [p, ""])) },
      rect,
      rectInAnchor: rect,
    },
    viewport: { width: 1000, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    comment: "Le bouton déborde",
    captures: { zone: { rect, width: 3, height: 4 }, context: { rect, width: 10, height: 8 } },
  }) as unknown as NewAnnotation;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await store.create(note, { zone: png, context: png });

  const listening = run(["listen", "--url", "http://localhost:3000", "--timeout", "30"], env);
  await new Promise((r) => setTimeout(r, 1500));
  const { listeners } = await store.send([note.id], "http://localhost:3000/prix");
  assert.equal(listeners, 1, "the host should see one listening session");
  const got = await listening;
  assert.equal(got.code, 0, got.out);
  assert.match(got.out, /01JD8000000000000000000009/);
  assert.match(got.out, /Le bouton déborde/);
  assert.doesNotMatch(got.out, /#acheter|\/prix/, "no page data in the summary");

  const quiet = await run(["listen", "--timeout", "5"], env);
  assert.equal(quiet.code, 2);
  console.error("listen smoke test passed");
} finally {
  await rm(home, { recursive: true, force: true });
}
