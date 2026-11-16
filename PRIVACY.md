# Markspot privacy policy

Effective date: November 16, 2026.

Markspot is a Chrome extension and a local program. You use them to leave notes on web pages for your own Claude Code session. This policy covers the extension published on the Chrome Web Store and the `markspot` npm package.

## What Markspot handles

When you annotate a page, Markspot records:

- the page address;
- the element you marked: its selector, visible text, useful attributes and computed styles;
- the size of the browser window;
- two screenshots of the visible tab: a close-up of the area and the whole screen with the area framed;
- your comment, and any drawing you add to the screenshot;
- on a site in development, the component name and source file path that the build tool exposes.

Markspot does not record text typed in form fields. It does not read pages you have not annotated, and it does not track your browsing.

Screenshots show whatever is on screen at capture time, including anything sensitive shown there. The comment box shows the screenshot before you save, so you can cancel.

## Where the data goes

- The extension keeps a note in the browser's local extension storage until the local program receives it.
- The local program, started by the browser through native messaging, writes notes as JSON and PNG files in a folder on your computer: `~/.local/share/markspot` on Linux, `~/Library/Application Support/markspot` on macOS, `%LOCALAPPDATA%\markspot` on Windows, or the folder you chose with `--data-dir`.
- Your Claude Code session reads the notes when you ask it to. What Claude Code then sends to Anthropic is governed by your Claude Code account and Anthropic's terms, not by Markspot.

Markspot sends nothing to the developer or to any other server. It has no telemetry, no analytics, no advertising and no account. The extension makes no network requests, and the local program opens no network port.

## Sharing and sale

The developer does not collect your data, so there is nothing to sell or share. Markspot does not use your data for any purpose other than delivering your notes to your own Claude Code session.

## Keeping and deleting data

Notes stay on your computer until you delete them. You can delete them in the extension ("Delete", "Clear resolved", "Clear all") or by deleting the notes folder. `markspot uninstall` deletes the notes too, except a notes folder you chose with `--data-dir`, which another computer may share. Removing the extension from Chrome deletes what it kept in browser storage.

## Changes

Changes to this policy are published in this file, with a new effective date. The history is in the repository's commit log.

## Contact

Questions about this policy: open an issue at https://github.com/adryserage/Markspot/issues.
