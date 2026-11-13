# Markspot features

Français : [fonctions.md](fonctions.md)

This guide describes each feature, first on the page, then in Claude Code. Installation is in the [README](../README.md#install).

## On the page

### Turning annotation mode on and off

Alt+C or a click on the Markspot icon turns annotation mode on in the tab. The same shortcut turns it off. If Alt+C does nothing, set it in `chrome://extensions/shortcuts` (or `brave://extensions/shortcuts`).

Esc does one thing at a time:

- while you edit a comment in the menu, it cancels the edit;
- while you write a note, it drops the note and goes back to picking an element;
- otherwise, it turns annotation mode off and hides the pins. Alt+C brings them back.

Browser pages (`chrome://`, the extension store) cannot be annotated: the icon says so when you hover it.

### Marking an element or an area

- A click marks an element. On hover, the element is framed with its name.
- A drag draws an area, of any size.

Markspot keeps the page address, the element (selector, visible text, useful attributes, computed styles, and on a site in development with Vue, Svelte or React, the component and its source file), the screen size and two screenshots: a close-up of the area and the whole screen with the area framed. Text typed in a form field is never kept, but whatever the screen shows goes into the screenshots (see [Privacy and security](../README.md#privacy-and-security)).

### Writing the note

The "New note" box opens on the screenshot of the area. Write what is wrong. Enter or "Save note" saves it, Shift+Enter adds a line. "Cancel" drops the note.

### Drawing on the screenshot

You draw on the box's screenshot with the mouse. The tools:

- "Pen", "Arrow" and "Rectangle";
- two colors, "Red" and "Yellow";
- "Undo stroke" removes the last stroke.

The drawing is merged into the close-up that Claude receives.

### Moving the panels

The comment box and a note's card move by their top bar. A double-click on the bar puts them back in place. With the keyboard, once the bar has focus, the arrow keys move them by 10 pixels (40 with Shift).

### Pins and the note card

Each note has a numbered pin on the page, placed on the marked element. A click on the pin opens its card: the comment, the state and Claude's reply once it has resolved the note. "Close" closes it.

A note has one of these states:

- "Pending": the local program has not received it yet (trial version, or local program not started yet). It leaves on its own at the next connection;
- "Open": to be fixed;
- "Resolved": the card shows "Claude's reply" with the reply, or "Resolved by you".

"Mark resolved" and "Reopen", in the card as in the menu, change the state by hand. In the card, "Edit" changes the comment of a note that is not resolved yet (Esc cancels), and "Delete" removes the note after a second click on "Confirm delete". Esc, "Edit" or 5 seconds without a click cancel the confirmation.

### The notes menu

If the local program is not installed on this computer, the menu starts with "Install Markspot on this computer", with the command to run in a terminal (`npm install -g markspot && markspot install`) and a "Copy" button. Your notes stay in the browser until then.

The button at the top right of the page ("1 note", "3 notes") opens the menu of the page's notes:

- a click on a note goes to its pin;
- "Edit" changes the comment, "Save" keeps it;
- "Mark resolved" or "Reopen" changes its state;
- "Delete" removes this note alone, after "Yes, delete" ("No" or Esc cancels);
- "Send to" picks the Claude Code session that receives the notes, and "Refresh" reloads the list (see below);
- "Send to Claude" sends the open notes to that session;
- "Clear resolved notes" removes the resolved notes of the page;
- "Clear all on this page" removes every note of the page, after "Yes, clear" ("No, keep them" cancels).

### Quick buttons

Next to the menu, buttons do the same in one click:

- "Send to Claude";
- "Resolve all" marks every open note resolved. "Undo" reopens them for 8 seconds;
- "Export" opens the export;
- "Clear resolved";
- "Clear all", with the same confirmation as in the menu.

### Sending notes to Claude

"Send to Claude" hands the page's open notes to a Claude Code session.

The "Send to" picker lists the sessions that are listening, by project name (the session's folder). The choice is kept per site. With a single session, the dispatch leaves without a choice; with several and no choice yet, the page asks you to pick one. A chosen project that no longer listens stays in the list with "(not listening)": the dispatch waits for it up to 24 hours.

"Refresh" reloads the list and says how many sessions are listening. "No session is listening" means just that: see [In Claude Code](#in-claude-code).

When the same project listens on two computers (the same folder on Linux and on Windows), the list shows both with the computer name, for example "site (LAPTOP)", and the dispatch only goes to the chosen computer.

### Exporting notes

Right-click the Markspot icon, then "Export notes", or use the "Export" button. An extension page gathers each note, its two screenshots, its state and Claude's reply in a JSON file (format `markspot-export`), then downloads it. If the download is cancelled, the page keeps a link to try again.

### Changing the language

The interface is in English by default, and also in French. Right-click the Markspot icon, then "Language": "Auto (browser language)" uses French when the browser is in French and English otherwise, and "English" and "Français" set the language. The choice is kept in the browser. Pages where annotation mode is on switch at once: the bar, the notes menu and the open card. A new note being written and an edit in progress keep their text. A note resolved by hand gets "Resolved by hand." or « Réglée à la main. », depending on the language at that moment.

The question that `markspot launch` asks follows the terminal language (`LC_ALL`, `LC_MESSAGES`, then `LANG`): French when it starts with `fr`, English otherwise.

### The trial version

`node build.mjs --trial <folder>` builds an extension that works without the local program or Claude Code. Notes stay in the browser, and the export lets you hand them to Claude. The "Send to Claude" button is not there. When the full version replaces the trial in the same folder (`node build.mjs --out <folder>`, then "Reload" in `chrome://extensions`), the trial's notes go to the local program. Do not remove the trial extension: its notes would go with it.

## In Claude Code

### Fixing notes

Say "fix my annotations". The `markspot` skill does this for each open note:

1. it reads the note, its element and its two screenshots;
2. it finds the source file in the repository;
3. it fixes what the comment asks for, and only that;
4. it checks the result in the browser (the `chrome-devtools` MCP server);
5. it resolves the note with a short reply, which you read in the card.

A note it cannot fix stays open, with the reason.

### Receiving dispatches

A session receives "Send to Claude" dispatches in two ways, described in the [README](../README.md#sending-notes-to-claude):

- listen mode: say "listen to my annotations". Claude runs `markspot listen` as a background command, which uses no tokens while it waits;
- automatic wake-up: after `markspot install`, start `claude` as usual and answer yes (or nothing for 5 s) to "Should Markspot listen to this session?", or run `markspot claude`. The session shows in "Send to" on its own and wakes up at each dispatch (Claude Code channels, research preview). A dispatch that Claude does not open within 2 minutes goes back in the queue.

### MCP tools

The `markspot` MCP server gives Claude five tools:

- `markspot_list_annotations`: the notes, with their number, state, the site's origin and the comment;
- `markspot_get_annotation`: one full note, with the page, the element and the two screenshots;
- `markspot_resolve_annotation`: resolves a note with a reply. The first reply wins, even when two sessions reply at the same time;
- `markspot_clear_annotations`: deletes resolved notes, open notes or all of them;
- `markspot_wait_for_annotations`: waits for a new note, for a client that cannot run a background command.

The page data (address, title, text, attributes) arrives in a separate block: Claude treats it as data written by the site and follows no instruction found in it.

## Commands

After `npm install -g markspot`, the `markspot` command is on your `PATH`. `install` also writes a launcher: `~/.local/share/markspot/bin/markspot` on Linux, `~/Library/Application Support/markspot/bin/markspot` on macOS and `%LOCALAPPDATA%\markspot\bin\markspot.bat` on Windows. From a clone of the repository, `node dist/cli.js` does the same.

- `markspot install`: installs the local program for Chrome and Brave, the `claude` shell function, the MCP server in Claude Code, the skill and the key that signs dispatches. Options: `--browser`, `--chrome-profile`, `--cdp`, `--data-dir`, `--key-file` to reuse the key of the other computer, `--no-shell` and `--shell` (see the [README](../README.md#options));
- `markspot key`: prints this computer's dispatch key, to copy once to the other one. Keep it secret;
- `markspot doctor`: checks each install step, write access to the notes folder and, with `--cdp`, the round trip between the extension and the local program;
- `markspot uninstall`: undoes each step;
- `markspot listen [--name <project>] [--url <prefix>] [--timeout <seconds>]`: waits for a dispatch. Exit code 0 when notes arrive, 2 after the timeout (one hour by default);
- `markspot launch [claude options]`: what the `claude` function added by `install` runs (the question, then claude with or without Markspot);
- `markspot claude [claude options]`: starts Claude Code with the Markspot channel, in the "ask before each command" permission mode unless you choose another one;
- `markspot mcp` and `markspot host`: started by Claude Code and by the browser, never by hand.

## Two computers

To annotate on Windows and let Claude Code fix the notes from Linux (or the other way round), both computers use the same notes folder on a network share: install with `--data-dir <path of the share>` on the computer that does not hold the folder. The details are in the [README](../README.md#two-machines-one-notes-folder).
