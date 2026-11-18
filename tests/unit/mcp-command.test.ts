import assert from "node:assert/strict";
import { test } from "node:test";
import { mcpCommandMatches, registeredMcpCommand } from "../../src/cli/install.ts";

// Sortie de `claude mcp get markspot` (Claude Code 2.1), fins de ligne Windows comprises.
const output = (command: string, args: string) =>
  [
    "markspot:",
    "  Scope: User config (available in all your projects)",
    "  Status: ✔ Connected",
    "  Type: stdio",
    `  Command: ${command}`,
    `  Args: ${args}`,
    "  Environment:",
    "",
    "To remove this server, run: claude mcp remove markspot -s user",
  ].join("\r\n");

const node = "C:\\Users\\a\\AppData\\Local\\Programs\\nodejs\\node.exe";
const npmCli = "C:\\Users\\a\\AppData\\Local\\Programs\\nodejs\\node_modules\\markspot\\dist\\cli.js";
const cloneCli = "S:\\Projets\\Markspot\\dist\\cli.js";

test("reads the registered command and arguments", () => {
  assert.deepEqual(registeredMcpCommand(output(node, `${npmCli} mcp`)), { command: node, args: `${npmCli} mcp` });
  assert.equal(registeredMcpCommand("No MCP server found with name: markspot"), null);
});

test("the same node and cli.js match; an old clone path or another node does not", () => {
  assert.equal(mcpCommandMatches(output(node, `${npmCli} mcp`), node, npmCli, true), true);
  assert.equal(mcpCommandMatches(output(node, `${cloneCli} mcp`), node, npmCli, true), false, "path left by a git clone");
  assert.equal(mcpCommandMatches(output("/usr/bin/node", `${npmCli} mcp`), node, npmCli, true), false);
  assert.equal(mcpCommandMatches(output(node, npmCli), node, npmCli, true), false, "the mcp argument is missing");
  assert.equal(mcpCommandMatches("garbled", node, npmCli, true), false);
});

test("case is ignored on Windows only; a path with spaces still compares whole", () => {
  assert.equal(mcpCommandMatches(output(node.toLowerCase(), `${npmCli} mcp`), node, npmCli, true), true);
  assert.equal(mcpCommandMatches(output("/Usr/bin/node", "/opt/cli.js mcp"), "/usr/bin/node", "/opt/cli.js", false), false);
  const spaced = "/home/a/My Tools/markspot/dist/cli.js";
  assert.equal(mcpCommandMatches(output("/usr/bin/node", `${spaced} mcp`), "/usr/bin/node", spaced, false), true);
});
