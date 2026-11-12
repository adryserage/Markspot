import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { Thread } from "../../src/core/model.ts";
import { FrameDecoder, encodeFrame, runHost } from "../../src/host/host.ts";
import type { HostStore, ThreadChange } from "../../src/store/store.ts";

const ORIGIN = "chrome-extension://alimncmfokmnolijpmaikdbjhgbcblle/";

function frame(message: unknown): Buffer {
  const body = Buffer.from(typeof message === "string" ? message : JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function collect(stream: PassThrough): () => unknown[] {
  const decoder = new FrameDecoder();
  const messages: unknown[] = [];
  stream.on("data", (chunk: Buffer) => {
    for (const d of decoder.push(chunk)) if (d.ok) messages.push(d.value);
  });
  return () => messages;
}

const thread = { annotation: { id: "01JD8000000000000000000001", seq: 1 }, resolution: null } as unknown as Thread;

function fakeStore(): HostStore & { emit(change: ThreadChange): void } {
  let listener: (c: ThreadChange) => void = () => {};
  return {
    list: async () => [thread],
    get: async () => thread,
    capture: async () => new Uint8Array([7, 8]),
    capturePath: () => "/tmp/x.png",
    create: async () => thread,
    editComment: async () => ({ kind: "edited", thread }),
    clearNotes: async (ids) => ids,
    watch(onChange) {
      listener = onChange;
      return { close() {} };
    },
    emit: (change) => listener(change),
  };
}

const options = (input: PassThrough, output: PassThrough, store = fakeStore()) => ({
  expectedOrigin: ORIGIN,
  origin: ORIGIN,
  version: "0.1.0",
  input,
  output,
  openStore: async () => store,
});

test("decoder joins split frames and reports invalid JSON without throwing", () => {
  const decoder = new FrameDecoder();
  const both = Buffer.concat([frame({ a: 1 }), frame("{not json")]);
  assert.deepEqual(decoder.push(both.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(both.subarray(3)), [
    { ok: true, value: { a: 1 } },
    { ok: false, error: "invalid JSON frame" },
  ]);
  assert.equal(decoder.broken, false);
});

test("encodeFrame refuses a frame over 1 MB", () => {
  assert.throws(() => encodeFrame({ type: "rejected", requestId: null, reason: "x".repeat(1024 * 1024) }), /1 MB/);
});

test("host answers each request with its requestId, in order, and survives bad frames", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const received = collect(output);
  const done = runHost(options(input, output));
  input.write(frame({ type: "ping", requestId: 1 }));
  input.write(frame("{broken"));
  input.write(frame({ type: "nope", requestId: 2 }));
  input.write(frame({ type: "sync", requestId: 3 }));
  input.write(frame({ type: "capture", requestId: 4, id: "01JD8000000000000000000001" }));
  input.end();
  assert.equal(await done, 0);
  assert.deepEqual(received(), [
    { type: "pong", requestId: 1, version: "0.1.0", node: process.version },
    { type: "rejected", requestId: null, reason: "invalid JSON frame" },
    { type: "rejected", requestId: 2, reason: "invalid message" },
    { type: "thread", thread },
    { type: "synced", requestId: 3 },
    { type: "capture", requestId: 4, png: "Bwg=" },
  ]);
});

test("host pushes changes seen in the folder", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const received = collect(output);
  const store = fakeStore();
  const done = runHost(options(input, output, store));
  await new Promise((r) => setImmediate(r));
  store.emit({ kind: "removed", id: thread.annotation.id });
  input.end();
  await done;
  assert.deepEqual(received(), [{ type: "removed", id: thread.annotation.id }]);
});

test("host rejects any other caller, exits 1 and never opens the store", async () => {
  const output = new PassThrough();
  const received = collect(output);
  let opened = false;
  const code = await runHost({
    ...options(new PassThrough(), output),
    origin: "chrome-extension://someoneelse/",
    openStore: async () => {
      opened = true;
      return fakeStore();
    },
  });
  assert.equal(code, 1);
  assert.equal(opened, false);
  assert.deepEqual(received(), [
    { type: "rejected", requestId: null, reason: "unexpected caller chrome-extension://someoneelse/" },
  ]);
});
