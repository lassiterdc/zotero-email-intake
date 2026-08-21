#!/usr/bin/env bash
# check-notifier-priority — pre-commit hook
#
# Asserts the architecture's central sequencing guarantee: the item observer
# registers with an explicit id and an explicit priority of 50.
#
# This is the invariant Phase 0 exists to establish, and losing it is SILENT.
# `Zotero.Notifier.registerObserver` stores `priority: priority || false`, and
# `_getObserverOrder` coerces that to 100 before sorting. A registration that
# omits the priority therefore lands at the default 100 — a tie with ZotMoov,
# which registers at exactly 100. `Array.prototype.sort` is stable, so the tie
# is broken by plugin load order: the result is not an error but intermittently
# correct filing, which is the hardest possible failure to attribute.
#
# The check reads the registration back rather than observing behaviour,
# because behaviour cannot distinguish "won the tie" from "was ordered first".
#
# This is a whole-file invariant on bootstrap.js, so the hook reads that file
# unconditionally rather than depending on which paths were staged.
#
# Promotes Phase 0's Validation Plan item 3 into a gate.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BOOTSTRAP="$REPO_ROOT/bootstrap.js"

if [ ! -f "$BOOTSTRAP" ]; then
    echo "ERROR: bootstrap.js not found at $BOOTSTRAP" >&2
    exit 1
fi

MATCHES=$(grep -c "registerObserver(this.onItemChange" "$BOOTSTRAP" || true)

if [ "$MATCHES" -ne 1 ]; then
    echo "" >&2
    echo "ERROR: expected exactly ONE item-observer registration in bootstrap.js, found ${MATCHES}." >&2
    echo "" >&2
    echo "Two registrations means two observers fire per event; zero means the" >&2
    echo "plugin is enabled and listening to nothing. Both are silent at runtime." >&2
    echo "" >&2
    echo "To bypass (only if the violation is a known false positive):" >&2
    echo "  SKIP=check-notifier-priority git commit ..." >&2
    exit 1
fi

LINE=$(grep -n "registerObserver(this.onItemChange" "$BOOTSTRAP")

if ! echo "$LINE" | grep -q "'emailintake', 50"; then
    echo "" >&2
    echo "ERROR: the item-observer registration does not carry the explicit id and priority." >&2
    echo "" >&2
    echo "  found:    ${LINE}" >&2
    echo "  expected: the call to carry 'emailintake', 50 as its 3rd and 4th arguments" >&2
    echo "" >&2
    echo "Without the explicit priority the observer registers at the default 100," >&2
    echo "tying with ZotMoov. The tie is broken by plugin load order, so the symptom" >&2
    echo "is intermittently-correct filing rather than an error." >&2
    echo "" >&2
    echo "To bypass (only if the violation is a known false positive):" >&2
    echo "  SKIP=check-notifier-priority git commit ..." >&2
    exit 1
fi

exit 0
