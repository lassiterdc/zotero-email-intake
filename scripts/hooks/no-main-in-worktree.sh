#!/usr/bin/env bash
# no-main-in-worktree — pre-commit hook
#
# Blocks commits to 'main' when running inside a git worktree.
# Allows commits to 'main' from the primary working tree (preserves
# the developer's direct-to-main workflow).
#
# Detection: in a worktree, `git rev-parse --git-dir` returns
# .git/worktrees/<name>/, while `--git-common-dir` returns .git/.
# In the primary working tree, both return .git/.

set -euo pipefail

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || true)
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || true)

# Not in a worktree — allow all commits
if [ "$GIT_DIR" = "$GIT_COMMON_DIR" ]; then
    exit 0
fi

# In a worktree — check the current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ "$CURRENT_BRANCH" = "main" ]; then
    echo "" >&2
    echo "ERROR: Direct commits to 'main' are not allowed from a worktree session." >&2
    echo "" >&2
    echo "Path to fix: switch to an agent branch before committing." >&2
    echo "  git checkout -b agent/{task-slug}" >&2
    echo "" >&2
    echo "Worktree: $GIT_DIR" >&2
    echo "Current branch: main" >&2
    echo "" >&2
    echo "To bypass (only if violation is a known false positive):" >&2
    echo "  SKIP=no-main-in-worktree git commit ..." >&2
    exit 1
fi

exit 0
