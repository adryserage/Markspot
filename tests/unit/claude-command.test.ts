import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeCommand, cmdQuote, findClaude, withPermissionMode, type Probe } from "../../src/cli/claude-command.ts";

const win = (files: string[], env: Probe["env"]): Probe => {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return { platform: "win32", env, isFile: (p) => set.has(p.toLowerCase()) };
};

test("findClaude walks PATH in order, prefers .exe over .cmd in a folder, never the current folder", () => {
  const probe = win(["C:\\a\\claude.cmd", "C:\\a\\claude.exe", "C:\\b\\claude.exe", "claude.cmd"], {
    PATH: '.;relative\\bin;"C:\\a";C:\\b',
  });
  assert.equal(findClaude(probe), "C:\\a\\claude.exe");
  assert.equal(findClaude(win(["C:\\b\\claude.exe"], { PATH: "C:\\a;C:\\b" })), "C:\\b\\claude.exe");
  assert.equal(findClaude(win(["C:\\a\\claude.cmd"], { PATH: "C:\\a", PATHEXT: ".com;.cmd" })), "C:\\a\\claude.cmd");
});

test("findClaude falls back to the native install, then gives null", () => {
  const native = "C:\\Users\\Jean Dupont\\.local\\bin\\claude.exe";
  assert.equal(findClaude(win([native], { PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\Jean Dupont" })), native);
  assert.equal(findClaude(win([], { PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\x" })), null);
});

test("an .exe keeps its argv untouched, even with spaces", () => {
  const exe = "C:\\Users\\Jean Dupont\\.local\\bin\\claude.exe";
  const args = ["mcp", "add", "--", "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Jean Dupont\\Markspot\\dist\\cli.js", "mcp"];
  assert.deepEqual(claudeCommand(args, win([exe], { USERPROFILE: "C:\\Users\\Jean Dupont" })), { file: exe, args, verbatim: false });
});

test("a .cmd goes through cmd.exe with every argument quoted", () => {
  const shim = "C:\\Users\\Jean Dupont\\AppData\\Roaming\\npm\\claude.cmd";
  const command = claudeCommand(["mcp", "add", "--", "C:\\Program Files\\nodejs\\node.exe", "C:\\a b\\cli.js", "mcp"], win([shim], { PATH: "C:\\Users\\Jean Dupont\\AppData\\Roaming\\npm", ComSpec: "C:\\Windows\\system32\\cmd.exe" }));
  assert.deepEqual(command, {
    file: "C:\\Windows\\system32\\cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", `""${shim}" "mcp" "add" "--" "C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\cli.js" "mcp""`],
    verbatim: true,
  });
});

test("cmdQuote doubles a trailing backslash, keeps & and parentheses, refuses what cmd rewrites", () => {
  assert.equal(cmdQuote("C:\\dir\\"), '"C:\\dir\\\\"');
  assert.equal(cmdQuote("a & (b)"), '"a & (b)"');
  for (const bad of ['say "hi"', "100%", "wow!", "a\nb"]) assert.throws(() => cmdQuote(bad));
});

test("other systems run claude from PATH as before", () => {
  assert.deepEqual(claudeCommand(["--version"], { platform: "linux", env: {}, isFile: () => false }), {
    file: "claude",
    args: ["--version"],
    verbatim: false,
  });
});

test("markspot claude asks for permission by default, unless the person chose a mode", () => {
  assert.deepEqual(withPermissionMode(["--model", "haiku"]), ["--permission-mode", "default", "--model", "haiku"]);
  for (const own of [["--permission-mode", "plan"], ["--permission-mode=acceptEdits"], ["--dangerously-skip-permissions"]]) {
    assert.deepEqual(withPermissionMode(own), own);
  }
});
