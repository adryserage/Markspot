import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExport, exportFileName } from "../../src/core/export.ts";
import type { Annotation } from "../../src/core/model.ts";

const note = (seq: number) => ({ id: `id${seq}`, seq, comment: `note ${seq}` }) as unknown as Annotation;

test("buildExport sorts by pin number and attaches both captures, null when missing", () => {
  const file = buildExport(
    [note(2), note(1)],
    (a, kind) => (a.seq === 2 && kind === "context" ? null : `${a.id}-${kind}`),
    new Date("2026-11-12T08:15:00Z"),
  );
  assert.equal(file.format, "markspot-export");
  assert.equal(file.exportedAt, "2026-11-12T08:15:00.000Z");
  assert.deepEqual(file.annotations.map((a) => a.seq), [1, 2]);
  assert.deepEqual(file.annotations[0]?.png, { zone: "id1-zone", context: "id1-context" });
  assert.deepEqual(file.annotations[1]?.png, { zone: "id2-zone", context: null });
});

test("exportFileName uses local time and no character Windows refuses", () => {
  const name = exportFileName(new Date(2026, 10, 12, 8, 5));
  assert.equal(name, "markspot-notes-2026-11-12-0805.json");
  assert.doesNotMatch(name, /[<>:"/\\|?*]/);
});
