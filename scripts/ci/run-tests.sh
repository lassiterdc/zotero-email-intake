#!/bin/sh
# Runs the test suite, then asserts the run was not VACUOUS.
#
# The hole this closes was measured, not argued:
#
#   $ node --test --test-reporter=tap "nosuchdir/**/*.test.js"
#   TAP version 13
#   1..0
#   # tests 0
#   EXIT=0
#
# A renamed test/ therefore yields a green CI over zero executed tests. test/pairing.test.js
# guards an empty fixture corpus but is itself one of the tests that vanishes when
# discovery fails, so it cannot guard its own non-discovery. Nothing inside the runner can.
#
# The floor is derived from the filesystem rather than hardcoded. A hardcoded floor needs a
# manual bump whenever a test or fixture is added, and a floor that has gone stale-low is
# silently weaker than it reads -- the same defect class as an inert grep rule, with no gate
# that notices. A filesystem-derived floor cannot go stale, and adding fixtures raises the
# reported count without ever tripping it. Stated weakness: if one of several test files
# silently stopped being discovered while the others compensated, this would not catch it.
# Total non-discovery is what was measured and what is closed.

set -eu

# The fixture generator runs FIRST. package.json carries it as "pretest", which npm fires
# for `npm test` but NOT for `npm run ci` -- and test/parse.test.js's msg/eml twin case
# depends on the generated .msg. Running it here rather than as a workflow step keeps
# `npm run ci` correct when run locally too.
node scripts/make-msg-fixture.js

# Clause 1: at least one test file on disk.
file_count=$(find test -type f -name '*.test.js' 2>/dev/null | wc -l | tr -d ' ')
if [ "$file_count" -eq 0 ]; then
    echo "run-tests: no *.test.js files found under test/ -- the suite would pass vacuously" >&2
    exit 1
fi

# Clause 2: run with the reporter PINNED. Node selects `spec` on a TTY and `tap` otherwise,
# so the summary line differs between a developer's shell and CI; measured, the same suite
# emits "i tests 16" interactively and "# tests 16" here. An unpinned grep breaks the first
# time TTY detection differs.
out=$(mktemp)
# The glob is quoted so the shell cannot expand it before node sees it: node does its own
# glob expansion, and a bare directory positional resolves as a module specifier and exits
# MODULE_NOT_FOUND before the runner starts.
# The runner must NOT be the left-hand side of a pipe. This script is #!/bin/sh, where
# $? after a pipeline is the status of the LAST element -- so the earlier `| tee "$out"`
# form captured tee's status, which is unconditionally 0, and the exit at the foot of
# this file returned 0 however the runner fared. A failing test produced a green CI:
# measured at exit 0 with a deliberately failing test seeded, on both this script and
# `npm run ci`. bash's PIPESTATUS would solve it and is unavailable here by design.
#
# Redirect-then-cat is the remedy rather than a status sidecar because it removes the
# pipeline instead of working around it: there is no subshell whose status has to be
# smuggled back, and no second temp file to keep in sync. The cost is that output
# appears after the run rather than during it, which is invisible for a suite that
# completes in about 130 ms. stderr is deliberately NOT redirected, so a crash or a
# node-level error still streams live while stdout is captured for the count assertion.
set +e
node --test --test-reporter=tap "test/**/*.test.js" > "$out"
runner_status=$?
set -e
cat "$out"

# Clause 3: the summary line must EXIST and must clear the floor.
summary=$(grep -E '^# tests [0-9]+$' "$out" | tail -1 || true)
rm -f "$out"

if [ -z "$summary" ]; then
    echo "run-tests: no '# tests N' summary line in the runner output -- reporter drift." >&2
    echo "run-tests: failing rather than defaulting the count to zero." >&2
    exit 1
fi

reported=$(printf '%s' "$summary" | awk '{print $3}')
if [ "$reported" -lt "$file_count" ]; then
    echo "run-tests: the run reported $reported test(s) against $file_count test file(s) on disk." >&2
    echo "run-tests: at least one test per file is expected; this run did not execute what is there." >&2
    exit 1
fi

# The runner's own status, captured above from a plain redirect rather than from a
# pipeline, so a failing assertion inside a test still fails the build even when the
# count assertion is satisfied. The count assertion cannot cover this case: a failing
# test still reports a count that clears the floor.
exit "$runner_status"
