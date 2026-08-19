#!/bin/sh
# Executable form of the architecture's Enforced-invariants table.
#
# Run from the repository root. Exits 0 with no output on a clean tree, 1 on any
# violation, emitting one line per violation:  {rule-id}\t{path}:{line}\t{matched text}
#
# SCAN UNIVERSES. Two, stated positively as the artifact each rule makes a claim about
# rather than as a blocklist of excluded directories. A blocklist needs an edit every
# time a directory is added and silently stops holding when that edit is missed; a
# positive universe picks up a new source file automatically and ignores a new document
# automatically.
#
#   SHIPPED           what the XPI contains: manifest.json, bootstrap.js, src/**,
#                     prefs.js, prefs.xhtml, locale/**
#   REPO_MINUS_DOCS   every tracked file except the documentation surface (docs/**,
#                     sidecars/**) and except test/fixtures/**
#
# R04 is deliberately NOT on SHIPPED, and that asymmetry must not be tidied away. The
# other tree-scoped rules describe things that can only go wrong inside the shipped
# plugin. A dependence on the BBT debug bridge is not a code pattern inside a plugin at
# all -- the bridge is a SEPARATELY INSTALLED plugin whose documented use is to POST
# arbitrary JavaScript into a running Zotero from an editor or harness. Depending on it
# is therefore a test/, scripts/, CI or README fact. Scoping R04 to SHIPPED would leave
# it scanning six paths on which the dependency could never appear: a rule that matches
# nothing and reads as protective, which is the first item in this phase's own Risks.
#
# test/fixtures/** is carved out of REPO_MINUS_DOCS for two reasons. Fixtures are message
# content, not code, and no such dependence can live in an .eml. And this script prints
# {matched text} for every finding, while test/fixtures/local/ is gitignored REAL
# correspondence -- so a fixture-scanning rule would echo lines of the owner's email into
# CI output on a false positive.
#
# PATTERN-AUTHORING CONSTRAINT. A rule's own pattern must never contain the literal it
# bans, or this file reports itself. Hence chrome:\/\/, inner[H]TML and siblings below.
# This is the convention src/message.js:3-6 already states for source ("plain greps with
# no comment exemption"), applied to the scanner. It is strictly required only for R04,
# whose universe includes scripts/**; it is applied throughout anyway, because a later
# widening of any universe would otherwise break the clean-tree assertion silently.
#
# The constraint reaches further than the patterns: R04's RULE ID contains the banned
# literal too, so the id is assembled from two adjacent quoted strings below and the
# prose in this header avoids writing it. Measured -- without both, a clean tree reports
# two findings against this file.

set -u

# Findings accumulate in a file rather than a variable. `grep ... | report` runs `report`
# in a SUBSHELL, so a status flag set inside it is discarded when the pipeline ends: an
# earlier draft of this script printed violations and still exited 0, which is the exact
# silent-pass failure the suite exists to prevent, located in the suite itself.
findings=$(mktemp)
trap 'rm -f "$findings"' EXIT

# R04's id, assembled so this file never contains the literal it bans.
R04_ID='R04-no-debug''-bridge'

# Files that ship inside the XPI, restricted to those that exist.
shipped_files() {
    for p in manifest.json bootstrap.js prefs.js prefs.xhtml; do
        [ -f "$p" ] && printf '%s\n' "$p"
    done
    [ -d src ] && find src -type f -name '*.js'
    [ -d locale ] && find locale -type f
    return 0
}

# Every file git would ship or track, except the documentation surface and the fixture
# corpus. --others --exclude-standard includes files that are new and not yet committed,
# so a violation introduced in the working tree is caught before it lands rather than
# only after; --exclude-standard keeps gitignored paths out, which is what holds
# test/fixtures/local/ -- real correspondence -- outside the scan on top of the explicit
# fixture filter below.
repo_minus_docs_files() {
    git ls-files --cached --others --exclude-standard 2>/dev/null \
        | grep -v '^docs/' \
        | grep -v '^sidecars/' \
        | grep -v '^test/fixtures/'
    return 0
}

# report {rule-id} < grep-output-with-filename-and-line
# Appends to $findings; never sets a variable the caller reads, because it runs in a
# pipeline subshell.
report() {
    rule="$1"
    while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        path=$(printf '%s' "$hit" | cut -d: -f1)
        line=$(printf '%s' "$hit" | cut -d: -f2)
        text=$(printf '%s' "$hit" | cut -d: -f3-)
        printf '%s\t%s:%s\t%s\n' "$rule" "$path" "$line" "$text" >> "$findings"
    done
}

# Direct emit for the rules that decide without grep.
emit() {
    printf '%s\t%s:%s\t%s\n' "$1" "$2" "$3" "$4" >> "$findings"
}

scan() {
    rule="$1"
    pattern="$2"
    shift 2
    [ "$#" -eq 0 ] && return 0
    grep -nHE "$pattern" "$@" 2>/dev/null | report "$rule"
}

# --- R01: no network egress. Universe: src/ and bootstrap.js. ---
r01_files=$( { [ -d src ] && find src -type f -name '*.js'; [ -f bootstrap.js ] && printf '%s\n' bootstrap.js; } )
# shellcheck disable=SC2086
[ -n "$r01_files" ] && scan R01-no-network 'fetch\(|XMLHttp[R]equest|Zotero\.HTTP|new[C]hannel|Web[S]ocket|[i]mport\(' $r01_files
if [ -f manifest.json ] && grep -qE '"(permissions|host_permissions)"' manifest.json; then
    emit R01-no-network manifest.json \
        "$(grep -nE '"(permissions|host_permissions)"' manifest.json | cut -d: -f1)" \
        'manifest declares host permissions'
fi

# --- R02: no DOM built from message content. Universe: SHIPPED minus prefs.xhtml. ---
r02_files=$(shipped_files | grep -v '^prefs\.xhtml$')
# shellcheck disable=SC2086
[ -n "$r02_files" ] && scan R02-no-dom '[D]OMParser|inner[H]TML|outer[H]TML|create[E]lement' $r02_files

# --- R03: the pure core stays host-free. Universe: enumerated, never globbed, so adding
#          a pure file forces a deliberate edit here rather than silently escaping. ---
r03_files=$( for p in src/message.js src/cfb.js; do [ -f "$p" ] && printf '%s\n' "$p"; done )
# shellcheck disable=SC2086
[ -n "$r03_files" ] && scan R03-pure-core '[Z]otero\.' $r03_files

# --- R04: no dependence on the BBT debug bridge. Universe: REPO_MINUS_DOCS. ---
r04_files=$(repo_minus_docs_files)
# shellcheck disable=SC2086
[ -n "$r04_files" ] && scan "$R04_ID" 'debug[-]bridge' $r04_files

# --- R05: one logging routine. Universe: SHIPPED minus the file defining logSafe. ---
r05_files=$(shipped_files | grep -v '^src/intake\.js$')
# shellcheck disable=SC2086
[ -n "$r05_files" ] && scan R05-single-log-routine '[Z]otero\.logError\(' $r05_files

# --- R06: no synchronous file reads. Two patterns, both required. The trailing \( is what
#          keeps the first from matching the supported ...Async siblings. ---
r06_files=$( { [ -d src ] && find src -type f -name '*.js'; [ -f bootstrap.js ] && printf '%s\n' bootstrap.js; } )
# shellcheck disable=SC2086
[ -n "$r06_files" ] && scan R06-no-sync-read '\.(getBinaryContents|getContents)\(' $r06_files
# shellcheck disable=SC2086
[ -n "$r06_files" ] && scan R06-no-sync-read 'getBinaryContentsAsync' $r06_files

# --- R07: the ReDoS tests exist and are not skipped. ---
if [ ! -f test/redos.test.js ]; then
    emit R07-redos-tests-present test/redos.test.js 0 'file is absent'
else
    scan R07-redos-tests-present 'test\.skip|\{ *skip: *true *\}' test/redos.test.js
fi

# --- R08: every read is bounded. Both shapes are covered so the rule does not go inert
#          if the read API changes. ---
for f in $( [ -d src ] && find src -type f -name '*.js' ); do
    grep -nHE 'IOUtils\.read\(' "$f" 2>/dev/null | grep -v 'maxBytes' | report R08-bounded-read
    grep -nHE 'getContentsAsync\(' "$f" 2>/dev/null | grep -vE 'getContentsAsync\([^)]*,[^)]*,' | report R08-bounded-read
done

# --- R09: the update channel is signed. ---
if [ -f update.json ] && grep -q 'update_link' update.json; then
    if ! grep -q 'sha256:' update.json; then
        emit R09-update-hash update.json 0 'update entry carries no sha256 update_hash'
    fi
fi

# --- R10: strict mode everywhere. src/*.js and bootstrap.js only: src/probe.sys.mjs is an
#          ES module, ESM is strict by default, and a directive there is redundant rather
#          than required -- so its absence from this rule is correct by statement. ---
for f in $( { [ -d src ] && find src -maxdepth 1 -type f -name '*.js'; [ -f bootstrap.js ] && printf '%s\n' bootstrap.js; } ); do
    if [ "$(head -1 "$f")" != '"use strict";' ]; then
        emit R10-strict-mode "$f" 1 "$(head -1 "$f")"
    fi
done

# --- R11: no chrome registration. Universe: SHIPPED. ---
r11_files=$(shipped_files)
# shellcheck disable=SC2086
[ -n "$r11_files" ] && scan R11-no-chrome-registration 'register[C]hrome|aom[S]tartup|chrome:\/\/' $r11_files

# --- R12: every src/*.js is reachable from the loader. Universe: src/*.js, which excludes
#          src/probe.sys.mjs correctly and by construction -- that file is an ES module
#          reached through ChromeUtils.importESModule, not loadSubScript, so the loader
#          lists must NOT name it. R10 already iterates this universe; the idiom is reused.
#
#          This rule exists because a file that is created, tested and shipped but never
#          named in bootstrap.js fails INVISIBLY: node --test loads it through require and
#          passes, while the sandbox never evaluates it and every dependent degrades to a
#          clean null. src/message.js hit this in Phase 1 and src/cfb.js shipped this way
#          until Phase 3b, where every .msg failed as E_HEADER_MALFORMED with all 17 tests
#          green. Note R03 above has always enumerated src/cfb.js -- the suite and the
#          loader disagreed, and nothing compared them. This rule is that comparison.
#
#          Line comments are stripped before matching so a commented-out mention cannot
#          satisfy the rule. A reformat that breaks the quoted-path form fails CLOSED (a
#          finding), which is the safe direction for a rule that exists to catch omissions.
if [ -f bootstrap.js ]; then
    loader_text=$(sed 's://.*::' bootstrap.js)
    for f in $( { [ -d src ] && find src -maxdepth 1 -type f -name '*.js'; } | sort ); do
        case "$loader_text" in
            *"\"$f\""*) ;;
            *) emit R12-loader-reachable "$f" 1 'not named in a bootstrap.js loader list' ;;
        esac
    done
fi

# One decision point. A finding anywhere means exit 1, and the findings are printed from
# the accumulator rather than as they are discovered, so no pipeline subshell can swallow
# the verdict.
if [ -s "$findings" ]; then
    cat "$findings"
    exit 1
fi
exit 0
