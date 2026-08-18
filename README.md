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

Loader complete, no intake behaviour yet. `bootstrap.js` is the adopted Attachment Scanner loader: it wires the Zotero bootstrap lifecycle, publishes `Zotero.EmailIntake`, and registers a single item-notifier observer at priority 50. `src/intake.js` carries a no-op `onItemChange` placeholder.

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

## Roadmap

- Drag-and-drop handler for `.eml`/message files onto the Zotero pane
- Email metadata parser (headers → From/To/Date/Subject)
- Parent-item creation and field population
- Attachment handling for the original message file
