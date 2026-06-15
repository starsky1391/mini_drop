#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/work/mini_drop}"
SUDO_PASSWORD="${2:-}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Mini-Drop root not found: $ROOT_DIR" >&2
  exit 1
fi

pkill -f "dist/server/server/index.js" || true
pkill -f "node -e process.env.NODE_ENV='production'; import('./dist/server/server/index.js')" || true
pkill -f "npm run start" || true

cd "$ROOT_DIR"
nohup env MINI_DROP_LINUX_SUDO_PASSWORD="$SUDO_PASSWORD" npm run start >/tmp/mini-drop-server.log 2>&1 </dev/null &

for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:8787/api/health
printf '\n'
tail -n 20 /tmp/mini-drop-server.log
