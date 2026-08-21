#!/usr/bin/env bash
# check-js-syntax — pre-commit hook
#
# Runs `node --check` on every staged .js file. This is a SYNTAX gate only:
# the plugin's sources reference `Zotero` and `Services`, which exist only
# inside the Zotero sandbox, so the files cannot be executed here.
#
# Promotes Phase 0's Validation Plan item 6 from a one-time manual check
# into a gate that fires on every commit.

set -uo pipefail

FAILED=0

for file in "$@"; do
    [ -f "$file" ] || continue
    if ! output=$(node --check "$file" 2>&1); then
        echo "ERROR: $file fails node --check" >&2
        echo "$output" >&2
        echo "" >&2
        FAILED=1
    fi
done

if [ "$FAILED" -eq 1 ]; then
    echo "Path to fix: correct the syntax error reported above." >&2
    echo "" >&2
    echo "To bypass (only if the violation is a known false positive):" >&2
    echo "  SKIP=check-js-syntax git commit ..." >&2
    exit 1
fi

exit 0
