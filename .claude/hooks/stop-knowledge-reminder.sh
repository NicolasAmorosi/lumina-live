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
  printf '%s\n' '{"systemMessage":"Ciclo de automejora: hay cambios en src/ y nada nuevo en .claude/knowledge/. Si algo costo descubrir en esta sesion, registralo con /learn."}'
fi
