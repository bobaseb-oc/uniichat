#!/usr/bin/env bash
# unii-local
# ==========
# UniiChat from this source, on the LiteLLM proxy ($LITELLM_API_BASE,
# $LITELLM_API_KEY): the server's key and Claude API origin are set for
# the server process only. Term.ts opens loopback servers only.
#
#   unii              start the server if it is not running, open the chat
#   unii serve        run the server in the foreground
#   unii start|stop   start (background) or stop the server
#   unii log          follow the server's log (sign-in links print there)
#   unii <args>       anything else goes to Term.ts (e.g. login, version)
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PORT="${UNII_PORT:-8788}"
URL="http://127.0.0.1:$PORT"
DIR="${UNII_DIR:-$HOME/.unii}"
LOG="$DIR/server.log"
PID="$DIR/server.pid"

mkdir -p "$DIR"
chmod 700 "$DIR"

# the server's command: its key and origin from LiteLLM, Opus 5.5 by default,
# Haiku 5.5 for summaries, no web search (LiteLLM serves Claude from Bedrock,
# which has no server-side web search tool), no mail or push keys
server_cmd=(
  env -u RESEND_API_KEY -u APNS_KEY -u OPENAI_API_KEY
  ANTHROPIC_API_KEY="${LITELLM_API_KEY:?set LITELLM_API_KEY}"
  UNII_ANTHROPIC_URL="${LITELLM_API_BASE:?set LITELLM_API_BASE}"
  UNII_PICK="${UNII_PICK:-claude-api:opus-5.5:high:slow}"
  UNII_COMPACTOR="${UNII_COMPACTOR:-claude-api:haiku-5.5:high:slow}"
  UNII_SEARCHES=0
  UNII_SITE="$URL"
  bun "$ROOT/Server.ts" "$PORT"
)

server_up() {
  curl -fsS --max-time 2 -o /dev/null "$URL/" 2>/dev/null
}

server_start() {
  if server_up; then
    return 0
  fi
  nohup "${server_cmd[@]}" >>"$LOG" 2>&1 &
  echo "$!" >"$PID"
  for _ in $(seq 1 50); do
    if server_up; then
      echo "unii: server on $URL (log: $LOG)" >&2
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
}

case "${1:-}" in
  serve) exec "${server_cmd[@]}" ;;
  start) server_start ;;
  stop)  server_stop ;;
  log)   exec tail -f "$LOG" ;;
  "")    server_start && exec bun "$ROOT/Term.ts" "$URL" ;;
  *)     exec bun "$ROOT/Term.ts" "$@" ;;
esac
