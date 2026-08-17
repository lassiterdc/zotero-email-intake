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

// ===== Detection =====

// Container magics that disqualify a file regardless of its extension, checked against
// raw bytes before any decode. %PDF-, ZIP (covers .docx and friends), Compound File
// Binary (an .msg misnamed .eml, the likeliest real misfile), gzip, ELF.
function hasDecliningMagic(bytes) {
    var magics = [
        [0x25, 0x50, 0x44, 0x46, 0x2D],
        [0x50, 0x4B, 0x03, 0x04],
        [0xD0, 0xCF, 0x11, 0xE0],
        [0x1F, 0x8B],
        [0x7F, 0x45, 0x4C, 0x46]
    ];
    for (var i = 0; i < magics.length; i++) {
        var magic = magics[i];
        if (bytes.length < magic.length) continue;
        var matched = true;
        for (var j = 0; j < magic.length; j++) {
            if (bytes[j] !== magic[j]) { matched = false; break; }
        }
        if (matched) return true;
    }
    return false;
}

// RFC 5322 admits no preamble, so a message's first non-empty line is itself a field.
function firstNonEmptyLineIsField(lines) {
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        return /^[!-9;-~]+:/.test(lines[i]);
    }
    return false;
}

// `name: value` at the start of a line occurs incidentally in many binary and text
// formats, so a recognised field name is what makes this a content decision rather than
// a punctuation coincidence.
function hasRecognisedField(lines) {
    var known = ['from', 'to', 'subject', 'date', 'message-id',
                 'received', 'return-path', 'mime-version'];
    var limit = Math.min(lines.length, 10);
    for (var i = 0; i < limit; i++) {
        var colon = lines[i].indexOf(':');
        if (colon <= 0) continue;
        var name = lines[i].slice(0, colon).trim().toLowerCase();
        if (known.indexOf(name) !== -1) return true;
    }
    return false;
}

// Resolves the path with getFilePathAsync -- never the synchronous resolver, which skips
// the existence check and returns a plausible path for a file that is not there.
//
// It never consults the attachment's sniffed MIME field: the host's sniffer table maps a
// leading "From" to text/plain, so an .eml beginning "From:" is typed one way while one
// beginning "Received:" falls through to the OS registry, making that field
// machine-dependent.
async function isEmailFile(attachment) {
    if (!attachment.isFileAttachment()) return false;
    if (attachment.parentItemID) return false;

    var path = await attachment.getFilePathAsync();
    if (!path) return false;
    if (!/\.eml$/i.test(path)) return false;

    var bytes = await IOUtils.read(path, { maxBytes: 4096 });
    if (hasDecliningMagic(bytes)) return false;

    // A lossy decode of binary content cannot manufacture a match the byte-magic test
    // would have caught; the header region is ASCII by construction.
    var text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var lines = text.split(/\r\n|\r|\n/);

    if (!firstNonEmptyLineIsField(lines)) return false;
    if (!hasRecognisedField(lines)) return false;
    return true;
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
async function promoteAttachment(attachment) {
    const payload = mapToPayload(parseHeaders(''), readRecipientCap());

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
    if (_shuttingDown) return;

    await renameAttachmentFromParent(attachment, parentItem);
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
    if (result !== true) { logSafe(attachment.key, 'E_RENAME_FAILED'); return; }
    // Synchronous and does not save, so the saveTx is required. Its first-of-type branch
    // finds no default title for any type an .eml can be, so the title falls through to
    // the filename minus extension.
    attachment.setAutoAttachmentTitle();
    await attachment.saveTx();
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

        for (let i = 0; i < ids.length; i++) {
            // Per-item try/catch that logs and continues -- never rethrows. The
            // dispatcher wraps each observer in its own catch, so a throw escaping here
            // would abandon the rest of the batch and leave the user with a partial drop
            // and no explanation.
            try {
                // Resolved immediately before promoting, not all up front: every
                // promotion awaits a file read and a transaction, so a handle taken at
                // the top of the loop is stale-able by the time later ids are reached.
                const item = Zotero.Items.get(ids[i]);
                if (!item) continue;

                const isEmail = await isEmailFile(item);
                if (_shuttingDown) return;
                if (!isEmail) continue;

                await promoteAttachment(item);
                if (_shuttingDown) return;
            }
            catch (e) {
                logSafe(ids[i], 'E_PROMOTE_FAILED');
            }
        }
    }
};

// ===== Menu command =====

// Runs the identical promoter over the selected standalone attachments: the recovery path
// when the observer is disabled, and the way to exercise promotion without performing a
// drag during development.
async function promoteSelected(ctx) {
    const items = (ctx && ctx.items) || [];
    for (let i = 0; i < items.length; i++) {
        try {
            if (!(await isEmailFile(items[i]))) continue;
            if (_shuttingDown) return;
            await promoteAttachment(items[i]);
            if (_shuttingDown) return;
        }
        catch (e) {
            logSafe(items[i] && items[i].key, 'E_PROMOTE_FAILED');
        }
    }
}

// ===== Lifecycle =====

EmailIntake.shutdown = function () {
    _shuttingDown = true;
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
    const bytes = await IOUtils.read(path, { maxBytes: 4096 });
    const declined = hasDecliningMagic(bytes);
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r\n|\r|\n/);

    return {
        path: path,
        detected: !declined && firstNonEmptyLineIsField(lines) && hasRecognisedField(lines),
        payload: mapToPayload(parseHeaders(text), readRecipientCap())
    };
};
