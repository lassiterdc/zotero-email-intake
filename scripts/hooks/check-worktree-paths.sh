#!/usr/bin/env bash
# check-worktree-paths — pre-commit and pre-merge-commit hook
#
# Blocks commits that introduce a .claude/worktrees/{name}/ path into a staged
# .json file. Adapted from the agentic-workspace hook of the same name; the
# detection is unchanged and the remediation text is repointed at this repo.
#
# Why .json specifically, and why this repo. Development happens inside a
# throwaway git worktree, and the dev install works by writing this checkout's
# ABSOLUTE path into a pointer file in the Zotero profile. That makes a
# worktree path the most natural thing in the world to paste, and manifest.json
# already carries an update_url that Phase 4's update.json will mirror. A
# worktree path baked into either one is stale the moment the worktree is
# removed, and it ships to users that way. Scripts and docs legitimately
# mention worktree paths in comments and examples, so only .json is scanned.

set -euo pipefail

# Pattern: any path containing /.claude/worktrees/{something}/ OR /.worktrees/{something}/
PATTERN='(\.claude/worktrees|\.worktrees)/[^/]+/'

DIFF=$(git diff --cached --unified=0 -- '*.json' 2>/dev/null || true)

if [ -z "$DIFF" ]; then
    exit 0
fi

# Find added lines (+lines, not the +++ header) matching the pattern
MATCHES=$(echo "$DIFF" | grep -nE '^\+[^+].*'"$PATTERN" || true)

if [ -z "$MATCHES" ]; then
    exit 0
fi

echo "" >&2
echo "ERROR: Staged changes contain worktree-relative paths." >&2
echo "" >&2
echo "The following added lines reference a .claude/worktrees/{name}/ path," >&2
echo "which becomes stale as soon as the worktree is removed:" >&2
echo "" >&2
while IFS= read -r line; do
    echo "  $line" >&2
done <<< "$MATCHES"
echo "" >&2
echo "These must reference the repository root instead — for the dev-install" >&2
echo "pointer file, write the path of the main checkout, not of a worktree." >&2
echo "" >&2
echo "To find which files are affected:" >&2
echo "  git diff --cached | grep -n '\\.claude/worktrees'" >&2
echo "" >&2
echo "If this is intentional (e.g. documenting worktree path structure)," >&2
echo "bypass with: SKIP=check-worktree-paths git commit ..." >&2
echo "" >&2
exit 1
