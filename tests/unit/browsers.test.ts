import assert from "node:assert/strict";
import { test } from "node:test";
import { hostTargets } from "../../src/cli/browsers.ts";
import { launcherFor } from "../../src/cli/launcher.ts";
import { pathsFor } from "../../src/core/paths.ts";

test("Windows: Chrome and Brave share one registry key", () => {
  const targets = hostTargets(["chrome", "brave"], "win32", "C:\\Users\\ada");
  assert.deepEqual(targets, [
    { kind: "registry", key: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.markspot.host" },
  ]);
});

test("macOS: Brave writes its own folder and Chrome's, without duplicates", () => {
  const targets = hostTargets(["chrome", "brave"], "darwin", "/Users/ada");
  assert.deepEqual(
    targets.map((t) => (t.kind === "dir" ? t.path : t.key)),
    [
      "/Users/ada/Library/Application Support/Google/Chrome/NativeMessagingHosts",
      "/Users/ada/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    ],
  );
});

test("Linux: each browser has its folder, plus a custom profile", () => {
  const targets = hostTargets(["chrome", "brave"], "linux", "/home/ada", "/home/ada/.config/chrome-claude");
  assert.deepEqual(
    targets.map((t) => (t.kind === "dir" ? t.path : t.key)),
    [
      "/home/ada/.config/google-chrome/NativeMessagingHosts",
      "/home/ada/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
      "/home/ada/.config/chrome-claude/NativeMessagingHosts",
    ],
  );
});

test("data folders per system", () => {
  assert.equal(pathsFor("win32", { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, "C:\\Users\\ada").dataDir, "C:\\Users\\ada\\AppData\\Local\\markspot");
  assert.equal(pathsFor("darwin", {}, "/Users/ada").dataDir, "/Users/ada/Library/Application Support/markspot");
  assert.equal(pathsFor("linux", {}, "/home/ada").dataDir, "/home/ada/.local/share/markspot");
  assert.equal(pathsFor("linux", { XDG_CONFIG_HOME: "/x" }, "/home/ada").configDir, "/x/markspot");
});

test("Windows launcher: CRLF, quoted paths, percent doubled", () => {
  const bat = launcherFor("win32", "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\ada\\100%\\cli.js");
  assert.equal(bat.fileName, "markspot-host.bat");
  assert.equal(bat.content, '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\ada\\100%%\\cli.js" host %*\r\n');
});

test("sh launcher: spaces, dollar and apostrophe stay literal", () => {
  const sh = launcherFor("darwin", "/opt/my node/bin/node", "/Users/l'ada/$HOME/cli.js");
  assert.equal(sh.content, `#!/bin/sh\nexec '/opt/my node/bin/node' '/Users/l'\\''ada/$HOME/cli.js' host "$@"\n`);
});
