# Markspot

Français : [README.fr.md](README.fr.md)

Markspot lets you mark a spot on a web page and leave a note about it. Claude Code reads the note, fixes the code, checks the result in the browser and answers on the page, next to your note.

Every feature is described in the [feature guide](docs/features.md).

## Status

Version 0.1. Markspot works with Chrome and Brave on Linux and Windows. The install on macOS has not been tried on a real machine yet.

The whole loop works: you annotate in the browser, Claude Code reads the note with its two screenshots, fixes the code, then resolves the note, and the pin on the page turns to "Resolved" with Claude's reply.

## Install

You need Node 22.18 or later and Claude Code.

```sh
npm install -g markspot
markspot install
```

`install` cannot load the extension in your browser by itself, so it ends with a "to do" line that names the extension folder. That folder is `extension` inside the installed package, which is `$(npm root -g)/markspot/extension`. Load it once:

1. Open `chrome://extensions` (or `brave://extensions`) and turn on developer mode.
2. Click "Load unpacked" and choose that folder.
3. Open a new terminal, so that your shell picks up the `claude` function that `install` added.
4. Open a web page and press Alt+C. The extension connects to the local program.
5. Run `markspot doctor` to check every step.

If Alt+C does nothing, set the shortcut in `chrome://extensions/shortcuts`.

### From source

```sh
git clone https://github.com/adryserage/Markspot
cd Markspot
npm install
npm run build
node dist/cli.js install
```

Then load the `extension/` folder of the repository as above. From a clone, `node dist/cli.js` stands in for `markspot` in every command of this page.

### What install does

`install` runs these steps in order:

1. Settings: writes `config.json` with the options you passed.
2. Dispatch key: creates the key that signs "Send to Claude" dispatches (see [Two machines, one notes folder](#two-machines-one-notes-folder)). It never replaces an existing key.
3. Host launcher: a small script that starts the local program with the full path of Node, because a browser started from a menu does not always have your shell's `PATH`.
4. Markspot command: a second launcher, `markspot`, that Claude Code sessions use to run `markspot listen`.
5. Host manifest for each browser: on Linux and macOS, a file in the browser's `NativeMessagingHosts` folder (a browser that is not installed is skipped); on Windows, a registry key that Chrome and Brave share.
6. Extension: with `--cdp`, `install` loads the extension in that Chrome itself. Otherwise this step is the "to do" line above, and it counts as done once the extension has connected to the local program.
7. Shell: a `claude` function in your shell startup files (`~/.zshrc`, `~/.bashrc`, and on Windows the PowerShell profiles), between a `# >>> markspot >>>` line and a `# <<< markspot <<<` line. Each Claude Code session you start with `claude` can then listen to Markspot (see [Automatic wake-up](#automatic-wake-up-research-preview)). Fish and cmd.exe are not supported.
8. MCP server: `claude mcp add --scope user markspot`.
9. Skill: a link from `~/.claude/skills/markspot` to the skill in the package.

You can run `install` again: a step that is already done is not redone. `markspot uninstall` undoes every step, and `markspot doctor` checks each one, then checks that the notes folder is writable.

### Options

- `--browser chrome`, `--browser brave`, `--browser chrome,brave` or `--browser all` (the default).
- `--chrome-profile <folder>` for a Chrome started with `--user-data-dir`.
- `--cdp http://127.0.0.1:9222` for a Chrome started with a debugging port: `install` loads the extension there, and `doctor` checks the round trip between the extension and the local program.
- `--data-dir <absolute path>` to keep the notes in another folder, for example a network share.
- `--key-file <file>` to use the dispatch key of your other machine.
- `--no-shell` leaves your shell startup files alone. `--shell` adds the `claude` function again after an earlier `--no-shell`.

`install` keeps these options in `config.json`, so the next `install`, `doctor` or `uninstall` reuses them.

## How it works

1. In the browser, press Alt+C (or click the Markspot icon), click an element or drag over an area, then write your comment.
2. Markspot keeps the page address, the element (selector, visible text, useful attributes, computed styles), the screen size and two screenshots: a close-up of the area and the whole screen with the area framed.
3. The comment box opens on the screenshot. You can draw on it (arrow, rectangle, pen) to show what is wrong.
4. In Claude Code, say "fix my annotations". Claude reads each note with its screenshots, finds the source file, fixes it and checks the result in the browser.
5. On the page, the pin turns to "Resolved" and shows Claude's reply.

Three parts do the work:

- a Chrome extension (Manifest V3);
- a local program, `markspot host`, that the browser starts itself through native messaging. It is the only part that writes notes, and it opens no network port;
- an MCP server, `markspot mcp`, that each Claude Code session starts to read and resolve notes.

Notes are JSON and PNG files in `~/.local/share/markspot` on Linux, `~/Library/Application Support/markspot` on macOS and `%LOCALAPPDATA%\markspot` on Windows.

A note shows "Pending" until the local program has received it, for example when Markspot is not installed on this computer yet. Pending notes leave on their own at the next connection.

## Sending notes to Claude

On the page, the "Send to Claude" button sends the open notes to a Claude Code session. The "Send to" picker lists the sessions that are listening, by project name (the name of the session's folder). The choice is kept per site, and "Refresh" reloads the list. A dispatch waits up to 24 hours for the chosen session to listen.

A session listens in one of two ways.

### Listen mode (default)

Tell the session "listen to my annotations". Claude runs `markspot listen --name <project>` as a background command. Waiting costs nothing, and the command exits when notes arrive. Claude fixes them, then starts listening again. You need to say it again in each new session.

If Claude waits with the `markspot_wait_for_annotations` tool instead of the command, the session also shows in "Send to", while it waits and for 10 minutes after.

### Automatic wake-up (research preview)

After `install`, there is nothing to remember. When you start `claude` in a terminal, Markspot asks:

```text
Should Markspot listen to this session? [y/N] (no in 5 s)
```

`y` (or `o`) starts Claude with Markspot. Enter, any other key or no answer for 5 seconds starts Claude without it, and Ctrl+C starts nothing. The question is in French when your terminal locale starts with `fr`.

- The question is skipped when a session already listens to this project (same folder name) on this computer. The new session then starts without Markspot.
- `claude -p`, `claude mcp …`, `claude --version` and scripts are left alone.
- Your options reach `claude` unchanged, your permission mode included.
- To start Claude without this function, run `command claude` (sh, zsh), or install with `--no-shell`.

You can also start Claude Code with `markspot claude` instead of `claude`. The options that follow go to `claude`. Because the session wakes up without you, `markspot claude` starts it with `--permission-mode default` (Claude asks before each command), unless you choose a mode yourself with `--permission-mode` or `--dangerously-skip-permissions`.

Either way, the session shows in "Send to" on its own, even when idle, and wakes up when you send notes. It does not need `markspot listen`.

This uses Claude Code channels, which are a research preview. For a server that is not an Anthropic-approved plugin, Claude Code opens channels only with the `--dangerously-load-development-channels server:markspot` flag, which Markspot adds for you:

- at startup, Claude Code shows a warning and asks you to confirm "I am using this for local development";
- the flag is meant for development, so its form can change from one Claude Code version to the next;
- the regular `--channels` flag only accepts Anthropic-approved plugins. Markspot is not one, which is why listen mode stays the default;
- channels need an interactive session (not `claude -p`) and a claude.ai login or a Console key. In a Team or Enterprise organization, an admin has to turn channels on.

The message pushed into the session holds only the number, id and comment of each note. Claude reads the page data and the screenshots with `markspot_get_annotation`, as in listen mode.

Claude Code does not confirm that it received the message, so the dispatch stays pending until Claude opens one of its notes. If nothing happens for 2 minutes (warning declined, channels turned off by an admin), the dispatch goes back in the queue and the session leaves "Send to" until its next tool call. Tell the session "listen to my annotations" and `markspot listen` picks up the dispatch.

## Language

The extension is in English by default and also in French. Right-click the Markspot toolbar icon, then "Language": "Auto (browser language)" uses French when the browser is in French and English otherwise, and "English" and "Français" set the language. The choice is kept in the browser.

The question that `claude` asks at startup follows the terminal locale (`LC_ALL`, `LC_MESSAGES`, then `LANG`).

## Two machines, one notes folder

To annotate on one computer and let Claude Code fix the notes from another, both read the same notes folder over the network. Share only that folder (for example a Samba share `markspot-notes` whose path is `~/.local/share/markspot`). On the computer that does not hold the folder, install with `--data-dir` and an absolute path to the share, for example on Windows:

```sh
markspot install --data-dir \\server\markspot-notes
```

The launchers and the host manifest stay on each computer. Only the notes go through the share.

Both computers sign their "Send to Claude" dispatches with the same key. A session only accepts dispatches that are signed, less than 25 hours old and never seen before, so that a file dropped or copied on the share cannot wake it up. `install` creates the key on the first computer. Copy it once to the second:

1. On the first computer, `markspot key` prints the key. Save it to a file (on a USB stick, for example).
2. On the second, run `markspot install --key-file <that file>`, then delete the file.

The key is kept outside the notes folder: `~/.config/markspot/dispatch.key` on Linux, `~/Library/Application Support/markspot-key/dispatch.key` on macOS and `%LOCALAPPDATA%\markspot-key\dispatch.key` on Windows. Share only the notes folder, never your whole home folder: the key would go through the share too, and anyone who can write to it could forge a dispatch.

## Adding a browser

Chromium-based browsers (Edge, Vivaldi, Arc…) are declared in `src/cli/browsers.ts`: one entry that says where the browser looks for the local program on each system. `install`, `uninstall` and `doctor` pick it up on their own. Add its test to `tests/unit/browsers.test.ts`.

## Privacy and security

- Markspot itself sends nothing outside your computer. It has no telemetry and no server. Notes and screenshots reach the model only through your own Claude Code session, when it reads them.
- No process listens on the network. The browser only lets the Markspot extension, recognized by its fixed id, talk to the local program.
- Screenshots are not masked yet ([issue #22](https://github.com/adryserage/Markspot/issues/22)). Whatever the screen shows at capture time (a password shown in clear, a token) goes into the image and on to the model. The preview in the comment box lets you cancel. Text typed in form fields is never stored in the note's data.
- On third-party sites, the page's own scripts can read what you type in the comment box ([issue #23](https://github.com/adryserage/Markspot/issues/23)).
- On a site in development (Vue, Svelte, React), the note keeps the component name and its source file path as the build tool reports it. That path can contain your user name. It stays in the notes folder and in exports.
- On macOS and Linux, files are created with mode 0600 and folders with 0700. On a network share, the share's permissions apply: anyone who can write to it can drop a note. Claude treats every comment as a request to evaluate.
- The dispatch key signs "Send to Claude" dispatches. Keep it secret, and keep it out of any shared folder (see [Two machines, one notes folder](#two-machines-one-notes-folder)).

## Development

```sh
npm install
npm run build       # dist/cli.js and extension/dist/
npm run typecheck   # tsc --noEmit
npm test            # unit tests (node --test)
npm run smoke       # the built MCP server and markspot listen
npm run e2e         # end-to-end tests on a dedicated Chrome with CDP on 127.0.0.1:9223
npm run e2e:real    # a real Claude Code session end to end (costs a few turns)
```

`npm run e2e` does not build: run `npm run build` first. Set `MARKSPOT_CDP` to use another debugging port.

The design notes are in [docs/conception.md](docs/conception.md) (in French).

## License

Apache 2.0. See the LICENSE and NOTICE files (the Atkinson Hyperlegible fonts are under the SIL OFL 1.1 license).
