#!/usr/bin/env bash
# Run the plan audit loop against a plan file.
#
# Usage:
#   .claude/loops/audit.sh <plan>
#
# <plan> can be a path (.claude/plans/virtualized-page-scroll.md)
# or just a plan name (virtualized-page-scroll), which is looked up
# in .claude/plans/. Any extra arguments are passed through to audit.py.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <plan-file-or-name> [extra args for audit.py]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

plan="$1"
shift

# Resolve the plan: an existing path first, then a name in .claude/plans/
if [[ -f "$plan" ]]; then
  plan="$(cd "$(dirname "$plan")" && pwd)/$(basename "$plan")"
elif [[ -f "$REPO_ROOT/.claude/plans/$plan" ]]; then
  plan="$REPO_ROOT/.claude/plans/$plan"
elif [[ -f "$REPO_ROOT/.claude/plans/$plan.md" ]]; then
  plan="$REPO_ROOT/.claude/plans/$plan.md"
else
  echo "Plan not found: $plan" >&2
  echo "Available plans:" >&2
  ls "$REPO_ROOT/.claude/plans/" 2>/dev/null | sed 's/^/  /' >&2 || true
  exit 1
fi

# Set up the virtualenv on first run
VENV="$REPO_ROOT/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating virtualenv at .venv ..." >&2
  python3 -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c "import claude_agent_sdk" 2>/dev/null; then
  echo "Installing claude-agent-sdk ..." >&2
  "$VENV/bin/pip" install --quiet claude-agent-sdk
fi

cd "$REPO_ROOT"
exec "$VENV/bin/python" "$SCRIPT_DIR/audit.py" "$plan" "$@"