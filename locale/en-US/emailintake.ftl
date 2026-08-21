# The four menu LABELS carry a `Zotmail:` prefix so the plugin's entries group visually in a
# context menu it shares with every other plugin. This is a LABEL convention and nothing
# else: the plugin id, the manifest name, the preference pane and the README are unchanged,
# and the prefix must NOT spread to emailintake-progress-headline, to the dialog titles, or
# to any error string. Those already sit inside surfaces that name the plugin, and a second
# name there reads as a second product.
emailintake-promote-label = Zotmail: Promote to E-mail item
emailintake-progress-headline = Email intake

# The remaining three R12 commands. Tag names are deliberately NOT in this file: they are
# identifiers rather than presentation strings and stay as literals in src/, because both
# resolution commands are defined by a tag predicate and tags sync between machines.
emailintake-repromote-label = Zotmail: Re-promote / regenerate key
emailintake-resolve-duplicate-label = Zotmail: Resolve duplicate…
emailintake-review-auto-label = Zotmail: Review auto-attached duplicate…

# Resolution dialogs. Four strings each, not two: Services.prompt.confirmEx takes a title,
# a body and two button labels. The body is load-bearing rather than decorative -- it is
# the only place the plugin can state what it decided and why, on a command that exists
# because the decision was a guess. The third button is flagged BUTTON_TITLE_CANCEL and
# takes the platform's own Cancel label, so no string is owed for it and none should be
# added: a hand-written Cancel would diverge from the platform's in every other locale.
emailintake-resolve-duplicate-title = Resolve duplicate message
emailintake-resolve-duplicate-body = This file was left on its own because another item in your library has the same Message-ID but a different file. Attach it to that item, or promote it as a separate item.
emailintake-resolve-duplicate-attach = Attach to the existing item
emailintake-resolve-duplicate-separate = Promote as a separate item

emailintake-review-auto-title = Review auto-attached duplicate
emailintake-review-auto-body = This file was attached automatically because it matched an item already in your library byte for byte. Keep it attached, or split it out into its own item.
emailintake-review-auto-keep = Keep the auto-attachment
emailintake-review-auto-split = Split into its own item

# Preference pane title. bootstrap.js passes this ID as prefNameFTD, so the pane is
# labelled from this file rather than from the prefDefName literal in the loader.
emailintake-pref-pane-title = Email Intake

emailintake-pref-section-intake = Intake
emailintake-pref-section-handling = Handling
emailintake-pref-section-diagnostics = Diagnostics

emailintake-pref-enabled =
    .label = Promote dropped e-mail files automatically
emailintake-pref-recipient-cap = Recipients to record as creators:
emailintake-pref-on-parse-failure = When a message cannot be parsed:
emailintake-pref-on-parse-failure-leave =
    .label = Leave the attachment as dropped
emailintake-pref-on-parse-failure-tag =
    .label = Leave it and add a tag
emailintake-pref-duplicate-handling = When a message is already in the library:
emailintake-pref-duplicate-handling-split =
    .label = Attach if identical, withhold if different
emailintake-pref-duplicate-handling-off =
    .label = Do not check for duplicates
emailintake-pref-debug-logging =
    .label = Write diagnostic detail to the debug log

# Batch summary. Shown once at the end of a drop, never per item.
emailintake-summary-promoted =
    { $count ->
        [one] Promoted 1 message.
       *[other] Promoted { $count } messages.
    }
emailintake-summary-skipped =
    { $count ->
        [one] Skipped 1.
       *[other] Skipped { $count }.
    }

# One clause per code in SUMMARY_CLAUSE_CODES, in that array's order. These take { $count }
# because the per-item emailintake-error-* strings are worded for a single message and
# carry no count, so they cannot serve here. emailintake-summary-skipped is unchanged and
# stays in use for every non-promoted code outside the clause set.
emailintake-summary-duplicate-attached =
    { $count ->
        [one] Attached 1 duplicate to an existing item.
       *[other] Attached { $count } duplicates to existing items.
    }
emailintake-summary-duplicate-withheld =
    { $count ->
        [one] Left 1 duplicate as dropped; the file differs.
       *[other] Left { $count } duplicates as dropped; the files differ.
    }
emailintake-summary-compare-unavailable =
    { $count ->
        [one] Left 1 message as dropped; the existing file could not be read.
       *[other] Left { $count } messages as dropped; the existing files could not be read.
    }
emailintake-summary-container-too-large =
    { $count ->
        [one] Refused 1 message file that is too large to read.
       *[other] Refused { $count } message files that are too large to read.
    }

# The visible decline message for a .msg that carries no transport headers.
emailintake-declined-msg = This .msg carries no internet headers, so it cannot be read without the sending server's copy.

# One string per user-visible error code.
#
# The three duplicate codes below are for outcomes NOTHING in Phase 3 can produce -- the
# duplicate-detection path that raises them lands in Phase 3b. They are deliberate and
# must NOT be removed as dead strings. They ship now for the same reason the progress
# predicate is written generically rather than as an enumeration of today's codes: 3b
# adds outcomes to a taxonomy this phase fixes, and a phase-3-scoped string set would
# have to be reopened to add them. A reviewer running Validation Plan item 5 will find
# three entries with no referencing call site; that is expected, not a defect.
emailintake-error-not-email = Not an e-mail file.
emailintake-error-too-large = No header terminator within the size limit.
emailintake-error-header-malformed = The message headers could not be read.
emailintake-error-duplicate-attached = Already in the library; the file matched and was attached.
emailintake-error-duplicate-withheld = Already in the library, but the file differs; left as dropped.
emailintake-error-compare-unavailable = Already in the library, but the existing file could not be read.
emailintake-error-already-parented = Already attached to an item.
emailintake-error-shutdown = Interrupted because Zotero began shutting down.
emailintake-error-rename-failed = Promoted, but the file could not be renamed.
emailintake-error-unexpected = Could not be promoted.

# The two codes Phase 3b adds to the taxonomy, per this file's one-string-per-code
# convention. E_CONTAINER_TOO_LARGE must say the file is too large to READ rather than that
# it could not be parsed -- the user's remedy differs, and emailintake-error-too-large above
# is about a malformed header block. E_ALREADY_FILED is a skip rather than a failure.
emailintake-error-container-too-large = This message file is too large to read.
emailintake-error-already-filed = Already filed away by another tool; left alone.

# The ZotMoov extension-allowlist prompt. No `Zotmail:` prefix on these: that convention is
# for right-click menu entries, and this is a dialog whose title already identifies it.
#
# The body carries the load. It must name the extensions, say that ZotMoov is installed but
# not configured to file this type, state that the change applies to FUTURE drops rather
# than the one just made -- the prompt is scheduled off the notifier turn and cannot
# retroactively file the drop that raised it -- and say where the setting lives so the user
# can audit or undo it in ZotMoov's own preferences rather than only through us.
emailintake-zotmoov-prompt-title = File e-mail with ZotMoov?
emailintake-zotmoov-prompt-body = ZotMoov is installed, but it is not set up to file { $extensions } files, so messages you promote will stay in Zotero's storage instead of moving to your attachment directory. Add { $extensions } to ZotMoov's allowed file extensions? This applies to future drops — the message you just added will not move on its own. You can review or undo the change any time in ZotMoov's preferences.
emailintake-zotmoov-prompt-add = Add to ZotMoov
emailintake-zotmoov-prompt-skip = Not now
emailintake-zotmoov-prompt-never = Never ask about { $extensions } again
