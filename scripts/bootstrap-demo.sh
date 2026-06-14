#!/usr/bin/env sh
set -eu

PORT="${PORT:-8787}"
TMP_DIR="${MINI_DROP_TMP_DIR:-.tmp}"
SERVER_LOG="${MINI_DROP_SERVER_LOG:-$TMP_DIR/bootstrap-server.log}"
AGENT_LOG="${MINI_DROP_AGENT_LOG:-$TMP_DIR/bootstrap-agent.log}"
AGENT_ID="${MINI_DROP_AGENT_ID:-bootstrap-agent}"
AGENT_LABEL="${MINI_DROP_AGENT_LABEL:-bootstrap-agent}"
BASE_URL="${MINI_DROP_AGENT_BASE_URL:-http://127.0.0.1:$PORT}"
REASONER_MODE="${MINI_DROP_REASONER_MODE:-stub}"
REASONER_CONFIG_PATH="${MINI_DROP_REASONER_CONFIG_PATH:-config/local-ai-models.json}"

mkdir -p "$TMP_DIR"

echo "[mini-drop] installing dependencies if needed"
npm install

echo "[mini-drop] building production assets"
npm run build

echo "[mini-drop] starting server on $BASE_URL"
PORT="$PORT" NODE_ENV=production MINI_DROP_REASONER_MODE="$REASONER_MODE" MINI_DROP_REASONER_CONFIG_PATH="$REASONER_CONFIG_PATH" \
  nohup npm run start >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

echo "[mini-drop] starting local agent $AGENT_LABEL"
MINI_DROP_AGENT_ID="$AGENT_ID" \
MINI_DROP_AGENT_LABEL="$AGENT_LABEL" \
MINI_DROP_AGENT_BASE_URL="$BASE_URL" \
MINI_DROP_REASONER_MODE="$REASONER_MODE" \
MINI_DROP_REASONER_CONFIG_PATH="$REASONER_CONFIG_PATH" \
  nohup node dist/server/server/agent/index.js >"$AGENT_LOG" 2>&1 &
AGENT_PID=$!

echo "[mini-drop] server pid=$SERVER_PID log=$SERVER_LOG"
echo "[mini-drop] agent pid=$AGENT_PID log=$AGENT_LOG"
echo "[mini-drop] reasoner mode=$REASONER_MODE config=$REASONER_CONFIG_PATH"
echo "[mini-drop] open $BASE_URL/ after the health endpoint becomes ready"
