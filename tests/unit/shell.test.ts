import assert from "node:assert/strict";
import { test } from "node:test";
import { BEGIN, END, hasBlock, psBlock, psQuote, rcTargets, removeBlock, shBlock, upsertBlock } from "../../src/cli/shell.ts";

const block = shBlock("/home/jo/.local/share/markspot/bin/markspot");

test("the block is added once, replaced in place, and removed leaving the rest byte for byte", () => {
  const original = "export PATH=$HOME/bin:$PATH\nalias ll='ls -l'\n";
  const once = upsertBlock(original, block);
  assert.ok(hasBlock(once, block));
  assert.equal(upsertBlock(once, block), once, "idempotent");
  const newer = shBlock("/opt/markspot");
  const replaced = upsertBlock(once, newer);
  assert.equal(replaced.split(BEGIN).length, 2, "never two blocks");
  assert.ok(hasBlock(replaced, newer) && !hasBlock(replaced, block));
  assert.equal(removeBlock(once), original);
  assert.equal(removeBlock(original), original, "nothing to remove");
  assert.equal(upsertBlock("", block), `${block.join("\n")}\n`, "a new file holds only the block");
});

test("a Windows profile keeps its BOM and CRLF line endings", () => {
  const original = "\uFEFF# profil\r\nImport-Module PSReadLine\r\n";
  const ps = psBlock("C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\Jean D'Arc\\markspot\\dist\\cli.js");
  const once = upsertBlock(original, ps);
  assert.ok(once.startsWith("\uFEFF"));
  assert.ok(!once.replaceAll("\r\n", "").includes("\n"), "CRLF everywhere");
  assert.ok(hasBlock(once, ps));
  assert.equal(removeBlock(once), original);
  assert.ok(ps.every((line) => /^[\x20-\x7e]*$/.test(line)), "ASCII only, for PowerShell 5.1 without BOM");
});

test("paths are quoted for sh and PowerShell", () => {
  assert.ok(shBlock("/home/o'brien/bin/markspot").some((l) => l.includes(`'/home/o'\\''brien/bin/markspot'`)));
  assert.equal(psQuote("C:\\Users\\Jean D'Arc"), "'C:\\Users\\Jean D''Arc'");
  assert.equal(block[0], BEGIN);
  assert.equal(block.at(-1), END);
});

test("rcTargets: existing rc files plus the one of $SHELL; nothing on Windows", () => {
  const has = (files: string[]) => (p: string) => files.includes(p);
  assert.deepEqual(rcTargets("linux", "/home/jo", { SHELL: "/bin/zsh" }, has(["/home/jo/.bashrc"])), ["/home/jo/.bashrc", "/home/jo/.zshrc"]);
  assert.deepEqual(rcTargets("darwin", "/Users/jo", { SHELL: "/bin/zsh" }, has([])), ["/Users/jo/.zshrc"]);
  assert.deepEqual(rcTargets("darwin", "/Users/jo", { SHELL: "/bin/bash" }, has([])), ["/Users/jo/.bash_profile"]);
  assert.deepEqual(rcTargets("linux", "/home/jo", { SHELL: "/usr/bin/fish", ZDOTDIR: "/home/jo/.config/zsh" }, has(["/home/jo/.config/zsh/.zshrc"])), [
    "/home/jo/.config/zsh/.zshrc",
  ]);
  assert.deepEqual(rcTargets("win32", "C:\\Users\\jo", {}, () => true), []);
});
