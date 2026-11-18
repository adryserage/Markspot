# Changelog

Français : [CHANGELOG.fr.md](CHANGELOG.fr.md)

## 0.5.0 (2026-11-18)

### Added

- Claude Desktop can review a site and send its notes to one of your Claude Code sessions. Turn on "Claude Desktop can send notes" in the right-click menu of the toolbar icon (off by default), then add the Markspot MCP server to Claude Desktop. Claude Desktop gets three tools: `markspot_list_sessions`, `markspot_create_annotation` and `markspot_send`. It asks which session gets the notes, shows the prepared notes as a numbered list, sends only the numbers you confirm, then reads the replies and checks the page again. The option is saved in the notes folder, in `features.json`.
- A note from Claude Desktop shows "From Claude Desktop" in its card and in the notes menu, and Claude Code reads it as a suggestion from Claude Desktop. Such a note can have no screenshot. Every computer that shares the notes folder needs Markspot 0.5.0 or later to read these notes.

### Fixed

- Right after Chrome woke the extension up, "Send to Claude" could answer "Not sent: no open note received by the local program" and the page could show fewer pins, because the extension had not reloaded its notes from the local program yet. It now waits for that reload, up to 3 seconds.
- `markspot install` kept the MCP server registered in Claude Code with an old path, for example after a move from a git clone to the npm package. Deleting the clone then broke Claude Code ("Couldn't reconnect to markspot"). `install` now compares the registered Node and `cli.js` with the current ones and registers the server again when they differ, and `markspot doctor` shows the step as missing.

## 0.4.0 (2026-11-17)

### Added

- An "Automatic wake-up" submenu in the right-click menu of the toolbar icon, with "Ask each time", "Always" and "Never". It sets whether `claude` asks "Should Markspot listen to this session?", starts with Markspot or starts without it. The choice is saved in the notes folder, so two computers that share that folder follow the same choice. The submenu shows only while the extension is connected to the local program. ([#29](https://github.com/adryserage/Markspot/pull/29))
- The extension is on the [Chrome Web Store](https://chromewebstore.google.com/detail/okaabbekcogbhighojhlcbmdohahonie). The "to do" line of `markspot install` links to it, and still gives the package's extension folder for betas. ([#31](https://github.com/adryserage/Markspot/pull/31))
- An animated demo at the top of both READMEs. ([#31](https://github.com/adryserage/Markspot/pull/31))
- For maintainers, scripts that make the Chrome Web Store screenshots and the demo video, in English and French. ([#30](https://github.com/adryserage/Markspot/pull/30))

### Changed

- The READMEs install the extension from the Chrome Web Store, which keeps it up to date, and explain how to replace a copy loaded with "Load unpacked". ([#31](https://github.com/adryserage/Markspot/pull/31))

### Fixed

- When Node comes from mise, the launchers used the exact Node version and stayed on it after mise updated Node. They now use the folder of Node's major version, which mise keeps up to date. After a new major version of Node, run `markspot install` again. ([#32](https://github.com/adryserage/Markspot/pull/32))

## 0.3.0 (2026-11-16)

### Changed

- The extension takes the id it has on the Chrome Web Store. The old extension can no longer talk to the local program, so reload it once: run `markspot install`, remove the old extension in `chrome://extensions`, then load `$(npm root -g)/markspot/extension` with "Load unpacked". Your notes stay in place. ([#27](https://github.com/adryserage/Markspot/pull/27))
- `markspot uninstall` also deletes the notes, the consumed dispatches and Markspot's folders. A notes folder chosen with `--data-dir` stays, since another computer may use it. Do not use `uninstall` to update. ([#26](https://github.com/adryserage/Markspot/pull/26))

### Added

- Icons in the toolbar and in `chrome://extensions`. ([#26](https://github.com/adryserage/Markspot/pull/26))
- A privacy policy, [PRIVACY.md](PRIVACY.md). ([#26](https://github.com/adryserage/Markspot/pull/26))
- A README section on updating a computer. ([#28](https://github.com/adryserage/Markspot/pull/28))

## 0.2.0 (2026-11-14)

### Changed

- The question that `claude` asks at startup now answers no by default: "Should Markspot listen to this session? [y/N] (no in 5 s)". Type `y` (or `o`) for Markspot to listen to the session. Enter, any other key or 5 seconds without an answer starts Claude without Markspot. ([#25](https://github.com/adryserage/Markspot/pull/25))

## 0.1.0 (2026-11-13)

First public release.

### Added

- Annotation mode in Chrome and Brave. Press Alt+C, click an element or drag over an area, write a comment and draw on the screenshot (arrow, rectangle, pen).
- Each note keeps the page address, the element (selector, visible text, attributes, computed styles) and two screenshots. On Vue, Svelte and React development builds, it also keeps the component and its source file. ([#15](https://github.com/adryserage/Markspot/pull/15))
- A notes menu on the page to go to a note, edit or delete it, mark it resolved or reopen it, export the notes to JSON and clear them. Quick buttons next to it do the same in one click. ([#6](https://github.com/adryserage/Markspot/pull/6), [#20](https://github.com/adryserage/Markspot/pull/20))
- The comment box and the note card move by their top bar. ([#5](https://github.com/adryserage/Markspot/pull/5))
- A local MCP server and a skill. Say "fix my annotations" and Claude reads, fixes and resolves the notes, and its reply shows on the page.
- "Send to Claude" sends the open notes to the session picked in "Send to". When a project listens on two computers, the list shows the computer name. ([#8](https://github.com/adryserage/Markspot/pull/8), [#9](https://github.com/adryserage/Markspot/pull/9), [#13](https://github.com/adryserage/Markspot/pull/13))
- Listen mode. "listen to my annotations" makes the session wait with `markspot listen`, which uses no tokens while it waits. ([#7](https://github.com/adryserage/Markspot/pull/7), [#18](https://github.com/adryserage/Markspot/pull/18))
- Automatic wake-up. A session started with `claude` after `markspot install`, or with `markspot claude`, wakes up on "Send to Claude" through Claude Code channels, a research preview. ([#10](https://github.com/adryserage/Markspot/pull/10), [#17](https://github.com/adryserage/Markspot/pull/17))
- Two computers can share one notes folder (`--data-dir`). Dispatches are signed with a key kept outside that folder (`markspot key`, `--key-file`). ([#7](https://github.com/adryserage/Markspot/pull/7), [#16](https://github.com/adryserage/Markspot/pull/16))
- English and French, chosen in the right-click menu of the toolbar icon. ([#21](https://github.com/adryserage/Markspot/pull/21))
- `markspot install`, `doctor` and `uninstall` for Chrome and Brave. Tested on Linux and Windows, not yet on macOS. ([#12](https://github.com/adryserage/Markspot/pull/12), [#17](https://github.com/adryserage/Markspot/pull/17))
- A feature guide in English and French. ([#11](https://github.com/adryserage/Markspot/pull/11), [#24](https://github.com/adryserage/Markspot/pull/24))
