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
    'E_UNEXPECTED',           // anything the per-item catch sees that is none of the above
    // Phase 3b. E_CONTAINER_TOO_LARGE is the ELEVENTH member and is NOT a reuse of
    // E_TOO_LARGE: that code asserts "no header terminator within the cap", and for an
    // oversized container no such claim can be made because the file was never opened.
    // The two differ in cause (size vs malformed structure), in stage (a pre-read refusal
    // vs a parse outcome) and in remedy (re-export or raise the cap vs report a defect).
    'E_CONTAINER_TOO_LARGE',  // container above the per-format cap; refused before reading
    'E_ALREADY_FILED'         // already a linked file under another plugin's destination
];

// The non-promoted codes that earn their own summary clause, in RENDER ORDER. Iterating
// this array rather than the tally's own keys is what fixes clause order independently of
// object insertion order.
//
// Deliberately NOT one clause per taxonomy member: twelve codes would mean twelve new
// plural-form strings of which eight satisfy no validation item, and it would orphan
// emailintake-summary-skipped for no gain. E_ALREADY_FILED and E_ALREADY_PARENTED are
// skips rather than duplicate outcomes and stay in the residual bucket for that reason.
var SUMMARY_CLAUSE_CODES = [
    'E_DUPLICATE_ATTACHED',
    'E_DUPLICATE_WITHHELD',
    'E_COMPARE_UNAVAILABLE',
    'E_CONTAINER_TOO_LARGE'
];

// The outcomes the onParseFailure pref tags when it is set to "tag": the three codes that
// mean "this was an e-mail file and it could not be read". Every other member is excluded
// deliberately -- E_NOT_EMAIL because the file was never ours; E_ALREADY_PARENTED and
// E_ALREADY_FILED because the item is already correct and a tag would assert a problem
// that does not exist; the three duplicate codes because the ladder already writes its own
// tag on each; E_RENAME_FAILED because the item DID promote and the failure is cosmetic;
// E_SHUTDOWN because it is transient and the same drop succeeds next run; E_UNEXPECTED
// because tagging an item to say "something unidentified happened" gives no action.
var PARSE_FAILURE_TAG_CODES = ['E_TOO_LARGE', 'E_HEADER_MALFORMED', 'E_CONTAINER_TOO_LARGE'];

// Tag names are IDENTIFIERS, not presentation strings, and are deliberately literal here
// rather than drawn from the Fluent file. Both resolution commands are defined by a tag
// PREDICATE, so a locale-varying tag name would stop them matching tags written under
// another locale -- and because tags sync, a user with two machines on different locales
// would write two different tags into one library and see the commands work on half their
// own items. The leading '#' is PART OF THE STRING, not notation: the host has no sigil
// convention, so stripping it yields a tag that looks right in the tag selector while both
// resolution predicates silently match nothing.
var TAG_AUTO_ATTACHED = '#auto-attached-duplicate';
var TAG_DUPLICATE = '#duplicate-message';
var TAG_PARSE_FAILED = '#email-parse-failed';

// Manual, not automatic. The host offers "Delete Automatic Tags in This Library" as a
// one-click bulk operation, and a user clearing translator noise would strip these too --
// taking with them the predicate that makes the resolution commands appear at all, leaving
// the items unresolvable with no error anywhere. These are workflow state, not harvested
// metadata.
var TAG_TYPE_MANUAL = 0;

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

// The per-format bound for a CFB container, which needs its whole directory walked rather
// than a leading header region. The .eml number above deliberately does NOT move: raising
// it would be a straight regression buying nothing, since a 256 KB prefix contains any
// RFC 5322 header region by construction. The selection is on `kind`.
var CONTAINER_READ_CAP = 33554432;   // 32 MB

// Read as a preference value only. Taking a dependency on the other plugin's API is
// forbidden by the architecture constraint that motivates the tier-0 check, and neither
// function involved is reachable through a public surface in any case.
var ZOTMOOV_DST_PREF = 'extensions.zotmoov.dst_dir';

// ===== Diagnostics =====

// Gated on the debugLogging pref and emitted through Zotero.debug, never Zotero.logError:
// logSafe is untouched and keeps emitting on every failure regardless of the pref, because
// errors are not opt-in. What this pref buys is the SUCCESSFUL path, which logSafe
// deliberately never reports.
//
// EMISSION PROHIBITION, which is a correctness constraint and not a style preference. This
// may emit attachment keys, outcome codes, the detected kind and counts. It must NOT emit
// subject, sender or recipient names or addresses, Message-ID, or FILE PATHS. The path
// prohibition is the non-obvious one: ZotMoov renames files from item metadata, so a
// post-promotion path carries the subject and the author into a log a user pastes into a
// public issue.
function debugTrace(msg) {
    if (EmailIntake.getPref('debugLogging') !== true) return;
    Zotero.debug('emailintake ' + msg);
}

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

// ===== Tier 0: the already-filed detector =====

// True when the candidate is a linked file sitting inside the other plugin's destination
// directory -- a file that has already been moved out from under this one. That is the
// same state which produces the md5Async-returns-false hazard in the identity comparison,
// which is why it is caught here before anything else runs.
//
// The two normalization decisions below both trade a false positive for a false negative
// deliberately, and the DIRECTION is what matters. A false NEGATIVE promotes a message that
// was already filed, creating a second parent item the duplicate ladder's own tiers then
// catch -- recoverable, and the ordinary path. A false POSITIVE skips a legitimate drop
// with nothing but a logSafe line the user will not read.
async function isAlreadyFiled(attachment) {
    // Cheap discriminator first: only a linked file can be inside the destination at all.
    if (attachment.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_FILE) return false;

    const dir = Zotero.Prefs.get(ZOTMOOV_DST_PREF, true);
    // NOT optional. A naive startsWith against an empty directory is true for EVERY path,
    // so a user without that plugin configured would have every drop skipped and nothing
    // would ever promote.
    if (typeof dir !== 'string' || dir === '') return false;

    const path = await attachment.getFilePathAsync();
    if (!path) return false;

    // Compare SEGMENTS, not string prefixes. This is the whole of the normalization: it
    // makes a trailing separator on the pref value irrelevant, it is correct on both
    // separator conventions without branching, and it cannot produce the classic prefix
    // false positive where `.../zotero-files-old` matches `.../zotero-files`, because the
    // two differ in a segment rather than in a character.
    //
    // Symlinks are deliberately NOT resolved (an extra IO call per item on the hot path,
    // plus a throw path for a file that has moved) and case is deliberately NOT folded
    // (which would create real false positives on a case-sensitive filesystem). Note this
    // is the opposite trade from Attachment Scanner, which lowercases -- correctly, because
    // its output is a report a human reviews, while this one silently skips.
    const dirParts = PathUtils.split(dir);
    const fileParts = PathUtils.split(path);
    if (fileParts.length <= dirParts.length) return false;
    for (let i = 0; i < dirParts.length; i++) {
        if (fileParts[i] !== dirParts[i]) return false;
    }
    return true;
}

// ===== Duplicate ladder =====

// Tier-3 lookups performed this session. Exposed for Validation item 5, which reads it in
// Run JavaScript after a fifty-copy drop and expects 1 -- the tier-2 map having suppressed
// the other forty-nine. Deliberately never reset by the batch loop: the check reads it once
// after a single drop, and a per-batch reset would make the reading depend on when it was
// taken.
EmailIntake._searchCount = 0;

// A Message-ID is only a usable key when it is present and syntactically plausible. A
// message with none, or with a malformed one, skips the gate entirely and promotes,
// because a dedup key that cannot be trusted is worse than no dedup. An absent key is
// LEGITIMATE rather than malformed on the MAPI fallback path -- a message that never
// traversed SMTP was never assigned one.
function usableMessageId(payload) {
    const line = (payload && payload.extra) || '';
    const m = /^Message-ID:\s*(<[^>\s]+@[^>\s]+>)\s*$/m.exec(line);
    return m ? m[1] : null;
}

// The tier-3 search returns a SUPERSET and must be verified here before the gate acts.
// `contains` compiles to LIKE with % wrapped around the value, and SQLite honours % and _
// inside the bound pattern with no ESCAPE clause available through that API -- and _ is
// legal and common in real Message-IDs. LIKE is additionally case-insensitive for ASCII
// while RFC 5322 Message-IDs are case-sensitive. So confirm exactly, in JS, that some line
// of the item's extra equals the stored form.
function extraCarriesMessageId(item, messageId) {
    const extra = item.getField('extra') || '';
    const want = 'Message-ID: ' + messageId;
    return extra.split(/\r?\n/).some(line => line.trim() === want);
}

// Children whose FILENAME extension marks them as one of ours. Never filter on
// attachmentContentType: the host's MIME sniffer maps a leading "From" to text/plain, so an
// .eml beginning "From:" is typed one way while one beginning "Received:" falls through to
// the OS registry, and filtering on it would silently skip half the set.
function emailChildrenOf(existing) {
    // No argument: the signature is getAttachments(includeTrashed) and the default already
    // filters trashed rows, which is what is wanted.
    const ids = existing.getAttachments();
    const out = [];
    for (const id of ids) {
        const child = Zotero.Items.get(id);
        if (!child || !child.isFileAttachment()) continue;
        const name = child.attachmentFilename || '';
        if (/\.(eml|msg)$/i.test(name)) out.push(child);
    }
    return out;
}

// Positively establish identity before any reparent -- a wrong reparent is the one
// destructive outcome in the whole plan. Returns one of the three outcome codes.
//
// Compare against EVERY surviving child, not the first of any type: an item holding a PDF
// and an .eml is the ordinary case, and comparing against the PDF would withhold against a
// record whose identical .eml sibling was never read.
async function compareAgainstExisting(attachment, existing) {
    const children = emailChildrenOf(existing);
    if (children.length === 0) return 'E_COMPARE_UNAVAILABLE';

    const ourPath = await attachment.getFilePathAsync();
    if (!ourPath) return 'E_COMPARE_UNAVAILABLE';

    let ourStat;
    try { ourStat = await IOUtils.stat(ourPath); }
    catch (e) { return 'E_COMPARE_UNAVAILABLE'; }

    let sawComparable = false;
    for (const child of children) {
        const theirPath = await child.getFilePathAsync();
        if (!theirPath) continue;

        let theirStat;
        try { theirStat = await IOUtils.stat(theirPath); }
        catch (e) { continue; }

        sawComparable = true;
        // Size first, awaited. An unawaited IOUtils.stat yields a Promise whose .size is
        // undefined, and undefined === undefined compares equal for ANY two files, which is
        // a wrong reparent. A size mismatch means the files differ, with no hash computed.
        if (theirStat.size !== ourStat.size) continue;

        const ourHash = await Zotero.Utilities.Internal.md5Async(ourPath);
        const theirHash = await Zotero.Utilities.Internal.md5Async(theirPath);
        // md5Async returns FALSE on NotFoundError and re-throws every other error, so a
        // missing file does not throw -- it returns a value. Comparing two false results
        // yields equality and reparents on two files neither of which was read; comparing
        // one false against a real digest yields inequality and files an unread comparison
        // as a withhold, telling the user a difference was established when none was.
        if (ourHash === false || theirHash === false) return 'E_COMPARE_UNAVAILABLE';
        if (ourHash === theirHash) return 'E_DUPLICATE_ATTACHED';
    }

    return sawComparable ? 'E_DUPLICATE_WITHHELD' : 'E_COMPARE_UNAVAILABLE';
}

// Tag a standalone attachment in its own saveTx. There is no withhold transaction for this
// to ride: a withhold creates nothing and opens no transaction. The write fires a notifier
// `modify` on an attachment the convergence guard does NOT skip -- the guard tests
// parentItemID and a withheld attachment has none -- and it is safe only because the
// observer returns immediately unless event === 'add'. Any future widening of the observer
// to `modify` must revisit this line before it ships.
async function tagStandalone(attachment, tagName) {
    attachment.addTag(tagName, TAG_TYPE_MANUAL);
    await attachment.saveTx();
}

// Act on an established duplicate. Identical reparents inside ONE transaction; the other
// two leave the attachment exactly as dropped and tag it, per R20.
async function applyDuplicateOutcome(attachment, existing, outcome) {
    if (outcome === 'E_DUPLICATE_ATTACHED') {
        await Zotero.DB.executeTransaction(async function () {
            attachment.parentID = existing.id;
            attachment.addTag(TAG_AUTO_ATTACHED, TAG_TYPE_MANUAL);
            await attachment.save();
        });
        return outcome;
    }
    // Both withhold branches tag identically; the codes differ so the summary can tell them
    // apart, which is what makes E_COMPARE_UNAVAILABLE visible rather than folded in.
    await tagStandalone(attachment, TAG_DUPLICATE);
    return outcome;
}

/**
 * The gate. Returns an outcome code when it acted, or null to let promotion proceed.
 *
 * Tier 1 (the convergence guard) lives in detectAttachmentKind, which returns null for any
 * attachment carrying a parentItemID -- it is the first tier of the ladder and is named
 * here because the ladder is otherwise incomplete.
 */
async function duplicateGate(attachment, payload, batchMap) {
    if (EmailIntake.getPref('duplicateHandling') === 'off') return null;

    const messageId = usableMessageId(payload);
    if (messageId === null) return null;

    // Tier 2 -- in-batch map. A Map rather than a Set because a hit must resolve to a
    // SPECIFIC parent before it can act: the disposition needs a comparison target, and a
    // bare membership test cannot supply one.
    if (batchMap.has(messageId)) {
        const existing = Zotero.Items.get(batchMap.get(messageId));
        if (existing) {
            debugTrace('tier 2 hit ' + attachment.key);
            const outcome = await compareAgainstExisting(attachment, existing);
            return await applyDuplicateOutcome(attachment, existing, outcome);
        }
    }

    // Tier 3 -- search as a CANDIDATE GENERATOR, verified in JS below.
    EmailIntake._searchCount++;
    const search = new Zotero.Search();
    search.libraryID = attachment.libraryID;
    search.addCondition('extra', 'contains', messageId);
    const ids = await search.search();

    for (const id of ids) {
        const item = Zotero.Items.get(id);
        if (!item || item.isAttachment()) continue;
        if (!extraCarriesMessageId(item, messageId)) continue;   // discard the over-match
        debugTrace('tier 3 hit ' + attachment.key);
        const outcome = await compareAgainstExisting(attachment, item);
        return await applyDuplicateOutcome(attachment, item, outcome);
    }

    return null;
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
// `options.skipDuplicateGate` is the resolution commands' opt-out and nothing else's. The
// polarity is opt-OUT rather than opt-in deliberately: a future call site that omits the
// argument is GATED, and a lost gate on the drop path re-opens R9 while a spurious gate on
// a command is only the defect this parameter exists to fix. See the gate call below.
async function promoteAttachment(attachment, kind, batchMap, options) {
    const path = await attachment.getFilePathAsync();
    if (_shuttingDown) throw new Error('E_SHUTDOWN');
    if (!path) throw new Error('E_HEADER_MALFORMED');

    // The read bound is PER FORMAT at this single read site. A CFB container's directory
    // walk needs the whole file, which R16's 262144-byte header bound cannot serve.
    const cap = kind === 'msg' ? CONTAINER_READ_CAP : HEADER_READ_CAP;

    // The oversize check runs on stat BEFORE the read, never by reading and measuring:
    // refusing a 200 MB container must not first allocate 200 MB. This is also what makes
    // the refusal observably constant-time in Validation item 11.
    if (kind === 'msg') {
        const info = await IOUtils.stat(path);
        if (info.size > CONTAINER_READ_CAP) throw new Error('E_CONTAINER_TOO_LARGE');
    }

    // R16 verbatim for the .eml branch: one capped read, keeping the Uint8Array in hand,
    // then one explicit decode. Zotero.File.getContentsAsync(path, 'utf-8', 262144) is the
    // same two operations behind one call, but adopting it would change a decision the
    // architecture states in a named paragraph, which A6 would then require recording.
    const bytes = await IOUtils.read(path, { maxBytes: cap });
    if (_shuttingDown) throw new Error('E_SHUTDOWN');

    // One call rather than a branch. parseMsg runs the existing parser unchanged where the
    // container carries transport headers, and the three-property MAPI fallback where it
    // does not; a null return is the honest decline for a container yielding neither a
    // subject nor a sender.
    let parsed;
    if (kind === 'msg') {
        parsed = parseMsg(bytes);
        if (parsed === null) throw new Error('E_HEADER_MALFORMED');
    }
    else {
        // parseHeaders throws E_TOO_LARGE on a missing header terminator and
        // E_HEADER_MALFORMED past the header-count cap. Both propagate to the per-item
        // catch, which is the whole signalling contract -- the pure module cannot log.
        parsed = parseHeaders(new TextDecoder('utf-8').decode(bytes));
    }

    const payload = mapToPayload(parsed, readRecipientCap());

    // The gate runs after detection and parse, before the promoter proper, and
    // short-circuits at the cheapest tier that resolves.
    //
    // It is skipped ONLY for a user-initiated resolution command. Both of those commands
    // exist because the gate's decision was a guess about user intent, so re-running the
    // gate on the path the user took to OVERRIDE it re-applies the decision being overridden
    // and the command silently undoes itself. The two arms fail differently and both were
    // observed or established by reading: a split re-promotes, tier 3 finds the parent just
    // detached from, the files are byte-identical, and the attachment is reparented onto the
    // same item; a promote-as-separate re-promotes, tier 3 finds the existing item, the files
    // differ by construction (that is why it was withheld), and applyDuplicateOutcome re-adds
    // the very tag the command is about to remove. In both cases the user sees the tag
    // disappear and nothing else change.
    if (!(options && options.skipDuplicateGate === true)) {
        const gated = await duplicateGate(attachment, payload, batchMap);
        if (gated !== null) return gated;
    }

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

    // Populate tier 2 as each item is promoted, so the next copy in this same batch
    // resolves without a database round trip. A message carrying no usable Message-ID has
    // no key, so a batch of N copies of such a message misses tier 2, skips tier 3, and
    // produces N parent items -- correct under R9, which has no sound key to offer here.
    const key = usableMessageId(payload);
    if (key !== null) batchMap.set(key, parentItem.id);

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

// E_DUPLICATE_ATTACHED -> emailintake-summary-duplicate-attached. Derived rather than
// tabulated so a code added to SUMMARY_CLAUSE_CODES cannot silently miss its string: a
// missing Fluent id is visible at once, whereas a missing table row would fall through.
function summaryStringID(code) {
    return 'emailintake-summary-' + code.replace(/^E_/, '').toLowerCase().replace(/_/g, '-');
}

// One window per notify, populated once at the end with counts. No progress bar and no
// per-item update: the batch is short and a bar over a sub-second loop is noise.
//
// The predicate is `ids.length > 1 OR any outcome is not a plain promotion`, and the
// second disjunct is written against the sentinel rather than against a list of codes --
// see OUTCOME_PROMOTED for why an enumeration would silently go blind to Phase 3b's
// outcomes.
function summariseBatch(itemCount, outcomes) {
    var promoted = 0;
    var residual = 0;
    var clauseCounts = {};
    for (var c = 0; c < SUMMARY_CLAUSE_CODES.length; c++) clauseCounts[SUMMARY_CLAUSE_CODES[c]] = 0;

    for (var i = 0; i < outcomes.length; i++) {
        if (outcomes[i] === OUTCOME_PROMOTED) promoted++;
        else if (SUMMARY_CLAUSE_CODES.indexOf(outcomes[i]) !== -1) clauseCounts[outcomes[i]]++;
        else residual++;
    }

    // The guard is rewritten WITH the bucket split, and this is the one part of the change
    // that fails silently if it is not. The old guard tested the residual alone, which used
    // to be the total of every non-promoted outcome. Split the bucket and it stops meaning
    // that: a single-file drop that is withheld has residual === 0 and a clause count of 1,
    // so the window would not be drawn at all -- precisely "a silent withhold reads as the
    // plugin did not fire". Guard on the non-promoted TOTAL across both buckets, which
    // keeps the D2 predicate `outcome !== OUTCOME_PROMOTED` exactly as stated.
    //
    // Both call sites pass outcomes.length as itemCount, so the two arguments are always
    // equal and the first clause is a test on the outcome array's length.
    var nonPromoted = outcomes.length - promoted;
    if (itemCount <= 1 && nonPromoted === 0) return;

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
        // Promoted clause, then one clause per CLAUSE CODE with a non-zero count in array
        // order, then the skipped clause only when the residual is non-zero. Iterating
        // SUMMARY_CLAUSE_CODES rather than the tally's keys is what fixes the order.
        var parts = [EmailIntake.getLocalizedString('emailintake-summary-promoted', { count: promoted })];
        for (var k = 0; k < SUMMARY_CLAUSE_CODES.length; k++) {
            var code = SUMMARY_CLAUSE_CODES[k];
            if (clauseCounts[code] === 0) continue;
            parts.push(EmailIntake.getLocalizedString(summaryStringID(code), { count: clauseCounts[code] }));
        }
        if (residual > 0) {
            parts.push(EmailIntake.getLocalizedString('emailintake-summary-skipped', { count: residual }));
        }

        EmailIntake.createProgressWindow(
            EmailIntake.getLocalizedString('emailintake-progress-headline'),
            parts.join(' '),
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
async function processOne(item, batchMap) {
    const kind = await detectAttachmentKind(item);
    if (_shuttingDown) throw new Error('E_SHUTDOWN');
    if (kind === null) return null;                    // not ours; not counted at all
    debugTrace('detected ' + kind + ' ' + item.key);

    // Tier 0, before anything reads or writes. A file already moved out from under this
    // plugin is left alone and reported once through the structured log.
    if (await isAlreadyFiled(item)) {
        logSafe(item.key, 'E_ALREADY_FILED');
        return 'E_ALREADY_FILED';
    }

    const outcome = await promoteAttachment(item, kind, batchMap);
    debugTrace('outcome ' + outcome + ' ' + item.key);
    return outcome;
}

// The onParseFailure consumer. On "leave" -- the shipped default -- nothing happens. On
// "tag" the item is left exactly as dropped, per R20, and additionally tagged. Failures
// here must never cost the batch its result, so a tag write that throws is logged and
// swallowed rather than propagated.
async function applyParseFailureTag(item, outcome) {
    if (PARSE_FAILURE_TAG_CODES.indexOf(outcome) === -1) return;
    if (EmailIntake.getPref('onParseFailure') !== 'tag') return;
    try { await tagStandalone(item, TAG_PARSE_FAILED); }
    catch (e) { logSafe(item && item.key, 'E_UNEXPECTED'); }
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
        // Tier-2 map: Message-ID -> the id of the parent created for it during THIS notify.
        // Two lifetimes, deliberately not shared. This one lives for the whole batch and is
        // cleared once, in the finally below. It is NOT the per-item in-flight guard from
        // Phase 1, which is released per item so a throw cannot poison an entry for the rest
        // of the session. Clearing this map per item would empty it before the second item
        // is reached and tier 2 would never fire -- invisibly, because the ladder still
        // produces correct results one tier down.
        const batchMap = new Map();

        try {
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

                outcome = await processOne(item, batchMap);
                if (_shuttingDown) return;
                await applyParseFailureTag(item, outcome);
            }
            catch (e) {
                outcome = codeFromError(e);
                logSafe(ids[i], outcome);
                // Teardown began mid-batch. Stop, and draw no window: a progress window
                // raised into a shutting-down window set is worse than no summary.
                if (outcome === 'E_SHUTDOWN') return;
                await applyParseFailureTag(Zotero.Items.get(ids[i]), outcome);
            }
            // null means the item was never ours -- a PDF dropped alongside the mail.
            // Those are not counted, or a mixed drop would always trip the predicate.
            if (outcome !== null) outcomes.push(outcome);
        }
        }
        finally {
            // Cleared ONCE, around the whole batch. See the declaration above for why a
            // per-item clear would silently disable tier 2.
            batchMap.clear();
        }

        debugTrace('batch complete, ' + outcomes.length + ' counted');
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
    const batchMap = new Map();
    try {
        for (let i = 0; i < items.length; i++) {
            let outcome = null;
            try {
                outcome = await processOne(items[i], batchMap);
                if (_shuttingDown) return;
                await applyParseFailureTag(items[i], outcome);
            }
            catch (e) {
                outcome = codeFromError(e);
                logSafe(items[i] && items[i].key, outcome);
                if (outcome === 'E_SHUTDOWN') return;
                await applyParseFailureTag(items[i], outcome);
            }
            if (outcome !== null) outcomes.push(outcome);
        }
    }
    finally {
        batchMap.clear();
    }
    if (outcomes.length > 0) summariseBatch(outcomes.length, outcomes);
}

// ===== Resolution commands (R12) =====

// The three-button prompt both resolution commands use. Buttons 0 and 1 are the two
// outcomes, labelled from Fluent; button 2 is flagged BUTTON_TITLE_CANCEL, which supplies
// the platform's own Cancel label -- so no Fluent string is owed for it -- and makes ESC
// and window-close resolve deterministically to index 2 rather than to whichever button
// the platform happens to treat as the escape.
//
// Returns 0, 1, or 2. Only 0 and 1 act; 2 and any dismissal leave the item untouched. That
// asymmetry is the point: both commands exist because the gate's decision was a guess, and
// a modal that cannot be declined would force a second guess out of a user who opened it
// to look.
//
// confirmEx is MODAL and SYNCHRONOUS. That is safe here because both commands are
// user-initiated from a context menu; it must never be called from the observer path,
// where it would block the batch behind a dialog the user may not be looking at.
function askTwoOutcomes(titleID, bodyID, option0ID, option1ID) {
    const ps = Services.prompt;
    const flags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
        + ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING
        + ps.BUTTON_POS_2 * ps.BUTTON_TITLE_CANCEL;
    return ps.confirmEx(
        Zotero.getMainWindow(),
        EmailIntake.getLocalizedString(titleID),
        EmailIntake.getLocalizedString(bodyID),
        flags,
        EmailIntake.getLocalizedString(option0ID),
        EmailIntake.getLocalizedString(option1ID),
        null, null, {}
    );
}

function taggedItems(ctx, tagName) {
    return ((ctx && ctx.items) || []).filter(it => it && it.hasTag && it.hasTag(tagName));
}

// ===== Menu visibility predicates =====
//
// SYNCHRONOUS BY NECESSITY, and this is not a style choice. MenuManager invokes onShowing
// inline while the popup is being built and discards the return value, so a promise returned
// here is never awaited and the entry renders with its default visibility. That rules out
// detectAttachmentKind, which reads the file. The filename extension is the only synchronous
// discriminant available and it is the right one for a MENU: the command itself still runs
// the magic-byte sniff, so a PDF misnamed .eml is offered the command and correctly declined
// by it. The reverse error -- an .eml named .txt -- loses the menu entry, which is the safe
// direction, and the drop path is unaffected because it never consults the menu.
//
// FAILURE IS OPEN, NOT CLOSED. The plugin API wraps every plugin-supplied callback and
// swallows a throw, returning a fallback without touching the element -- and `hidden`
// defaults to unset, so a predicate that throws leaves the entry VISIBLE. The per-item catch
// below is what keeps one malformed item in a multi-select from revealing every entry.
function anySelected(ctx, predicate) {
    const items = (ctx && ctx.items) || [];
    for (const it of items) {
        try { if (it && predicate(it)) return true; }
        catch (e) { /* one bad item must not reveal the entry; see the note above */ }
    }
    return false;
}

function looksLikeEmailFile(it) {
    return typeof it.isFileAttachment === 'function'
        && it.isFileAttachment()
        && !it.parentItemID
        && /\.(eml|msg)$/i.test(it.attachmentFilename || '');
}

// An attachment THIS PLUGIN promoted: the message file, under a parent we created. Both
// halves are load-bearing and the defect this closes was a user's PDF. `parentItemID` alone
// matches every parented attachment in the library, and the command is NOT inert when
// clicked -- repromoteSelected renames the file on disk from the parent's metadata and
// overwrites the attachment title, an unrequested rewrite of a record we did not create.
// Extension alone would leave an .eml hand-attached to a journalArticle in scope; parent
// type alone would leave a PDF attached to one of our email items in scope.
//
// SYNCHRONOUS, which is what makes the parent test available to a predicate at all.
// Zotero.Items.get returns the cached object, `false` for an unknown id, and THROWS
// UnloadedDataException for a registered-but-unloaded id. That throw is caught per item by
// anySelected, so an unloaded parent yields a HIDDEN entry -- fail-closed. It is NOT the
// fail-open case the block comment above warns about, which is a throw escaping onShowing
// itself; the difference is that this call sits inside anySelected's catch.
function isOurPromotedAttachment(it) {
    if (typeof it.isFileAttachment !== 'function' || !it.isFileAttachment()) return false;
    if (!it.parentItemID) return false;
    if (!/\.(eml|msg)$/i.test(it.attachmentFilename || '')) return false;
    const parent = Zotero.Items.get(it.parentItemID);
    return !!parent && parent.itemType === 'email';
}

function hasPluginTag(it, tagName) {
    return typeof it.hasTag === 'function' && it.hasTag(tagName);
}

// ctx.setVisible is supplied by the platform's default menu context and is guarded because
// the underlying element is held by a WeakRef that may already be gone.
function setMenuVisible(ctx, visible) {
    if (ctx && typeof ctx.setVisible === 'function') ctx.setVisible(visible);
}

// Detach an attachment from its parent and give it its own item, reusing the promoter.
async function splitOutOfParent(attachment, batchMap) {
    await Zotero.DB.executeTransaction(async function () {
        attachment.parentID = false;
        await attachment.save();
    });
    const kind = await detectAttachmentKind(attachment);
    if (kind === null) return 'E_NOT_EMAIL';
    // The gate is skipped: this call IS the user overriding the gate's decision, and the
    // attachment was detached from the very parent tier 3 would find one line later.
    return await promoteAttachment(attachment, kind, batchMap, { skipDuplicateGate: true });
}

async function removeTag(attachment, tagName) {
    attachment.removeTag(tagName);
    await attachment.saveTx();
}

// On a #duplicate-message attachment: attach it to the existing item, or promote it as a
// separate item. Whichever the user picks, the tag is removed.
async function resolveDuplicate(ctx) {
    for (const attachment of taggedItems(ctx, TAG_DUPLICATE)) {
        try {
            const choice = askTwoOutcomes(
                'emailintake-resolve-duplicate-title',
                'emailintake-resolve-duplicate-body',
                'emailintake-resolve-duplicate-attach',
                'emailintake-resolve-duplicate-separate'
            );
            if (choice === 2) continue;

            if (choice === 0) {
                // The tag is a MARKER and carries no pointer to the item it matched, so the
                // target is re-derived by re-running the tier-3 lookup. If nothing matches
                // any more -- the other item was deleted or its extra was edited -- there is
                // nothing to attach to, and the honest result is to report and leave the tag
                // in place rather than guess at a parent.
                const payload = await payloadFor(attachment);
                const messageId = payload === null ? null : usableMessageId(payload);
                const existing = messageId === null ? null : await findExistingByMessageId(attachment, messageId);
                if (existing === null) { logSafe(attachment.key, 'E_COMPARE_UNAVAILABLE'); continue; }
                await Zotero.DB.executeTransaction(async function () {
                    attachment.parentID = existing.id;
                    await attachment.save();
                });
            }
            else {
                // A null return means detection failed -- the file no longer resolves, or it
                // is no longer one of ours. Nothing was promoted, so the tag must stay: it is
                // the ONLY predicate that makes this command appear, and removing it on a
                // no-op leaves the item permanently unresolvable with no error the user sees.
                const promoted = await promoteSelectedOne(attachment);
                if (promoted === null) { logSafe(attachment.key, 'E_NOT_EMAIL'); continue; }
            }
            await removeTag(attachment, TAG_DUPLICATE);
        }
        catch (e) {
            logSafe(attachment && attachment.key, codeFromError(e));
        }
    }
}

// On a #auto-attached-duplicate attachment: keep the auto-attachment, or split it out into
// its own item. Whichever the user picks, the tag is removed.
async function reviewAutoAttached(ctx) {
    for (const attachment of taggedItems(ctx, TAG_AUTO_ATTACHED)) {
        try {
            const choice = askTwoOutcomes(
                'emailintake-review-auto-title',
                'emailintake-review-auto-body',
                'emailintake-review-auto-keep',
                'emailintake-review-auto-split'
            );
            if (choice === 2) continue;

            if (choice === 1) {
                const batchMap = new Map();
                let split;
                try { split = await splitOutOfParent(attachment, batchMap); }
                finally { batchMap.clear(); }
                // Same reasoning as the resolve-duplicate arm: on E_NOT_EMAIL the detach has
                // already happened and no parent was created, so the honest state is a
                // standalone attachment that still carries its tag. Removing the tag here
                // would report a split that did not occur and strip the predicate that makes
                // this command appear.
                if (split === 'E_NOT_EMAIL') { logSafe(attachment.key, 'E_NOT_EMAIL'); continue; }
            }
            await removeTag(attachment, TAG_AUTO_ATTACHED);
        }
        catch (e) {
            logSafe(attachment && attachment.key, codeFromError(e));
        }
    }
}

// Re-run the promoter's rename-and-title sequence on a parented attachment, which is the
// affordance the architecture names as the reason the promoter does not have to be
// infallible.
async function repromoteSelected(ctx) {
    for (const attachment of ((ctx && ctx.items) || [])) {
        try {
            if (!attachment || !attachment.parentItemID) continue;
            const parentItem = Zotero.Items.get(attachment.parentItemID);
            if (!parentItem) continue;
            await renameAttachmentFromParent(attachment, parentItem);
        }
        catch (e) {
            logSafe(attachment && attachment.key, codeFromError(e));
        }
    }
}

// Parse one attachment to a payload without writing anything, or null.
async function payloadFor(attachment) {
    const kind = await detectAttachmentKind(attachment);
    if (kind === null) return null;
    const path = await attachment.getFilePathAsync();
    if (!path) return null;
    const cap = kind === 'msg' ? CONTAINER_READ_CAP : HEADER_READ_CAP;
    const bytes = await IOUtils.read(path, { maxBytes: cap });
    const parsed = kind === 'msg'
        ? parseMsg(bytes)
        : parseHeaders(new TextDecoder('utf-8').decode(bytes));
    if (parsed === null) return null;
    return mapToPayload(parsed, readRecipientCap());
}

// The tier-3 lookup on its own, for the resolution commands. Verified in JS exactly as the
// gate verifies it, because the search is a candidate generator in both places.
async function findExistingByMessageId(attachment, messageId) {
    EmailIntake._searchCount++;
    const search = new Zotero.Search();
    search.libraryID = attachment.libraryID;
    search.addCondition('extra', 'contains', messageId);
    const ids = await search.search();
    for (const id of ids) {
        const item = Zotero.Items.get(id);
        if (!item || item.isAttachment()) continue;
        if (item.id === attachment.parentItemID) continue;
        if (extraCarriesMessageId(item, messageId)) return item;
    }
    return null;
}

// Called only from resolveDuplicate's "promote as a separate item" arm. The gate is skipped
// for the reason stated at the gate call: the withheld file differs from the existing one by
// construction, so re-gating reaches E_DUPLICATE_WITHHELD and re-tags the attachment the
// caller is about to untag.
async function promoteSelectedOne(attachment) {
    const batchMap = new Map();
    try {
        const kind = await detectAttachmentKind(attachment);
        if (kind === null) return null;
        return await promoteAttachment(attachment, kind, batchMap, { skipDuplicateGate: true });
    }
    finally { batchMap.clear(); }
}

// ===== Lifecycle =====

EmailIntake.shutdown = function () {
    _shuttingDown = true;
    // The three ids this phase adds are stored on the same terms Phase 1 established for
    // the promote menu: the platform unregisters a plugin's menus itself at shutdown, so
    // the stored ids are belt-and-braces rather than the mechanism, and nothing here calls
    // an unregister. That is deliberate and NOT an omission -- see the note beside
    // _menuIDs in main() and the identical one beside _menuID.
    EmailIntake._menuIDs = [];
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
                onShowing: (ev, ctx) => setMenuVisible(ctx, anySelected(ctx, looksLikeEmailFile)),
                onCommand: (ev, ctx) => promoteSelected(ctx)
            }]
        });
    }
    catch (e) {
        logSafe('-', 'E_MENU_REGISTER_FAILED');
    }

    // The remaining three R12 commands. Written out rather than looped for two reasons:
    // one failing registration must not cost the others, and the Definition of Done counts
    // the localization-id property occurrences against the number of registrations, and a
    // loop would register three menus behind a single occurrence, making that check read
    // wrong while being right. This comment avoids spelling that property name for the
    // same reason invariants.sh never spells the literals it bans -- it would count itself.
    // Each stores the RETURNED id, never the input key, which the API namespaces.
    EmailIntake._menuIDs = [];
    try {
        EmailIntake._menuIDs.push(Zotero.MenuManager.registerMenu({
            menuID: 'emailintake-repromote',
            pluginID: 'emailintake@lassiterdc.github.io',
            target: 'main/library/item',
            menus: [{
                menuType: 'menuitem',
                l10nID: 'emailintake-repromote-label',
                onShowing: (ev, ctx) => setMenuVisible(ctx, anySelected(ctx, isOurPromotedAttachment)),
                onCommand: (ev, ctx) => repromoteSelected(ctx)
            }]
        }));
    }
    catch (e) { logSafe('-', 'E_MENU_REGISTER_FAILED'); }

    try {
        EmailIntake._menuIDs.push(Zotero.MenuManager.registerMenu({
            menuID: 'emailintake-resolve-duplicate',
            pluginID: 'emailintake@lassiterdc.github.io',
            target: 'main/library/item',
            menus: [{
                menuType: 'menuitem',
                l10nID: 'emailintake-resolve-duplicate-label',
                onShowing: (ev, ctx) => setMenuVisible(ctx,
                    anySelected(ctx, it => hasPluginTag(it, TAG_DUPLICATE))),
                onCommand: (ev, ctx) => resolveDuplicate(ctx)
            }]
        }));
    }
    catch (e) { logSafe('-', 'E_MENU_REGISTER_FAILED'); }

    try {
        EmailIntake._menuIDs.push(Zotero.MenuManager.registerMenu({
            menuID: 'emailintake-review-auto',
            pluginID: 'emailintake@lassiterdc.github.io',
            target: 'main/library/item',
            menus: [{
                menuType: 'menuitem',
                l10nID: 'emailintake-review-auto-label',
                onShowing: (ev, ctx) => setMenuVisible(ctx,
                    anySelected(ctx, it => hasPluginTag(it, TAG_AUTO_ATTACHED))),
                onCommand: (ev, ctx) => reviewAutoAttached(ctx)
            }]
        }));
    }
    catch (e) { logSafe('-', 'E_MENU_REGISTER_FAILED'); }

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
    if (kind !== null) {
        try {
            // Mirrors the promoter exactly, including the per-format bound and the pre-read
            // size refusal, so a file that declines in the application declines here for the
            // same stated reason. The .msg decline this affordance used to hardcode is gone
            // with the one in promoteAttachment.
            const cap = kind === 'msg' ? CONTAINER_READ_CAP : HEADER_READ_CAP;
            if (kind === 'msg') {
                const info = await IOUtils.stat(path);
                if (info.size > CONTAINER_READ_CAP) throw new Error('E_CONTAINER_TOO_LARGE');
            }
            const bytes = await IOUtils.read(path, { maxBytes: cap });
            const parsed = kind === 'msg'
                ? parseMsg(bytes)
                : parseHeaders(new TextDecoder('utf-8').decode(bytes));
            if (parsed === null) throw new Error('E_HEADER_MALFORMED');
            payload = mapToPayload(parsed, readRecipientCap());
        }
        catch (e) {
            outcome = codeFromError(e);
        }
    }

    return { path: path, kind: kind, outcome: outcome, payload: payload };
};
