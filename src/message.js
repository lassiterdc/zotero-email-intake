"use strict";

// Host-free half of the plugin's one seam. The host-object token that R14 and, from
// Phase 3, R03-pure-core forbid must not appear anywhere in this file -- including in
// these comments, since both rules are plain greps with no comment exemption. That
// prohibition is what lets `node --test` exercise this file with no host running.
//
// Declaration form is a correctness constraint, not a style choice: every top-level
// declaration here is a `function` declaration or a `var`, never `const`, `let`, or
// `class`. The host unloads a plugin's sandbox scope only on uninstall and upgrade,
// never on disable, so an in-session disable/re-enable re-runs every loadSubScript
// call in startup() into the SAME global. A top-level `const` would be a global
// lexical redeclaration on the second pass -- an early error that leaves the plugin
// enabled and inert with no visible error, masked by a full restart.
//
// `log` and `version` are reserved by the loader's flat global and must not be
// redeclared here.
//
// Every scan below is a single left-to-right index walk with `slice`, and every
// accumulation is an array plus one trailing `join('')`. Neither a repeated string
// concatenation nor a nested-quantifier regex appears anywhere in the file. That is
// the linear-time-parsing invariant from the architecture's security table, and it
// is why a 10,000-line folded header is linear here rather than quadratic.

var MONTH_NAMES = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
];

// Longest single header value that may cross this file's output boundary, in CODE
// POINTS. 998 is the hard per-line limit RFC 5322 s2.1.1 sets, so the cap cannot
// truncate a conforming single-line header; it is about 2.5x the longest real fixture
// and about 200x below the pathological 200 KB single value test/redos.test.js builds.
//
// This is NOT a filesystem control. The path end of the chain is already defended twice
// by the host, which truncates a title to 100 characters in its default attachment
// rename template and re-truncates on a too-long filename error with the platform byte
// limits built in. A cap chosen against the filesystem would duplicate that while
// truncating a real fixture. What this bounds is what reaches the database field and
// the cite-key generator.
var MAX_HEADER_VALUE_CHARS = 998;

// Most logical header lines one block may contain. The 256 KB bounded read already
// implies roughly 65,000 minimal lines, so this is about a 64x tightening rather than an
// unbounded-to-bounded change. Its purpose is to make the worst case a STATED constant
// instead of one derived from an unrelated byte cap, so a later change to the read size
// cannot loosen it silently. The largest real fixture carries six header lines.
var MAX_HEADER_LINES = 1024;

// Organisational-keyword set, enumerated by the Phase-2 plan rather than left to
// implementation time, because fixtures 0004 and 0007 both assert against it and
// 0007 exists specifically to pin its precedence over the token-count arm.
// Extending it is a one-line change plus a fixture.
var ORG_KEYWORDS = [
    'team', 'group', 'support', 'notification', 'notifications', 'noreply',
    'no-reply', 'admin', 'administrator', 'office', 'department', 'dept',
    'committee', 'council', 'board', 'staff', 'service', 'services', 'desk',
    'helpdesk', 'info', 'sales', 'marketing', 'billing', 'inc', 'llc', 'ltd',
    'corp', 'corporation', 'company', 'co', 'university', 'institute',
    'association', 'society', 'foundation', 'center', 'centre', 'lab',
    'laboratory'
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Classify a candidate file as `'eml'`, `'msg'`, or `null`.
 *
 * The extension is only a PRE-FILTER: it narrows which magic-byte test runs, and it
 * can never on its own return a positive. A PDF misnamed `.eml` is declined, which is
 * the case the architecture's content-sniffing paragraph names. `attachmentContentType`
 * is deliberately not consulted -- the MIME sniffer table types an `.eml` beginning
 * `From` as `text/plain` and one beginning `Received` by the OS registry, so it splits
 * the very set this function has to keep whole.
 */
function detect(bytes, filename) {
    var name = String(filename || '').toLowerCase();
    if (endsWith(name, '.eml')) {
        return looksLikeHeaderBlock(bytes) ? 'eml' : null;
    }
    if (endsWith(name, '.msg')) {
        return hasCfbMagic(bytes) ? 'msg' : null;
    }
    return null;
}

function endsWith(text, suffix) {
    if (text.length < suffix.length) return false;
    return text.slice(text.length - suffix.length) === suffix;
}

/** Compound File Binary signature: D0 CF 11 E0. */
function hasCfbMagic(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

/**
 * RFC 5322 has no magic number, so the sniff is structural: the first line must be a
 * well-formed header field -- a run of printable ASCII excluding the colon, then a
 * colon. `%PDF-` fails on the missing colon, which is the discriminator the detect
 * test asserts.
 */
function looksLikeHeaderBlock(bytes) {
    if (!bytes || bytes.length === 0) return false;
    var limit = bytes.length < 998 ? bytes.length : 998;
    var i = 0;
    for (; i < limit; i++) {
        var b = bytes[i];
        if (b === 0x3A) return i > 0;            // ':' -- and a field name may not be empty
        if (b === 0x0D || b === 0x0A) return false;
        if (b < 0x21 || b > 0x7E) return false;  // printable ASCII only in a field name
    }
    return false;
}

// ---------------------------------------------------------------------------
// MSG containers
// ---------------------------------------------------------------------------

// PR_TRANSPORT_MESSAGE_HEADERS, tag 0x007D, PT_UNICODE. Where a message traversed
// SMTP this stream carries the original RFC 5322 header block verbatim, which is what
// lets one parser serve both formats.
var PROP_TRANSPORT_HEADERS = '__substg1.0_007D001F';

// The three-property fallback for a container that never traversed SMTP and therefore
// carries no transport headers -- measured at 7 of 18 real files, concentrated in
// internal organisation mail and the sender's own Sent items. Each is PT_UNICODE, which
// is what the `001F` suffix encodes, so each is reachable through the same readStream
// path the transport-header property uses.
//
// There is deliberately NO date property here. Every real date property is PT_SYSTIME
// and therefore fixed-width, living packed in `__properties_version1.0` rather than in
// its own stream; parsing it is scheduled post-v1. PR_CONVERSATION_INDEX (0x0071) was
// considered and REJECTED even though it is stream-reachable and does encode a FILETIME:
// it carries the conversation's start time, so for any reply it is a different message's
// timestamp -- a precise, plausible, wrong value wearing the name of a real field.
var PROP_SUBJECT = '__substg1.0_0037001F';
var PROP_SENDER_NAME = '__substg1.0_0C1A001F';
var PROP_SENDER_EMAIL = '__substg1.0_0C1F001F';

/**
 * Resolve the CFB reader across both execution environments.
 *
 * In the plugin sandbox every file is evaluated into one flat global, so `readStream`
 * is simply in scope. Under `node --test` each file is a separate module, so it has to
 * be required. This is the inbound mirror of the `typeof module !== 'undefined'` guard
 * at the foot of this file.
 *
 * The require is deliberately UNGUARDED. A try/catch here cannot distinguish "not
 * running in Node" from "src/cfb.js is broken", so it would convert a real defect into
 * a clean `null` -- and a clean null is exactly the signature that reads as "this
 * message never traversed SMTP", which is indistinguishable from correct behaviour.
 * Narrowing to `MODULE_NOT_FOUND` does not fix it either: cfb.js requiring something
 * missing of its own raises the same code and would be misattributed to cfb.js being
 * absent. Letting the error escape is what makes the failure name its own cause. The
 * branch is unreachable in the sandbox, where `readStream` resolves above and `require`
 * is not a granted global, so the trailing `return null` is the sandbox's degradation
 * path and the host-side per-item try/catch contains anything that does escape.
 */
function getStreamReader() {
    if (typeof readStream === 'function') return readStream;
    if (typeof require === 'function') return require('./cfb.js').readStream;
    return null;
}

/**
 * Extract the RFC 5322 header block from a MSG container, or null.
 *
 * The generator pads the stream with U+0000 to the mini-stream cutoff, and real
 * containers carry their own trailing padding, so the trim is required in both cases
 * rather than being an artifact of the fixture.
 */
function textFromMsg(bytes) {
    return unicodePropFromMsg(bytes, PROP_TRANSPORT_HEADERS);
}

/**
 * Read one PT_UNICODE property stream and return its text, or null.
 *
 * The trailing-U+0000 trim is required on EVERY property, not just the header block.
 * Real containers pad their streams, and the generated fixture pads each stream to the
 * mini-stream cutoff so that it routes through the reader's regular-sector path -- so an
 * untrimmed read yields thousands of NULs that would reach the item title, the cite key
 * computed from it, and the filename an external filing plugin derives from the item
 * metadata, while failing no type check anywhere along the way.
 */
function unicodePropFromMsg(bytes, name) {
    var reader = getStreamReader();
    if (reader === null) return null;

    var raw = reader(bytes, name);
    if (raw === null || raw.length === 0) return null;

    var text = new TextDecoder('utf-16le').decode(raw);
    var end = text.length;
    while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
    return text.slice(0, end);
}

/**
 * One entry point for a MSG container: a ParsedMessage, or null.
 *
 * The coupled side calls this rather than branching on which shape the container turned
 * out to have. Where the transport-header property is present the existing parser runs
 * unchanged, so a `.msg` and its `.eml` twin produce the identical result. Where it is
 * absent, three MAPI properties supply a reduced item.
 *
 * `date` and `messageId` are deliberately EMPTY on the fallback path rather than guessed.
 * A message that never traversed SMTP was never assigned a Message-ID, so an absent key
 * there is legitimate rather than malformed, and the duplicate ladder is written knowing
 * that. A dateless item is an already-supported shape; fixture 0005-missing-date
 * exercises it.
 *
 * Returns null only when neither path yields a subject or a sender, which is the honest
 * decline -- a container this reader cannot make anything of.
 */
function parseMsg(bytes) {
    var headerBlock = textFromMsg(bytes);
    if (headerBlock !== null) return parseHeaders(headerBlock);

    var subject = unicodePropFromMsg(bytes, PROP_SUBJECT) || '';
    var senderName = unicodePropFromMsg(bytes, PROP_SENDER_NAME) || '';
    var senderEmail = unicodePropFromMsg(bytes, PROP_SENDER_EMAIL) || '';

    if (subject === '' && senderName === '' && senderEmail === '') return null;

    return {
        subject: subject,
        from: { name: senderName, email: senderEmail },
        to: [],
        date: '',
        messageId: '',
        replyTo: null,
        contentLanguage: ''
    };
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Parse an RFC 5322 header block into a ParsedMessage:
 *
 *   { subject, from: {name, email}, to: [{name, email}], date, messageId,
 *     replyTo: {name, email} | null, contentLanguage }
 *
 * `text` may be CRLF- or LF-terminated; both unfold identically. `date` is ISO 8601
 * `YYYY-MM-DD`, never the RFC 5322 string.
 */
function parseHeaders(text) {
    var fields = readFields(String(text || ''));

    var fromList = parseAddressList(fields['from'] || '');
    var replyToList = parseAddressList(fields['reply-to'] || '');

    return {
        subject: decodeEncodedWords(fields['subject'] || ''),
        from: fromList.length > 0 ? fromList[0] : { name: '', email: '' },
        to: parseAddressList(fields['to'] || ''),
        date: toIsoDate(fields['date'] || ''),
        messageId: (fields['message-id'] || '').trim(),
        replyTo: replyToList.length > 0 ? replyToList[0] : null,
        contentLanguage: (fields['content-language'] || '').trim()
    };
}

/**
 * Unfold the header block and split each logical line on its FIRST colon.
 *
 * Unfolding maps a line break plus the following whitespace run onto exactly one
 * space. That is what makes fixture 0003's five continuation lines reassemble into a
 * 400-character subject with single-space token separators, and it is why a splitter
 * keying on `\n` alone -- leaving a trailing `\r` on every unfolded value -- is caught
 * by the CRLF half of every fixture assertion.
 *
 * First occurrence of a field name wins. Later duplicates are ignored.
 */
function readFields(text) {
    var end = findHeaderEnd(text);
    // A block with no terminator is aborted rather than parsed. Before this, a truncated
    // or body-less message had its ENTIRE content read as headers with no signal at all,
    // which is a silent wrong answer rather than a missing bound.
    if (end < 0) throw new Error('E_TOO_LARGE');

    var block = text.slice(0, end);
    // Null-prototype map, not `{}`. Header names are attacker-controlled and commitField
    // writes fields[name]; on a plain object a `__proto__:` line reaches
    // fields['__proto__'], and every later fields['subject'] read resolves through a
    // prototype chain the message touched. A string value makes that assignment a silent
    // no-op, so the plain-object form was safe by accident of the value type rather than
    // by construction.
    var fields = Object.create(null);
    var fragments = null;   // fragments of the logical line currently being built
    var committed = 0;      // logical lines committed, NOT unique field names
    var i = 0;
    var n = block.length;

    while (i <= n) {
        var nl = block.indexOf('\n', i);
        if (nl === -1) nl = n;
        var lineEnd = nl;
        if (lineEnd > i && block.charCodeAt(lineEnd - 1) === 13) lineEnd--;
        var line = block.slice(i, lineEnd);

        if (line.length > 0 && isWhitespaceCode(line.charCodeAt(0))) {
            if (fragments !== null) {
                var k = 0;
                while (k < line.length && isWhitespaceCode(line.charCodeAt(k))) k++;
                fragments.push(' ', line.slice(k));
            }
        } else {
            committed += commitField(fields, fragments);
            if (committed > MAX_HEADER_LINES) throw new Error('E_HEADER_MALFORMED');
            fragments = line.length > 0 ? [line] : null;
        }

        if (nl === n) break;
        i = nl + 1;
    }
    committed += commitField(fields, fragments);
    if (committed > MAX_HEADER_LINES) throw new Error('E_HEADER_MALFORMED');
    return fields;
}

/** Returns the number of LOGICAL LINES consumed -- 0 or 1 -- not whether a field was stored. */
function commitField(fields, fragments) {
    if (fragments === null) return 0;
    var line = fragments.join('');
    var colon = line.indexOf(':');
    // Still a logical line even when it is not a well-formed field, and the cap counts
    // line volume rather than accepted fields, so this returns 1 either way.
    if (colon <= 0) return 1;
    var name = line.slice(0, colon).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(fields, name)) return 1;
    fields[name] = trimLeadingWhitespace(line.slice(colon + 1));
    return 1;
}

/**
 * Offset of the blank line that terminates the header block, or -1 when there is none.
 *
 * Returning -1 rather than the end of input is the behaviour change: a caller can no
 * longer mistake "this input was entirely headers" for "this input never terminated".
 */
function findHeaderEnd(text) {
    var i = 0;
    var n = text.length;
    while (i < n) {
        var nl = text.indexOf('\n', i);
        if (nl === -1) return -1;
        var lineEnd = nl;
        if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
        if (lineEnd === i) return i;
        i = nl + 1;
    }
    return -1;
}

/**
 * The one sanitiser, applied at the mapper's output.
 *
 * Order is the whole point: values arrive here ALREADY decoded from RFC 2047, so this
 * validates after canonicalisation rather than before it. Three hazards it removes, all
 * live because a decoded subject reaches the cite-key and then a directory name: NUL
 * bytes, CR and LF (header injection), and unbounded length.
 *
 * Truncation is by CODE POINT, never by UTF-16 unit -- slicing a string directly can cut
 * a surrogate pair in half and emit a lone surrogate into the database.
 */
function sanitizeHeaderValue(value) {
    var text = (value === null || value === undefined) ? '' : String(value);
    var out = [];
    var pendingSpace = false;
    var started = false;

    for (var i = 0; i < text.length; i++) {
        var code = text.charCodeAt(i);

        // Whitespace runs -- including what unfolding left behind -- collapse to one
        // space, and a run at either end vanishes because it is never flushed.
        if (code === 9 || code === 32) {
            pendingSpace = started;
            continue;
        }
        // C0 (NUL, CR, LF and the rest), DEL, and C1 are dropped outright.
        if (code < 0x20 || code === 0x7F || (code >= 0x80 && code <= 0x9F)) continue;

        if (pendingSpace) { out.push(' '); pendingSpace = false; }
        // charAt yields one UTF-16 unit; both halves of a surrogate pair reach this in
        // order and neither is a control, so pairs survive the join intact.
        out.push(text.charAt(i));
        started = true;
    }

    var joined = out.join('');
    var points = Array.from(joined);
    if (points.length <= MAX_HEADER_VALUE_CHARS) return joined;
    return points.slice(0, MAX_HEADER_VALUE_CHARS).join('');
}

function isWhitespaceCode(code) {
    return code === 32 || code === 9;
}

function trimLeadingWhitespace(value) {
    var i = 0;
    while (i < value.length && isWhitespaceCode(value.charCodeAt(i))) i++;
    return value.slice(i);
}

// ---------------------------------------------------------------------------
// RFC 2047 encoded-words
// ---------------------------------------------------------------------------

/**
 * Decode every `=?charset?B|Q?text?=` encoded-word in a header value.
 *
 * Linear whitespace BETWEEN two adjacent encoded-words is removed rather than
 * preserved, per RFC 2047. Fixture 0006 is the pin: the space that belongs in the
 * decoded subject is carried inside the second word's own Base64 payload, so a decoder
 * that keeps the separator emits a double space.
 *
 * A malformed `=?` that does not close is left in the output verbatim rather than
 * swallowed -- silently deleting bytes from a header is worse than showing them.
 */
function decodeEncodedWords(value) {
    var out = [];
    var i = 0;
    var n = value.length;
    var gapStart = 0;
    var prevEncoded = false;

    while (i < n) {
        var start = value.indexOf('=?', i);
        if (start === -1) break;
        var word = readEncodedWord(value, start);
        if (word === null) {
            i = start + 2;
            continue;
        }
        var literal = value.slice(gapStart, start);
        if (!(prevEncoded && isAllWhitespace(literal))) out.push(literal);
        out.push(word.text);
        prevEncoded = true;
        i = word.end;
        gapStart = word.end;
    }
    out.push(value.slice(gapStart));
    return out.join('');
}

function isAllWhitespace(text) {
    for (var i = 0; i < text.length; i++) {
        if (!isWhitespaceCode(text.charCodeAt(i))) return false;
    }
    return true;
}

/** Read one encoded-word starting at `start`, or null if it is not well formed. */
function readEncodedWord(value, start) {
    var q1 = value.indexOf('?', start + 2);
    if (q1 === -1) return null;
    var q2 = value.indexOf('?', q1 + 1);
    if (q2 !== q1 + 2) return null;                 // the encoding is exactly one char
    var q3 = value.indexOf('?=', q2 + 1);
    if (q3 === -1) return null;

    var charset = value.slice(start + 2, q1);
    var encoding = value.slice(q1 + 1, q2).toUpperCase();
    var body = value.slice(q2 + 1, q3);
    if (charset.length === 0) return null;
    if (!isAllWhitespaceFree(body)) return null;    // an encoded-word carries no space

    var bytes;
    if (encoding === 'B') bytes = base64ToBytes(body);
    else if (encoding === 'Q') bytes = quotedPrintableToBytes(body);
    else return null;
    if (bytes === null) return null;

    return { text: decodeBytes(bytes, charset), end: q3 + 2 };
}

function isAllWhitespaceFree(text) {
    for (var i = 0; i < text.length; i++) {
        if (isWhitespaceCode(text.charCodeAt(i))) return false;
    }
    return true;
}

function base64ToBytes(body) {
    var binary;
    try {
        binary = atob(body);
    } catch (e) {
        return null;
    }
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xFF;
    return bytes;
}

/** RFC 2047 Q-encoding: `_` is a space, `=XX` is a raw byte. */
function quotedPrintableToBytes(body) {
    var bytes = [];
    var i = 0;
    while (i < body.length) {
        var code = body.charCodeAt(i);
        if (code === 95) {                       // '_'
            bytes.push(32);
            i++;
        } else if (code === 61 && i + 3 <= body.length) {   // '='
            var hex = body.slice(i + 1, i + 3);
            var byteValue = parseInt(hex, 16);
            if (isHexPair(hex) && byteValue >= 0) {
                bytes.push(byteValue);
                i += 3;
            } else {
                bytes.push(code);
                i++;
            }
        } else {
            bytes.push(code & 0xFF);
            i++;
        }
    }
    return new Uint8Array(bytes);
}

function isHexPair(text) {
    if (text.length !== 2) return false;
    for (var i = 0; i < 2; i++) {
        var c = text.charCodeAt(i);
        var isDigit = c >= 48 && c <= 57;
        var isUpper = c >= 65 && c <= 70;
        var isLower = c >= 97 && c <= 102;
        if (!isDigit && !isUpper && !isLower) return false;
    }
    return true;
}

/** An unknown charset label makes the TextDecoder constructor throw; fall back to UTF-8. */
function decodeBytes(bytes, charset) {
    var decoder;
    try {
        decoder = new TextDecoder(charset);
    } catch (e) {
        decoder = new TextDecoder('utf-8');
    }
    return decoder.decode(bytes);
}

// ---------------------------------------------------------------------------
// Address lists
// ---------------------------------------------------------------------------

/**
 * Split an address-list header value and parse each entry into `{name, email}`.
 *
 * The split is quote- and angle-bracket-aware, which is what keeps fixture 0008's
 * `"Public, Jane Q." <…>` one address rather than two. Encoded-words are decoded per
 * display name AFTER the split, so a decoded comma can never retroactively split an
 * address that the wire form did not.
 */
function parseAddressList(value) {
    var addresses = [];
    var raw = splitAddressList(value);
    for (var i = 0; i < raw.length; i++) {
        var one = parseAddress(raw[i]);
        if (one !== null) addresses.push(one);
    }
    return addresses;
}

function splitAddressList(value) {
    var items = [];
    var start = 0;
    var inQuote = false;
    var inAngle = false;
    for (var i = 0; i < value.length; i++) {
        var code = value.charCodeAt(i);
        if (code === 34) inQuote = !inQuote;                    // '"'
        else if (!inQuote && code === 60) inAngle = true;       // '<'
        else if (!inQuote && code === 62) inAngle = false;      // '>'
        else if (!inQuote && !inAngle && code === 44) {         // ','
            items.push(value.slice(start, i));
            start = i + 1;
        }
    }
    items.push(value.slice(start));
    return items;
}

function parseAddress(text) {
    var entry = text.trim();
    if (entry.length === 0) return null;

    var open = entry.lastIndexOf('<');
    var close = open === -1 ? -1 : entry.indexOf('>', open + 1);
    if (open !== -1 && close !== -1) {
        return {
            name: cleanDisplayName(entry.slice(0, open)),
            email: entry.slice(open + 1, close).trim()
        };
    }
    return { name: '', email: entry };
}

function cleanDisplayName(text) {
    var name = text.trim();
    if (name.length >= 2 && name.charCodeAt(0) === 34 && name.charCodeAt(name.length - 1) === 34) {
        name = name.slice(1, name.length - 1);
    }
    return decodeEncodedWords(name).trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * RFC 5322 `[Day, ]D Mon YYYY hh:mm:ss zone` onto ISO 8601 `YYYY-MM-DD`.
 *
 * The calendar date is taken AS WRITTEN and is not shifted into UTC. Two reasons: the
 * date a correspondent put on a message is the date in their own offset, and a
 * conversion would make this function's output depend on nothing in its input while
 * still moving the year into the cite-key at an offset boundary. No fixture
 * distinguishes the two readings.
 *
 * An absent or unparseable Date yields the empty string, never a substituted value --
 * Better BibTeX never recomputes a key, so a fabricated year is permanent.
 */
function toIsoDate(value) {
    var text = value.trim();
    if (text.length === 0) return '';

    var comma = text.indexOf(',');
    if (comma !== -1 && comma <= 3) text = text.slice(comma + 1);

    var tokens = splitOnWhitespace(text);
    if (tokens.length < 3) return '';

    var day = parseInt(tokens[0], 10);
    var month = MONTH_NAMES.indexOf(tokens[1].slice(0, 3).toLowerCase());
    var year = parseInt(tokens[2], 10);

    if (!isFinite(day) || day < 1 || day > 31) return '';
    if (month === -1) return '';
    if (!isFinite(year)) return '';
    if (year < 50) year += 2000;
    else if (year < 100) year += 1900;

    return pad(year, 4) + '-' + pad(month + 1, 2) + '-' + pad(day, 2);
}

function pad(value, width) {
    var text = String(value);
    if (text.length >= width) return text;
    var zeros = [];
    for (var i = text.length; i < width; i++) zeros.push('0');
    zeros.push(text);
    return zeros.join('');
}

function splitOnWhitespace(text) {
    var tokens = [];
    var i = 0;
    var n = text.length;
    while (i < n) {
        while (i < n && isWhitespaceCode(text.charCodeAt(i))) i++;
        var start = i;
        while (i < n && !isWhitespaceCode(text.charCodeAt(i))) i++;
        if (i > start) tokens.push(text.slice(start, i));
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// Creator-mode fallback rule
// ---------------------------------------------------------------------------

/**
 * Build one creator from a parsed address, per the architecture's creator-mode
 * fallback rule. Evaluation order is fixed and load-bearing:
 *
 *   1. no display name at all -> single-field carrying the address local part;
 *   2. a comma -> `Last, First`, split on the comma;
 *   3. an organisational keyword in any token -> single-field carrying the whole name;
 *   4. 2-3 whitespace tokens -> last token is the surname, the rest is the given name;
 *   5. anything else (>=4 tokens) -> single-field.
 *
 * Arm 3 precedes arm 4 deliberately, and fixture 0007 exists to pin it: "Marketing
 * Team" is two tokens, so the token-count arm alone would emit the surname `Team` and
 * ZotMoov's `%a` would then create a directory named `Team`.
 */
function makeCreator(creatorType, address) {
    // Sanitised here rather than only on the subject: a creator surname reaches ZotMoov's
    // %a and becomes a directory name by the same route a subject does, so both endpoints
    // of the consumption chain are covered by the one routine.
    var display = sanitizeHeaderValue((address && address.name) || '');
    var email = sanitizeHeaderValue((address && address.email) || '');

    if (display.length === 0) {
        var at = email.indexOf('@');
        return {
            creatorType: creatorType,
            name: at === -1 ? email : email.slice(0, at),
            fieldMode: 1
        };
    }

    var comma = display.indexOf(',');
    if (comma !== -1) {
        return {
            creatorType: creatorType,
            firstName: display.slice(comma + 1).trim(),
            lastName: display.slice(0, comma).trim()
        };
    }

    var tokens = splitOnWhitespace(display);
    if (hasOrganisationalKeyword(tokens)) {
        return { creatorType: creatorType, name: display, fieldMode: 1 };
    }
    if (tokens.length >= 2 && tokens.length <= 3) {
        return {
            creatorType: creatorType,
            firstName: tokens.slice(0, tokens.length - 1).join(' '),
            lastName: tokens[tokens.length - 1]
        };
    }
    return { creatorType: creatorType, name: display, fieldMode: 1 };
}

function hasOrganisationalKeyword(tokens) {
    for (var i = 0; i < tokens.length; i++) {
        if (ORG_KEYWORDS.indexOf(normalizeKeywordToken(tokens[i])) !== -1) return true;
    }
    return false;
}

/** Lowercase, strip surrounding quotes, then strip trailing punctuation. */
function normalizeKeywordToken(token) {
    var text = token.toLowerCase();
    var start = 0;
    var end = text.length;
    while (start < end && isQuoteCode(text.charCodeAt(start))) start++;
    while (end > start && isQuoteCode(text.charCodeAt(end - 1))) end--;
    while (end > start && isTrailingPunctuationCode(text.charCodeAt(end - 1))) end--;
    return text.slice(start, end);
}

function isQuoteCode(code) {
    return code === 34 || code === 39;
}

function isTrailingPunctuationCode(code) {
    return code === 46 || code === 44 || code === 59 || code === 58
        || code === 33 || code === 63 || code === 41;
}

// ---------------------------------------------------------------------------
// Mapping onto a field/creator payload
// ---------------------------------------------------------------------------

/**
 * Map a ParsedMessage onto an `email` item field/creator payload.
 *
 * `recipientCap` arrives as a PARAMETER and is never read from prefs here: this file
 * may not name the host object at all, so `extensions.emailintake.recipientCap` is
 * read by src/intake.js on the host-coupled side and passed in. The two-argument signature
 * is settled in Phase 1, at the point the name is settled, so that Phase 2 is a body
 * replacement rather than a signature change to a function test/parse.test.js imports.
 *
 * `extra` carries the Message-ID with its angle brackets exactly as the header does --
 * the stored form and the form passed to the Phase-3b duplicate lookup must agree, or
 * that check silently never fires. A message carrying no Message-ID yields an EMPTY
 * `extra` rather than the string `Message-ID: undefined`.
 *
 * `citationKey` is deliberately absent: pinning it would disable Better BibTeX's
 * postfix collision disambiguation.
 *
 * `abstractNote` stays empty by construction -- populating it requires parsing the
 * body, which the security posture forbids.
 */
function mapToPayload(parsed, recipientCap = 0) {
    var cap = Number(recipientCap);
    if (!isFinite(cap) || cap < 0) cap = 0;

    var creators = [makeCreator('author', parsed.from)];

    var recipients = parsed.to || [];
    for (var i = 0; i < recipients.length && i < cap; i++) {
        creators.push(makeCreator('recipient', recipients[i]));
    }

    var messageId = sanitizeHeaderValue(parsed.messageId);

    return {
        itemType: 'email',
        subject: sanitizeHeaderValue(parsed.subject),
        date: sanitizeHeaderValue(parsed.date),
        extra: messageId.length > 0 ? 'Message-ID: ' + messageId : '',
        language: sanitizeHeaderValue(parsed.contentLanguage),
        abstractNote: '',
        url: '',
        accessDate: '',
        DOI: '',
        rights: '',
        shortTitle: '',
        creators: creators
    };
}

// Node honours this; the loadSubScript sandbox ignores it because `module` is
// undefined there. This is what lets `node --test` load the file with no shim.
if (typeof module !== 'undefined') { module.exports = { detect, parseHeaders, mapToPayload, textFromMsg, parseMsg }; }
