emailintake-promote-label = Promote to E-mail item
emailintake-progress-headline = Email intake

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
