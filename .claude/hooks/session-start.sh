#!/bin/bash
# Instala os plugins do Claude Code do projeto em sessões cloud.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

for p in supabase frontend-design code-review; do
  claude plugin install "$p@anthropic-plugin-directory" --scope project >/dev/null 2>&1 \
    || echo "aviso: falha ao instalar plugin $p" >&2
done
exit 0
