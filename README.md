# zotero-email-intake

A Zotero 7 plugin: drag and drop an email (`.eml`/`.msg`, or a Thunderbird/Outlook message) onto a Zotero collection and have it automatically create the parent item and populate its metadata (sender, recipients, subject, date) without manual entry.

## Identifiers

| Field | Value |
|---|---|
| Addon ID | `emailintake@lassiterdc.github.io` |
| Global namespace | `Zotero.EmailIntake` |
| Preferences branch | `extensions.emailintake.*` |

## Status

Early scaffold. No functional intake logic yet — `bootstrap.js` wires the Zotero 7 bootstrap lifecycle (`startup`/`shutdown`/window hooks) and registers a placeholder preference pane.

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
