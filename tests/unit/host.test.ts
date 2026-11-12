import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { FrameDecoder, encodeFrame, runHost } from "../../src/host/host.ts";

const ORIGIN = "chrome-extension://alimncmfokmnolijpmaikdbjhgbcblle/";

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function collect(stream: PassThrough): () => unknown[] {
  const decoder = new FrameDecoder();
  const messages: unknown[] = [];
  stream.on("data", (chunk: Buffer) => messages.push(...decoder.push(chunk)));
  return () => messages;
}

test("decoder joins a frame split across chunks and splits two frames in one chunk", () => {
  const decoder = new FrameDecoder();
  const both = Buffer.concat([frame({ a: 1 }), frame({ b: "é".repeat(1000) })]);
  assert.deepEqual(decoder.push(both.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(both.subarray(3, 12)), [{ a: 1 }]);
  assert.deepEqual(decoder.push(both.subarray(12)), [{ b: "é".repeat(1000) }]);
});

test("encodeFrame refuses a frame over 1 MB", () => {
  assert.throws(() => encodeFrame({ type: "rejected", reason: "x".repeat(1024 * 1024) }), /1 MB/);
});

test("host answers ping with pong for the expected origin", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const received = collect(output);
  const done = runHost({ expectedOrigin: ORIGIN, origin: ORIGIN, version: "0.1.0", input, output });
  input.write(frame({ type: "ping" }));
  input.write(frame({ type: "nope" }));
  input.end();
  assert.equal(await done, 0);
  assert.deepEqual(received(), [
    { type: "pong", version: "0.1.0", node: process.version },
    { type: "rejected", reason: "unknown message" },
  ]);
});

test("host rejects any other caller and exits 1", async () => {
  const output = new PassThrough();
  const received = collect(output);
  const code = await runHost({
    expectedOrigin: ORIGIN,
    origin: "chrome-extension://someoneelse/",
    version: "0.1.0",
    input: new PassThrough(),
    output,
  });
  assert.equal(code, 1);
  assert.deepEqual(received(), [{ type: "rejected", reason: "unexpected caller chrome-extension://someoneelse/" }]);
});
