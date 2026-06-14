#!/usr/bin/env sh
set -eu

COMPOSE="${COMPOSE:-docker compose}"

echo "[mini-drop] building and starting docker demo stack"
$COMPOSE up --build -d mini-drop-server mini-drop-agent

echo "[mini-drop] waiting for server health"
ATTEMPT=0
until docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"'; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 30 ]; then
    echo "[mini-drop] server did not become healthy in time"
    $COMPOSE logs --tail=80 mini-drop-server mini-drop-agent || true
    exit 1
  fi
  sleep 2
done

echo "[mini-drop] stack is ready"
echo "[mini-drop] UI: http://127.0.0.1:8787/"
echo "[mini-drop] external reasoner config can be mounted via MINI_DROP_REASONER_CONFIG_PATH (default: config/local-ai-models.json)"
echo "[mini-drop] inspect logs with: $COMPOSE logs -f mini-drop-server mini-drop-agent"
