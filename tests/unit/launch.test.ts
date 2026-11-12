import assert from "node:assert/strict";
import { test } from "node:test";
import { exitCodeOf, shouldAsk } from "../../src/cli/launch.ts";

test("the question is asked only for an interactive session", () => {
  assert.equal(shouldAsk([], {}, true), true);
  assert.equal(shouldAsk(["--dangerously-skip-permissions", "corrige le bouton"], {}, true), true);
  assert.equal(shouldAsk([], {}, false), false, "not a terminal");
  for (const args of [["-p", "salut"], ["--print"], ["--version"], ["-h"], ["mcp", "list"], ["update"], ["doctor"]]) {
    assert.equal(shouldAsk(args, {}, true), false, args.join(" "));
  }
  assert.equal(shouldAsk([], { MARKSPOT_CHANNEL: "1" }, true), false, "nested call");
});

test("exit code: claude's own, or 128 + signal", () => {
  assert.equal(exitCodeOf(0, null), 0);
  assert.equal(exitCodeOf(3, null), 3);
  assert.equal(exitCodeOf(null, "SIGTERM"), 143);
  assert.equal(exitCodeOf(null, null), 1);
});
