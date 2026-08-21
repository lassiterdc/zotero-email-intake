# zotero-email-intake

A Zotero 7 plugin: drag and drop an email (`.eml`, or a `.msg` exported from Outlook) onto a Zotero collection and have it automatically create the parent item and populate its metadata without manual entry.

For `.eml`, and for any `.msg` that carries the message's original internet headers, the parent item gets sender, subject and date. A `.msg` that never travelled through a mail server — internal company mail, or a message from your own Sent folder — carries no internet headers, so the item is built from the message properties instead and gets sender and subject but no date. Files above 32 MB are declined with a message rather than parsed.

## Identifiers

| Field | Value |
|---|---|
| Addon ID | `emailintake@lassiterdc.github.io` |
| Global namespace | `Zotero.EmailIntake` |
| Preferences branch | `extensions.emailintake.*` |

## Status

Shipped at `0.1.0`. `bootstrap.js` is the adopted Attachment Scanner loader: it wires the Zotero bootstrap lifecycle, publishes `Zotero.EmailIntake`, and registers a single item-notifier observer at priority 50 — ahead of ZotMoov's 100, which is what lets a promoted message be filed under its parent's metadata rather than as a parentless attachment. `src/intake.js` carries the promoter, the three-tier duplicate ladder, the four right-click commands and the batch summary; `src/message.js` and `src/cfb.js` are the host-free parser core, and twelve invariants in `scripts/ci/invariants.sh` are enforced on every commit and in CI.

## Install

1. Download `zotero-email-intake-<version>.xpi` from the [latest release](https://github.com/lassiterdc/zotero-email-intake/releases/latest).
2. In Zotero: **Tools → Add-ons → gear icon → Install Add-on From File…**, then choose the downloaded `.xpi`.
3. Restart Zotero.

Updates thereafter are automatic — the plugin ships a signed update channel, and Zotero checks it on its own schedule.

**If you use ZotMoov**, add `eml` and `msg` to its allowed file extensions, or your promoted messages will be filed correctly inside Zotero and then silently left in Zotero's own storage rather than moved to your attachment directory. ZotMoov filters candidates by extension *before* it consults any of its other settings, and its shipped default list is `pdf`, `epub`, `docx`, `djvu`. **You do not have to do this by hand**: the first time you drop an e-mail whose extension is missing from that list, this plugin offers to add it for you, and will not ask again about that extension if you decline with the checkbox ticked. The setting itself lives in ZotMoov's own preferences, where you can audit or undo whatever was added.

## Requirements

Running the plugin needs only Zotero. Working ON it needs two more tools, because the repository installs a pre-commit suite that enforces the plugin's silent-failure invariants:

| Tool | Why |
|---|---|
| Zotero 7+ | Runtime. Developed against 9.0.6; the manifest admits `6.999` through `*`. |
| Node.js | Three hooks shell out to `node` — `--check` syntax gating, JSON parsing, and the manifest/loader agreement check. |
| `pre-commit` | Runs the hook suite. Install with `pre-commit install` once per clone. |

Skipping the hook install does not fail loudly — it silently removes every gate. Install them before the first commit.

## Development

Zotero 7 plugins are unpacked bootstrap add-ons — no build step is required to load one for local testing:

1. Open Zotero → Settings → Advanced → enable "Show Debug Output" / developer options as needed.
2. Zotero 7 supports loading a plugin directly from a directory via `--zotero-plugin-path` or by symlinking into the profile's `extensions` directory — see [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers) (not yet vendored as substrate here).
3. After editing `bootstrap.js` or `manifest.json`, restart Zotero to reload the plugin (bootstrap add-ons only reload on install/restart, not live).

## Fixture privacy

Every `.eml` and `.msg` fixture committed to this repository is **synthesised**, and every address in one is on an RFC 2606 reserved domain (`example.com`, `example.net`, `example.org`). None is drawn from real correspondence.

Real mail used for local testing lives only under `test/fixtures/local/`, which is gitignored in full and has never been committed. A contributor who submits a fixture drawn from real correspondence will be asked to resynthesise it before the change is merged — this applies to the message body and headers alike, since a `Received:` chain identifies real hosts and real recipients as surely as a `To:` line does.

## Enforced invariants

CI and the pre-commit suite run `scripts/ci/invariants.sh`, which enforces twelve structural rules. They are listed here so a reader can see what is actually checked rather than what the project claims:

| Rule | What it enforces |
|---|---|
| `R01` | No network egress from `src/` or `bootstrap.js`. |
| `R02` | No DOM constructed from message content. |
| `R03` | The pure core (`src/message.js`, `src/cfb.js`) stays host-free — no `Zotero.` reference. |
| `R04` | No dependence on the Better BibTeX debug bridge. |
| `R05` | One logging routine; nothing else calls `Zotero.logError` directly. |
| `R06` | No synchronous file reads. |
| `R07` | The ReDoS tests exist and are not skipped. |
| `R08` | Every file read is bounded by an explicit maximum. |
| `R09` | The update channel is signed — an `update.json` naming an `update_link` carries a `sha256:` hash. |
| `R10` | `"use strict";` in every `src/*.js` and in `bootstrap.js`. |
| `R11` | No chrome registration. |
| `R12` | Every `src/*.js` is reachable from the loader. |
