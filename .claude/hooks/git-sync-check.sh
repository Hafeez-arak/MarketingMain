#!/usr/bin/env bash
# SessionStart: is the local `main` still the main everyone else is on?
#
# Why this exists. Work in this repo happens on branches, in worktrees, and
# those branch tips get pushed to origin/main. The local `main` ref only ever
# moves when someone commits directly on it, so it silently falls behind —
# on 2026-08-23 by five commits and three days. The cost is not the drift, it
# is reading a file, believing it is what production runs, and debugging the
# wrong code. That happened.
#
# So this fetches once at session start and says so. It never changes a ref:
# fast-forwarding is a decision, and a hook that quietly moved `main` under an
# open editor would be worse than the problem it solves.
#
# Silent when in sync — a warning that fires every session stops being read.
set -uo pipefail

# Every early exit is 0. A hook that failed on a machine with no origin, or in
# a directory that is not a repo, would print noise at the top of every
# unrelated session.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0
git show-ref --verify --quiet refs/heads/main || exit 0

# Only origin/main is fetched, not every branch: this repo carries a couple of
# dozen refs and the point is one comparison, made fast enough that nobody
# resents it at startup.
git fetch --quiet origin main 2>/dev/null || exit 0

behind=$(git rev-list --count main..origin/main 2>/dev/null) || exit 0
ahead=$(git rev-list --count origin/main..main 2>/dev/null) || exit 0
[ "${behind:-0}" -eq 0 ] && exit 0

if [ "${ahead:-0}" -gt 0 ]; then
  # Diverged, not merely behind — ff-only would refuse, so do not suggest it.
  msg="local main has diverged from origin/main: $ahead ahead, $behind behind. Reconcile before building on it."
else
  msg="local main is $behind commit(s) behind origin/main. Run: git merge --ff-only origin/main"
fi

# Two audiences, deliberately. systemMessage is for the person; additionalContext
# is for Claude, which is the one that reads a stale file and reasons from it.
printf '{"systemMessage":"⚠ %s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Git sync: %s Until then, files in this checkout may not match what is deployed — verify against origin/main before treating code as current."}}\n' \
  "$msg" "$msg"
