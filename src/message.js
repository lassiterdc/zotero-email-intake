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

/**
 * Phase 1 stub. Ignores `text` and returns a fixed ParsedMessage so the skeleton can
 * be exercised before any real parser exists. The signature is the one Phase 2 keeps,
 * so Phase 2 replaces this body and nothing else.
 *
 * The address uses the RFC 2606 reserved domain `example.com`.
 */
function parseHeaders(text) {
    return {
        subject: 'Skeleton probe message',
        from: { name: 'Jane Q. Public', email: 'jane@example.com' },
        to: [],
        date: '2026-08-13',
        messageId: '<skeleton-probe@example.com>'
    };
}

/**
 * Split a display name into { firstName, lastName } per the architecture's two-field
 * rule: the last whitespace-separated token is the surname and the remainder is the
 * given name. Phase 2 replaces this with the full creator-mode fallback rule
 * (organisational keywords, `Last, First`, single-field mode).
 */
function splitDisplayName(displayName) {
    var trimmed = (displayName || '').trim();
    var cut = trimmed.lastIndexOf(' ');
    if (cut === -1) return { firstName: '', lastName: trimmed };
    return { firstName: trimmed.slice(0, cut), lastName: trimmed.slice(cut + 1) };
}

/**
 * Map a ParsedMessage onto an `email` item field/creator payload.
 *
 * `recipientCap` arrives as a PARAMETER and is never read from prefs here: this file
 * may not name the host object at all, so `extensions.emailintake.recipientCap` is
 * read by src/intake.js on the host-coupled side and passed in. The two-argument signature
 * is settled in Phase 1, at the point the name is settled, so that Phase 2 is a body
 * replacement rather than a signature change to a function test/parse.test.js imports.
 *
 * In Phase 1 the cap is inert: the stub returns `to: []`, so no recipient creator is
 * emitted at any cap value.
 *
 * `extra` carries the Message-ID with its angle brackets exactly as the header does --
 * the stored form and the form passed to the Phase-3b duplicate lookup must agree, or
 * that check silently never fires.
 *
 * `citationKey` is deliberately absent: pinning it would disable Better BibTeX's
 * postfix collision disambiguation.
 */
function mapToPayload(parsed, recipientCap = 0) {
    var cap = Number(recipientCap);
    if (!isFinite(cap) || cap < 0) cap = 0;

    var author = splitDisplayName(parsed.from && parsed.from.name);
    var creators = [{
        creatorType: 'author',
        firstName: author.firstName,
        lastName: author.lastName
    }];

    var recipients = parsed.to || [];
    for (var i = 0; i < recipients.length && i < cap; i++) {
        var recipient = splitDisplayName(recipients[i] && recipients[i].name);
        creators.push({
            creatorType: 'recipient',
            firstName: recipient.firstName,
            lastName: recipient.lastName
        });
    }

    return {
        itemType: 'email',
        subject: parsed.subject,
        date: parsed.date,
        extra: 'Message-ID: ' + parsed.messageId,
        creators: creators
    };
}

// Node honours this; the loadSubScript sandbox ignores it because `module` is
// undefined there. This is what lets `node --test` load the file with no shim.
if (typeof module !== 'undefined') { module.exports = { parseHeaders, mapToPayload }; }
