"use strict";

// Default preference values for the shipped plugin.
//
// The directive is FIRST because the repo requires it of every .js file, and it earns
// its place here rather than merely satisfying the rule. Nothing in this file is
// governed by strict mode today -- it is bare call expressions, and strict mode changes
// assignment, `this`, `with` and octal behaviour, none of which appear. What it buys is
// the failure mode this file is structurally prone to: in sloppy mode a mistyped line
// (`prefX = true` where `pref("...", true)` was meant) silently creates a property,
// registers nothing, and lets the remaining prefs load, shipping a half-configured
// plugin with no signal anywhere. Under strict mode that throws a ReferenceError, which
// Zotero's setDefaultPrefs catch routes to Zotero.logError -- visible instead of silent.
// The trade is that a throw aborts the remaining prefs, so a typo becomes a loud total
// failure rather than a quiet partial one; for a defaults file that is the better trade,
// and the fresh-profile DoD check catches a total failure on the next test run.
//
// Verified before adding: strict mode does not perturb evaluation against the subscript
// target. `pref(...)` is a READ, and identifier resolution is identical in both modes;
// the callee decides `this` for a bare call, and setDefaultPrefs's pref() closes over
// its branch and never reads `this`. Executed both ways against a target scope object,
// the registered name/type/value triples are byte-identical.
//
// Zotero loads this file itself: Zotero.Plugins.setDefaultPrefs evaluates it with
// Services.scriptloader.loadSubScriptWithOptions against a target object exposing
// exactly one method, pref(name, value), which dispatches on typeof value to
// setBoolPref / setStringPref / setIntPref on Services.prefs.getDefaultBranch("").
// It runs before startup() on the same addon, and again on install, enable and
// upgrade, so these defaults are in the branch before the notifier is registered.
//
// SHAPE IS LOAD-BEARING: bare pref() calls and nothing else. A module.exports, an
// object literal or JSON sets nothing at all, and the surrounding catch reports the
// failure only through the debug log -- so a wrongly-shaped file is invisible.
//
// These land on the DEFAULT branch, which is the correct one. Setting them
// programmatically with Zotero.Prefs.set would write the USER branch instead, where
// a value is indistinguishable from a deliberate user choice, survives an upgrade
// that changes the shipped default, and cannot be reset by "restore default".

pref("extensions.emailintake.enabled", true);
pref("extensions.emailintake.onParseFailure", "leave");
pref("extensions.emailintake.duplicateHandling", "split");
pref("extensions.emailintake.recipientCap", 0);
pref("extensions.emailintake.debugLogging", false);

// The ZotMoov extension-allowlist prompt's per-extension suppression. Empty by default:
// nothing is suppressed until the user ticks "never ask again" on a specific extension.
//
// COMMA-SEPARATED, DELIBERATELY NOT JSON. The entire hazard this feature manages is
// another plugin's unguarded JSON.parse of a preference string; reproducing that shape in
// our own preferences -- to hold at most two tokens -- would be adopting the failure mode
// we are working around. Read with split(','), written with join(',').
//
// This default lands on the DEFAULT branch, as every value in this file does. The runtime
// write goes to the USER branch through Zotero.Prefs.set, which is correct here for the
// reason this file's header gives: the user branch is where a value is indistinguishable
// from a deliberate user choice, and clicking "never ask again" is exactly that.
pref("extensions.emailintake.zotmoovPromptSuppressed", "");
