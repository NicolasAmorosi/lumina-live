#!/bin/sh
# SessionStart hook — injects WorshipApp's working protocol into the model's context.
# Loop-free: SessionStart runs once per session and only ADDS context.
set -eu

DIR="${CLAUDE_PROJECT_DIR:-.}"
INDEX="$DIR/.claude/knowledge/INDEX.md"

INDEX_BODY=""
if [ -f "$INDEX" ]; then
  INDEX_BODY=$(grep '^- \[' "$INDEX" || true)
fi

CONTEXT=$(printf '%s\n' \
  "WorshipApp — protocolo obligatorio de esta sesion (ver CLAUDE.md para el detalle):" \
  "" \
  "1. CERTEZA ANTES DE CODIGO: antes de escribir codigo no trivial, enumera supuestos y usa" \
  "   AskUserQuestion hasta llegar a ~99% de certeza sobre lo que el usuario quiere. Nunca" \
  "   asumas alcance, UX ni comportamiento. Excepciones: typos, renombres obvios y pedidos" \
  "   de solo lectura (explicar, buscar, auditar)." \
  "2. CICLO DE AUTOMEJORA: al cerrar una tarea no trivial, decide si surgio un hallazgo" \
  "   durable (algo no derivable del codigo, que costo descubrir y volvera a importar). Si si," \
  "   registralo con la skill /learn en .claude/knowledge/ + una linea en INDEX.md." \
  "3. BARRA MINIMA antes de dar una tarea por buena: npm run typecheck && npm run lint" \
  "   && npm run test." \
  "" \
  "Indice de hallazgos ya registrados en .claude/knowledge/ (leelo antes de tocar esas areas):" \
  "$INDEX_BODY")

jq -n --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
