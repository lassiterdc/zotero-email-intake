#!/usr/bin/env bash
# check-use-strict — pre-commit hook
#
# Asserts that every staged .js file opens with the strict-mode directive.
#
# Strict mode is what converts an accidental implicit global into a throw.
# The architecture cites two concrete leaks of that class in the donor plugin
# this loader was adopted from — a chained `let a = b = c = false` that declares
# only the first name, and an undeclared for-of loop variable. Neither errors
# without this directive.
#
# Promotes Phase 0's Validation Plan item 5 into a gate.

set -uo pipefail

FAILED=0

for file in "$@"; do
    [ -f "$file" ] || continue
    first_line=$(head -1 "$file")
    if [ "$first_line" != '"use strict";' ]; then
        echo "ERROR: $file does not open with the strict-mode directive." >&2
        echo "  expected line 1: \"use strict\";" >&2
        echo "  found line 1:    ${first_line}" >&2
        echo "" >&2
        FAILED=1
    fi
done

if [ "$FAILED" -eq 1 ]; then
    echo 'Path to fix: insert "use strict"; as line 1 of each file listed above.' >&2
    echo "" >&2
    echo "To bypass (only if the violation is a known false positive):" >&2
    echo "  SKIP=check-use-strict git commit ..." >&2
    exit 1
fi

exit 0
