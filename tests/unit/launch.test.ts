import assert from "node:assert/strict";
import { test } from "node:test";
import { answerFor, exitCodeOf, promptText, shouldAsk, terminalLocale } from "../../src/cli/launch.ts";

test("only o or y starts the listening session; Enter and other keys say no", () => {
  for (const key of ["o", "O", "y", "Y", "oui", "yes"]) assert.equal(answerFor(key), true, key);
  for (const key of ["\r", "\n", " ", "n", "N", "x", "\u001b"]) assert.equal(answerFor(key), false, JSON.stringify(key));
  assert.equal(answerFor("\u0003"), null, "Ctrl+C");
});

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

test("the question is in English by default, in French for a fr locale", () => {
  assert.deepEqual(promptText("en_US.UTF-8"), {
    question: "Should Markspot listen to this session? [y/N] (no in 5 s) ",
    yes: "yes",
    no: "no",
  });
  assert.deepEqual(promptText("fr_CA.UTF-8"), { question: "Markspot écoute cette session ? [o/N] (non dans 5 s) ", yes: "oui", no: "non" });
  assert.equal(promptText("fr-FR").yes, "oui");
  assert.equal(promptText("FR").yes, "oui");
  for (const locale of ["C", "C.UTF-8", "POSIX", "de_DE", ""]) assert.equal(promptText(locale).yes, "yes", locale);
});

test("the locale comes from LC_ALL, LC_MESSAGES, LANG (first non-empty), else Intl", () => {
  assert.equal(terminalLocale({ LC_ALL: "fr_FR.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" }, "en"), "fr_FR.UTF-8");
  assert.equal(terminalLocale({ LC_ALL: "", LC_MESSAGES: "fr_CA", LANG: "en_US" }, "en"), "fr_CA");
  assert.equal(terminalLocale({ LANG: "fr_BE.UTF-8" }, "en"), "fr_BE.UTF-8");
  assert.equal(terminalLocale({}, "fr-CA"), "fr-CA");
});
