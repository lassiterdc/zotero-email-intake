#!/usr/bin/env bash
# check-json-valid — pre-commit hook
#
# Parses every staged .json file. A malformed manifest.json does not produce
# an error the developer ever sees: Zotero's embedded add-on manager skips an
# unparseable manifest and the plugin simply never appears in Tools -> Plugins.
# Phase 4 adds update.json on the release channel, which fails the same silent way.

set -uo pipefail

FAILED=0

for file in "$@"; do
    [ -f "$file" ] || continue
    if ! output=$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file" 2>&1); then
        echo "ERROR: $file is not valid JSON" >&2
        echo "$output" >&2
        echo "" >&2
        FAILED=1
    fi
done

if [ "$FAILED" -eq 1 ]; then
    echo "Path to fix: correct the JSON syntax error reported above." >&2
    echo "" >&2
    echo "This matters more than a normal lint failure: an unparseable manifest.json" >&2
    echo "makes the plugin silently absent from Tools -> Plugins, with no error anywhere." >&2
    echo "" >&2
    echo "To bypass (only if the violation is a known false positive):" >&2
    echo "  SKIP=check-json-valid git commit ..." >&2
    exit 1
fi

exit 0
