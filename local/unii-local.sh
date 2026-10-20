#!/usr/bin/env bash
# unii-local
# ==========
# UniiChat from this source, on the LiteLLM proxy ($LITELLM_API_BASE,
# $LITELLM_API_KEY): the server's key and Claude API origin are set for
# the server process only. Term.ts opens loopback servers only. Web
# search goes through a SearXNG in Docker on 127.0.0.1 (pinned image),
# when Docker runs; without it the chat runs with no search.
#
#   unii              start the server if it is not running, open the chat
#   unii serve        run the server in the foreground
#   unii start|stop   start (background) or stop the server and SearXNG
#   unii log          follow the server's log (sign-in links print there)
#   unii <args>       anything else goes to Term.ts (e.g. login, version)
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PORT="${UNII_PORT:-8788}"
URL="http://127.0.0.1:$PORT"
DIR="${UNII_DIR:-$HOME/.unii}"
LOG="$DIR/server.log"
PID="$DIR/server.pid"

SEARX_NAME="unii-searxng"
SEARX_PORT="${UNII_SEARXNG_PORT:-8888}"
SEARX_DIR="$DIR/searxng"
SEARX_IMAGE="searxng/searxng:2026.10.4-d48c4b555@sha256:76b0bf285aca014c7191fc4d9234c4bfb358624ac33d8883833d496c059ec072"

# the SearXNG the server's `search` tool uses ("": none)
SEARCH=""

mkdir -p "$DIR"
chmod 700 "$DIR"

# SearXNG, started if it is not running: its settings made once (JSON
# results on, its own random secret key, no rate limiter), its port bound
# to 127.0.0.1 only. Sets SEARCH once it answers
searxng_start() {
  if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
    echo "unii: Docker is not running; web search is off" >&2
    return 0
  fi
  if [[ ! -f "$SEARX_DIR/settings.yml" ]]; then
    mkdir -p "$SEARX_DIR"
    (umask 077 && printf 'use_default_settings: true\nserver:\n  secret_key: "%s"\n  limiter: false\n  image_proxy: false\n  public_instance: false\nsearch:\n  formats:\n    - html\n    - json\n' "$(openssl rand -hex 32)" >"$SEARX_DIR/settings.yml")
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$SEARX_NAME" 2>/dev/null)" != "true" ]]; then
    docker rm -f "$SEARX_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$SEARX_NAME" -p "127.0.0.1:$SEARX_PORT:8080" -v "$SEARX_DIR:/etc/searxng" "$SEARX_IMAGE" >/dev/null
  fi
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$SEARX_PORT/healthz" 2>/dev/null; then
      SEARCH="http://127.0.0.1:$SEARX_PORT"
      return 0
    fi
    sleep 0.5
  done
  echo "unii: SearXNG did not answer; web search is off (docker logs $SEARX_NAME)" >&2
}

# the server: its key and origin from LiteLLM, Opus 5.5 by default, Haiku
# 5.5 for summaries, search by SearXNG instead of Anthropic's server tool
# (LiteLLM serves Claude from Bedrock, which has none), no mail or push keys
server_exec() {
  exec env -u RESEND_API_KEY -u APNS_KEY -u OPENAI_API_KEY \
    ANTHROPIC_API_KEY="${LITELLM_API_KEY:?set LITELLM_API_KEY}" \
    UNII_ANTHROPIC_URL="${LITELLM_API_BASE:?set LITELLM_API_BASE}" \
    UNII_PICK="${UNII_PICK:-claude-api:opus-5.5:high:slow}" \
    UNII_COMPACTOR="${UNII_COMPACTOR:-claude-api:haiku-5.5:high:slow}" \
    UNII_SEARCHES=0 \
    UNII_SEARXNG_URL="$SEARCH" \
    UNII_SITE="$URL" \
    bun "$ROOT/Server.ts" "$PORT"
}

# the terminal: its /import reads only the redacted copy of Claude Code's
# logs (local/prime/redact.ts), never ~/.claude or ~/.codex themselves
term_exec() {
  exec env UNII_IMPORT_DIRS="${UNII_IMPORT_DIRS:-$HOME/.unii-prime/claude/projects}" bun "$ROOT/Term.ts" "$@"
}

server_up() {
  curl -fsS --max-time 2 -o /dev/null "$URL/" 2>/dev/null
}

server_start() {
  if server_up; then
    return 0
  fi
  searxng_start
  (trap '' HUP && server_exec) >>"$LOG" 2>&1 &
  echo "$!" >"$PID"
  for _ in $(seq 1 50); do
    if server_up; then
      echo "unii: server on $URL, search ${SEARCH:-off} (log: $LOG)" >&2
      return 0
    fi
    sleep 0.2
  done
  echo "unii: server did not start; see $LOG" >&2
  return 1
}

server_stop() {
  if [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2>/dev/null; then
    kill "$(cat "$PID")"
    rm -f "$PID"
    echo "unii: server stopped" >&2
  else
    echo "unii: no server started by this script is running" >&2
  fi
  if command -v docker >/dev/null && docker stop "$SEARX_NAME" >/dev/null 2>&1; then
    echo "unii: SearXNG stopped" >&2
  fi
}

case "${1:-}" in
  serve) searxng_start && server_exec ;;
  start) server_start ;;
  stop)  server_stop ;;
  log)   exec tail -f "$LOG" ;;
  "")    server_start && term_exec "$URL" ;;
  *)     term_exec "$@" ;;
esac
