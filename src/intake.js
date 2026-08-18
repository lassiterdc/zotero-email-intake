"use strict";

// The single host-coupled module: observer, detection, promoter, rename sequence,
// menu command, ESM spike, and the _test affordance.
//
// BINDING CONTRACT (Phase 0): this file AUGMENTS the EmailIntake object the loader
// already declared and returned. It must never re-declare it. A re-declaring subscript
// does not error; it produces a plugin that starts cleanly, logs nothing, and registers
// nothing, because _init reads this.onItemChange off the object the loader kept.
//
// DECLARATION FORM: every top-level declaration here is a `function` declaration or a
// `var`, never `const`, `let`, or `class`. The host unloads a plugin's sandbox scope
// only on uninstall and upgrade, never on disable, so an in-session disable/re-enable
// re-runs every loadSubScript call in startup() into the SAME global. A top-level `const`
// would be a global lexical redeclaration on the second pass -- an early error leaving the
// plugin enabled and inert, masked by a full restart. `log` and `version` are reserved by
// the loader's flat global. Declarations INSIDE function bodies are unaffected by this
// rule and use `const` freely.
//
// EVALUATION-TIME CONSTRAINT: this file assigns members and nothing else while it is
// being evaluated. No top-level IIFE, and no call to a pure function from src/message.js
// at evaluation time -- doing so would make the loader's load order load-bearing, and
// nothing in the loader or this phase's validation would detect the change.

// Set by EmailIntake.shutdown below, which the loader dispatches from its own shutdown().
// `var` is load-bearing twice: it satisfies the declaration-form rule, and it is what
// RESETS the flag on an in-session re-enable, because the second startup() pass
// re-executes this assignment into the standing sandbox. A latched-true flag would make
// every later notify return immediately, forever, with no visible error.
var _shuttingDown = false;

// ===== Logging =====

// The single logging routine. It takes a key and a code and never header content:
// headers carry correspondent addresses and usually the subject, and the debug log is
// what a user attaches to a public issue. Nothing else in this codebase logs errors.
function logSafe(attachmentKey, errorCode) {
    Zotero.logError(new Error(`emailintake ${errorCode} ${attachmentKey}`));
}

// ===== Outcome taxonomy =====

// The plain-promotion outcome. Everything else -- every code below, and every code a
// later phase adds -- is "not a plain promotion".
//
// This sentinel is what lets the D2 progress predicate be written GENERICALLY, as
// `outcome !== OUTCOME_PROMOTED`, instead of as an enumeration of the codes that exist
// today. Phase 3b adds three duplicate outcomes to this taxonomy; an enumerated predicate
// would silently classify each of them as plain, and a one-file withheld drop would show
// no window at all. That failure is invisible from inside this phase, because the codes
// it would omit do not exist yet.
var OUTCOME_PROMOTED = 'PROMOTED';

// Every non-plain outcome this phase can produce or receive. The three duplicate codes
// are raised only by the Phase-3b path and are enumerated now so the taxonomy, the Fluent
// strings and the summary are settled in one place rather than reopened later.
var OUTCOME_CODES = [
    'E_NOT_EMAIL',            // the content sniff failed
    'E_TOO_LARGE',            // no header terminator within the 256 KB cap
    'E_HEADER_MALFORMED',     // a required header is absent or unparseable
    'E_DUPLICATE_ATTACHED',   // Message-ID matched, files identical, attachment reparented
    'E_DUPLICATE_WITHHELD',   // Message-ID matched, files differ, left standalone and tagged
    'E_COMPARE_UNAVAILABLE',  // the existing child's file could not be resolved or read
    'E_ALREADY_PARENTED',     // skipped by the convergence guard
    'E_SHUTDOWN',             // aborted because teardown began mid-batch
    'E_RENAME_FAILED',        // parented correctly, but the file kept its export name
    'E_UNEXPECTED'            // anything the per-item catch sees that is none of the above
];

// src/message.js is pure and cannot log, so it signals an abort by throwing an Error
// whose message IS the taxonomy code. Anything else that escapes is genuinely unexpected.
function codeFromError(e) {
    var message = (e && e.message) || '';
    return OUTCOME_CODES.indexOf(message) === -1 ? 'E_UNEXPECTED' : message;
}

// ===== Detection =====

// Phase 1's inline hasDecliningMagic / firstNonEmptyLineIsField / hasRecognisedField were
// deleted here and their three call sites collapsed onto the single detect(bytes,
// filename) in src/message.js. The architecture assigns detection to the pure module;
// Phase 2 landed detect there, and keeping the Phase-1 duplicate alive meant two
// implementations of one rule that could drift with no phase closing the gap.

// Bytes read to classify a candidate. Only the leading region is needed: detect keys on
// container magic and on the shape of the first field line.
var SNIFF_BYTES = 4096;

// R16's cap on the header read. This bounds the RFC 5322 header region of an .eml; it is
// deliberately NOT sized for a CFB container, which is why .msg is declined below rather
// than promoted through the same read.
var HEADER_READ_CAP = 262144;

// Resolves the path with getFilePathAsync -- never the synchronous resolver, which skips
// the existence check and returns a plausible path for a file that is not there.
//
// It never consults the attachment's sniffed MIME field: the host's sniffer table maps a
// leading "From" to text/plain, so an .eml beginning "From:" is typed one way while one
// beginning "Received:" falls through to the OS registry, making that field
// machine-dependent.
//
// Returns 'eml', 'msg', or null. The extension is only a pre-filter inside detect; the
// magic-byte test is what decides, so a PDF misnamed .eml comes back null.
async function detectAttachmentKind(attachment) {
    if (!attachment.isFileAttachment()) return null;
    if (attachment.parentItemID) return null;

    var path = await attachment.getFilePathAsync();
    if (!path) return null;

    var bytes = await IOUtils.read(path, { maxBytes: SNIFF_BYTES });
    return detect(bytes, path);
}

// ===== Promotion =====

// Reads the recipient cap on the host-coupled side and hands it to the pure mapper as a
// parameter, because src/message.js may not name the host object at all. A missing or
// unparseable value coerces to 0. Inert in this phase: the stub returns an empty
// recipient list, so no recipient creator is emitted at any cap value.
function readRecipientCap() {
    var cap = Number(EmailIntake.getPref('recipientCap'));
    if (!isFinite(cap) || cap < 0) return 0;
    return cap;
}

// Builds the parent fully in memory and writes it once. Better BibTeX computes the
// cite-key from whatever metadata is present the moment its observer fires and never
// recomputes, so create-then-fill would produce a permanently wrong key that looks
// correct in the field pane. The cite-key field itself is never written here: pinning it
// would disable Better BibTeX's postfix collision disambiguation and hand uniqueness to
// this plugin, and one sender in one year is a high-collision population.
async function promoteAttachment(attachment, kind) {
    // .msg is RECOGNISED and declined visibly rather than promoted. The architecture's
    // staging paragraph makes this the standing behaviour for a format the detector knows
    // and cannot yet handle, and the read below is the reason it still applies here: R16's
    // 262144-byte cap bounds an RFC 5322 header region, and a CFB container's directory
    // walk needs the whole file. Promoting .msg therefore requires a second, differently
    // sized read, which this phase does not specify.
    if (kind === 'msg') throw new Error('E_HEADER_MALFORMED');

    const path = await attachment.getFilePathAsync();
    if (_shuttingDown) throw new Error('E_SHUTDOWN');
    if (!path) throw new Error('E_HEADER_MALFORMED');

    // R16 verbatim: one capped read, keeping the Uint8Array in hand, then one explicit
    // decode. Zotero.File.getContentsAsync(path, 'utf-8', 262144) is the same two
    // operations behind one call, but adopting it would change a decision the
    // architecture states in a named paragraph, which A6 would then require recording.
    const bytes = await IOUtils.read(path, { maxBytes: HEADER_READ_CAP });
    if (_shuttingDown) throw new Error('E_SHUTDOWN');

    const text = new TextDecoder('utf-8').decode(bytes);

    // parseHeaders throws E_TOO_LARGE on a missing header terminator and
    // E_HEADER_MALFORMED past the header-count cap. Both propagate to the per-item catch,
    // which is the whole signalling contract -- the pure module cannot log for itself.
    const payload = mapToPayload(parseHeaders(text), readRecipientCap());

    const parentItem = new Zotero.Item(payload.itemType);
    parentItem.libraryID = attachment.libraryID;
    parentItem.setField('subject', payload.subject);
    parentItem.setField('date', payload.date);
    parentItem.setField('extra', payload.extra);
    parentItem.setCreators(payload.creators);

    // One transaction covering both the parent save and the reparent, so the commit
    // produces a single notifier batch whose event order is defined. Nesting a
    // transaction inside a notifier callback is safe -- and this is NOT obvious --
    // because commitTransaction clears the active transaction id BEFORE running commit
    // callbacks, and the notifier's own commit is registered as one, so the wait gate in
    // executeTransaction is already clear by the time we get here.
    await Zotero.DB.executeTransaction(async function () {
        await parentItem.save();
        attachment.parentID = parentItem.id;
        await attachment.save();
    });
    if (_shuttingDown) throw new Error('E_SHUTDOWN');

    return await renameAttachmentFromParent(attachment, parentItem);
}

// Runs after the transaction commits. The host will NOT auto-rename this file on its own:
// the predicate core consults gates on an allow-list of content types whose shipped
// default is PDF and EPUB only, so it is always false for an .eml. Core's own promotion
// path wraps these three calls in that predicate; copying the wrapper here would make the
// whole sequence a no-op and produce exactly the half-working result the phase's
// filename requirement exists to catch. So the calls are unconditional.
//
// formatString is left unset so the library's own rename-template setting supplies the
// naming, which is the user's configuration rather than ours.
async function renameAttachmentFromParent(attachment, parentItem) {
    const originalTitle = attachment.getField('title');
    const ext  = Zotero.Attachments.getCorrectFileExtension(attachment);
    const base = Zotero.Attachments.getFileBaseNameFromItem(parentItem, { attachmentTitle: originalTitle });
    // Returns false rather than throwing when the path cannot be resolved, so the return
    // value is checked and the failure logged -- a throw here would abandon the batch.
    const result = await attachment.renameAttachmentFile(base + (ext ? '.' + ext : ''),
                                                        { overwrite: false, unique: true });
    if (result !== true) { logSafe(attachment.key, 'E_RENAME_FAILED'); return 'E_RENAME_FAILED'; }
    // Synchronous and does not save, so the saveTx is required. Its first-of-type branch
    // finds no default title for any type an .eml can be, so the title falls through to
    // the filename minus extension.
    attachment.setAutoAttachmentTitle();
    await attachment.saveTx();
    return OUTCOME_PROMOTED;
}

// ===== Batch summary (D2) =====

// One window per notify, populated once at the end with counts. No progress bar and no
// per-item update: the batch is short and a bar over a sub-second loop is noise.
//
// The predicate is `ids.length > 1 OR any outcome is not a plain promotion`, and the
// second disjunct is written against the sentinel rather than against a list of codes --
// see OUTCOME_PROMOTED for why an enumeration would silently go blind to Phase 3b's
// outcomes.
function summariseBatch(itemCount, outcomes) {
    var promoted = 0;
    var other = 0;
    for (var i = 0; i < outcomes.length; i++) {
        if (outcomes[i] === OUTCOME_PROMOTED) promoted++;
        else other++;
    }

    if (itemCount <= 1 && other === 0) return;

    try {
        // Counts go through Fluent as VARIABLES, never concatenated onto the outside of
        // the string. Concatenation is what shipped, and it was wrong twice over: the
        // accessor passed no args so `{ $count }` rendered literally, and the number was
        // appended as well -- so passing args without removing the concatenation would
        // render the count twice.
        //
        // The third argument is the dismissal timer. Without it the window never goes
        // away on its own: the loader constructs with closeOnClick:false, so with no
        // timer there is no dismissal path at all and the user must remove the toast by
        // hand. 8000 ms is Zotero's own duration for a message meant to be READ, which a
        // batch summary is; the loader's default of 2500 ms is sized for a transient
        // progress toast and is too short to read counts from.
        EmailIntake.createProgressWindow(
            EmailIntake.getLocalizedString('emailintake-progress-headline'),
            EmailIntake.getLocalizedString('emailintake-summary-promoted', { count: promoted })
                + ' ' + EmailIntake.getLocalizedString('emailintake-summary-skipped', { count: other }),
            8000
        );
    }
    catch (e) {
        // A summary that cannot be drawn must never cost the batch its result.
        logSafe('-', 'E_UNEXPECTED');
    }
}

// One item, start to finish. Returns an outcome; never throws for a cause the taxonomy
// names, because the caller counts what this returns.
async function processOne(item) {
    const kind = await detectAttachmentKind(item);
    if (_shuttingDown) throw new Error('E_SHUTDOWN');
    if (kind === null) return null;                    // not ours; not counted at all

    return await promoteAttachment(item, kind);
}

// ===== Observer =====

// notify is async and awaits the promotion. The guarantee that this runs to completion
// before ZotMoov's observer is entered comes from the dispatcher awaiting the promise we
// return; a handler that started promotion and returned would reinstate the race.
EmailIntake.onItemChange = {
    notify: async function (event, type, ids, extraData) {
        if (event !== 'add' || type !== 'item') return;
        if (_shuttingDown) return;

        // Development-time safety, read once at the top. Defaults to off in this phase:
        // an unset pref is undefined, which is not true.
        if (EmailIntake.getPref('enabled') !== true) return;

        const outcomes = [];

        for (let i = 0; i < ids.length; i++) {
            // Per-item try/catch that counts and continues -- never rethrows. The
            // dispatcher wraps each observer in its own catch, so a throw escaping here
            // would abandon the rest of the batch and leave the user with a partial drop
            // and no explanation.
            let outcome = null;
            try {
                // Resolved immediately before promoting, not all up front: every
                // promotion awaits a file read and a transaction, so a handle taken at
                // the top of the loop is stale-able by the time later ids are reached.
                const item = Zotero.Items.get(ids[i]);
                if (!item) continue;

                outcome = await processOne(item);
                if (_shuttingDown) return;
            }
            catch (e) {
                outcome = codeFromError(e);
                logSafe(ids[i], outcome);
                // Teardown began mid-batch. Stop, and draw no window: a progress window
                // raised into a shutting-down window set is worse than no summary.
                if (outcome === 'E_SHUTDOWN') return;
            }
            // null means the item was never ours -- a PDF dropped alongside the mail.
            // Those are not counted, or a mixed drop would always trip the predicate.
            if (outcome !== null) outcomes.push(outcome);
        }

        if (outcomes.length > 0) summariseBatch(outcomes.length, outcomes);
    }
};

// ===== Menu command =====

// Runs the identical promoter over the selected standalone attachments: the recovery path
// when the observer is disabled, and the way to exercise promotion without performing a
// drag during development.
async function promoteSelected(ctx) {
    const items = (ctx && ctx.items) || [];
    const outcomes = [];
    for (let i = 0; i < items.length; i++) {
        let outcome = null;
        try {
            outcome = await processOne(items[i]);
            if (_shuttingDown) return;
        }
        catch (e) {
            outcome = codeFromError(e);
            logSafe(items[i] && items[i].key, outcome);
            if (outcome === 'E_SHUTDOWN') return;
        }
        if (outcome !== null) outcomes.push(outcome);
    }
    if (outcomes.length > 0) summariseBatch(outcomes.length, outcomes);
}

// ===== Lifecycle =====

EmailIntake.shutdown = function () {
    _shuttingDown = true;
    // The one explicit close. Normal dismissal is the timer, but a plugin disabled while
    // a summary is on screen would otherwise leave a toast belonging to a plugin that is
    // no longer running, and its timer dies with the sandbox. Safe to call
    // unconditionally now that closeProgressWindow guards on an absent window.
    EmailIntake.closeProgressWindow();
};

EmailIntake.main = async function () {
    // Store the RETURNED id, never the input key: the plugin API namespaces the key with
    // the plugin id, so unregistering with the input string would silently miss. The
    // platform also unregisters this automatically at plugin shutdown, so the stored id
    // is belt-and-braces rather than the mechanism.
    try {
        EmailIntake._menuID = Zotero.MenuManager.registerMenu({
            menuID: 'emailintake-promote',
            pluginID: 'emailintake@lassiterdc.github.io',
            target: 'main/library/item',
            menus: [{
                menuType: 'menuitem',
                l10nID: 'emailintake-promote-label',
                onCommand: (ev, ctx) => promoteSelected(ctx)
            }]
        });
    }
    catch (e) {
        logSafe('-', 'E_MENU_REGISTER_FAILED');
    }

    // ESM spike. The await is deliberate and must not be removed as dead weight: the call
    // is synchronous on every build measured, but this is a probe of UNMEASURED behaviour,
    // and if a jar:-packaged import ever returned a promise the unawaited form would read
    // .probe off the promise, log FAIL-unexpected-export, and hand Phase 2 an artifact
    // indistinguishable from a real missing export -- while also letting a rejected
    // promise escape this catch and suppress the error name and message.
    try {
        const m = await ChromeUtils.importESModule(EmailIntake.rootURI + 'src/probe.sys.mjs');
        Zotero.debug('emailintake ESM spike: ' + (m.probe === 'ok' ? 'PASS' : 'FAIL-unexpected-export'));
    }
    catch (e) {
        Zotero.debug('emailintake ESM spike: FAIL ' + e.name + ' ' + e.message);
    }
};

// ===== Developer affordance =====

// Runs detect -> stub-parse -> map on a file path and returns the payload, writing
// nothing. Follows ZotMoov's wildcard._test(item) precedent: the in-app escape hatch for
// the half that cannot be exercised outside the application.
EmailIntake._test = async function (path) {
    const sniff = await IOUtils.read(path, { maxBytes: SNIFF_BYTES });
    const kind = detect(sniff, path);

    // Mirrors the promoter: the same capped read, the same decode, the same parser. A
    // throw from parseHeaders surfaces here as the taxonomy code rather than a payload,
    // which is what makes this usable for reproducing a failing file by hand.
    let payload = null;
    let outcome = kind === null ? 'E_NOT_EMAIL' : OUTCOME_PROMOTED;
    if (kind === 'msg') outcome = 'E_HEADER_MALFORMED';
    else if (kind === 'eml') {
        try {
            const bytes = await IOUtils.read(path, { maxBytes: HEADER_READ_CAP });
            payload = mapToPayload(parseHeaders(new TextDecoder('utf-8').decode(bytes)),
                                   readRecipientCap());
        }
        catch (e) {
            outcome = codeFromError(e);
        }
    }

    return { path: path, kind: kind, outcome: outcome, payload: payload };
};
