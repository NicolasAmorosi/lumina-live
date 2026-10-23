#!/bin/sh
# Stop hook — closes the self-improvement cycle.
# Fires a user-visible reminder only when the working tree shows code changes under src/
# while nothing new was written to .claude/knowledge/. It emits `systemMessage` only, never
# `decision: block`, so it can never re-invoke the model — no loop is possible.
set -eu

DIR="${CLAUDE_PROJECT_DIR:-.}"

CODE_CHANGED=$(git -C "$DIR" status --porcelain -- src 2>/dev/null || true)
KNOWLEDGE_TOUCHED=$(git -C "$DIR" status --porcelain -- .claude/knowledge 2>/dev/null || true)

if [ -n "$CODE_CHANGED" ] && [ -z "$KNOWLEDGE_TOUCHED" ]; then
  printf '%s\n' '{"systemMessage":"Self-improvement cycle: there are changes in src/ and nothing new in .claude/knowledge/. If something was costly to discover in this session, record it with /learn."}'
fi
