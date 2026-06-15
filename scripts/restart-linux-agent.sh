#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/work/mini_drop}"
SUDO_PASSWORD="${2:-}"
AGENT_ID="${3:-linux-agent-1}"
AGENT_LABEL="${4:-linux-agent}"
BASE_URL="${5:-http://127.0.0.1:8787}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Mini-Drop root not found: $ROOT_DIR" >&2
  exit 1
fi

pkill -f "server/agent/index.ts" || true
pkill -f "npm run agent:start" || true

cd "$ROOT_DIR"
nohup env \
  MINI_DROP_LINUX_SUDO_PASSWORD="$SUDO_PASSWORD" \
  MINI_DROP_AGENT_ID="$AGENT_ID" \
  MINI_DROP_AGENT_LABEL="$AGENT_LABEL" \
  MINI_DROP_AGENT_BASE_URL="$BASE_URL" \
  npm run agent:start >/tmp/mini-drop-agent.log 2>&1 </dev/null &

sleep 6
tail -n 20 /tmp/mini-drop-agent.log
