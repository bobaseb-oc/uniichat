#!/usr/bin/env bash
# legion (local/legion; unii-local.sh, the old name, is this file)
# ======
# Legion from this source, on the LiteLLM proxy ($LITELLM_API_BASE,
# $LITELLM_API_KEY): the server's key and Claude API origin are set for
# the server process only. Term.ts opens loopback servers only. Web
# search goes through a SearXNG in Docker on 127.0.0.1 (pinned image),
# when Docker runs; without it the chat runs with no search.
#
#   legion              start the server if it is not running, open the chat
#   legion serve        run the server in the foreground
#   legion start|stop   start (background) or stop the server and SearXNG
#   legion web          open the site in your browser, signed in as your terminal
#   legion device       this computer runs the agents' jobs with no terminal open
#                     (foreground; `legion device --install` keeps one running
#                     at login with launchd, `--uninstall` removes it)
#   legion log          follow the server's log (sign-in links print there)
#   legion knowledge    rebuild ~/.unii-prime/knowledge.json (OKF, graphify guides,
#                     repo digests and cards; local/prime/knowledge.ts)
#   legion mcp-login S  sign in to the MCP server S with OAuth (e.g. atlassian);
#                     the grant goes to the Keychain only
#   legion mcp-logout S delete that grant
#   legion google-login [client.json]  sign in to Google for the cockpit's
#                     calendar, transcripts, Gmail, Chat (read-only; Keychain only)
#   legion google-logout  revoke that grant at Google and delete it
#   legion harvest-login  keep a Harvest personal access token in the Keychain
#                     (asked for, not echoed); the timesheet's drafts and Submit
#   legion harvest-logout delete it
#   legion <args>       anything else goes to Term.ts (e.g. login, version)
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
    echo "legion: Docker is not running; web search is off" >&2
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
  echo "legion: SearXNG did not answer; web search is off (docker logs $SEARX_NAME)" >&2
}

# the server: its key and origin from LiteLLM, Opus 5.5 by default, Haiku
# 5.5 for summaries, search by SearXNG instead of Anthropic's server tool
# (LiteLLM serves Claude from Bedrock, which has none), your Claude Code
# rules live (local/rules.md), no mail or push keys
server_exec() {
  exec env -u RESEND_API_KEY -u APNS_KEY -u OPENAI_API_KEY \
    ANTHROPIC_API_KEY="${LITELLM_API_KEY:?set LITELLM_API_KEY}" \
    UNII_ANTHROPIC_URL="${LITELLM_API_BASE:?set LITELLM_API_BASE}" \
    UNII_PICK="${UNII_PICK:-claude-api:opus-5.5:high:slow}" \
    UNII_COMPACTOR="${UNII_COMPACTOR:-claude-api:haiku-5.5:high:slow}" \
    UNII_SEARCHES=0 \
    UNII_SEARXNG_URL="$SEARCH" \
    UNII_MCP="$DIR/mcp.json" \
    UNII_RULES="${UNII_RULES:-$ROOT/local/rules.md}" \
    UNII_SITE="$URL" \
    bun "$ROOT/Server.ts" "$PORT"
}

# Claude Code's logs staged anew (local/prime/logs.ts), redacted, so the
# chat's import, asked at its start, finds what was said since the last
logs_make() {
  bun "$ROOT/local/prime/logs.ts" || echo "legion: Claude Code logs not staged" >&2
}

# the terminal: its /import reads only the redacted copy of Claude Code's
# logs (local/prime/redact.ts), never ~/.claude or ~/.codex themselves.
# RED ZONE (security review SB, DRAFT awaiting the user's sign-off) M2:
# it runs the agents' jobs, so it gets no gateway, vendor, mail or push
# key (the status line's spend reads LiteLLM's key from the Keychain)
term_exec() {
  exec env -u LITELLM_API_KEY -u LITELLM_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u OPENAI_API_KEY -u RESEND_API_KEY -u APNS_KEY \
    UNII_IMPORT_DIRS="${UNII_IMPORT_DIRS:-$HOME/.unii-prime/claude/projects}" UNII_IMPORT_ASK="${UNII_IMPORT_ASK:-}" bun "$ROOT/Term.ts" "$@"
}

# `legion device --install`: a launchd agent (at login, kept alive) that
# runs `legion device-run`, so the cockpit's reads go on with no window
# open; it gets this shell's PATH (gh, acli, git, bun) and UNII_* settings,
# never a secret (the device signs in with the terminal's saved session).
# It does not start the server: it waits for one (the socket opens again)
AGENT_LABEL="com.oncorps.legion.device"
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }
device_install() {
  local env="" name
  for name in PATH HOME UNII_PORT UNII_DIR UNII_SPACES UNII_HOME_REPO UNII_WORK UNII_COMPUTER; do
    if [[ -n "${!name:-}" ]]; then
      env+="    <key>$name</key><string>$(xml "${!name}")</string>"$'\n'
    fi
  done
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(xml "$ROOT/local/unii-local.sh")</string><string>device-run</string></array>
  <key>EnvironmentVariables</key>
  <dict>
$env  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>$(xml "$DIR/device.log")</string>
  <key>StandardOutPath</key><string>/dev/null</string>
</dict>
</plist>
PLIST
  plutil -lint "$AGENT_PLIST" >/dev/null
  launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST"
  echo "legion: device agent installed ($AGENT_PLIST); its log: $DIR/device.log; legion device --uninstall removes it" >&2
}
device_uninstall() {
  launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null || true
  rm -f "$AGENT_PLIST"
  echo "legion: device agent removed" >&2
}

# the MCP servers the agents may use (local/mcp.ts): Claude Code's and
# the extra ones installed in local/tools, no secret written (each is read
# from ~/.claude.json as its server opens)
mcp_make() {
  if [[ ! -d "$ROOT/local/tools/node_modules" ]]; then
    echo "legion: browser tools are not installed: npm ci --prefix $ROOT/local/tools" >&2
  fi
  bun "$ROOT/local/mcp.ts" "$DIR/mcp.json" >&2 || echo "legion: no MCP servers" >&2
}

# the skills index the rules import (local/skills.ts): what Claude Code
# has installed and enabled now, so a plugin installed there shows here
# at the next start
skills_make() {
  bun "$ROOT/local/skills.ts" "$DIR/skills.md" >&2 || echo "legion: no skills index" >&2
}

# RED ZONE (security review U1, DRAFT awaiting the user's sign-off): up
# means answering on its unix socket (only this user's processes can bind
# it), so a process squatting the TCP port is not taken for the server
server_up() {
  curl -fsS --max-time 2 -o /dev/null --unix-socket "$DIR/server.sock" "$URL/" 2>/dev/null
}

server_start() {
  if server_up; then
    return 0
  fi
  searxng_start
  skills_make
  mcp_make
  (trap '' HUP && server_exec) >>"$LOG" 2>&1 &
  echo "$!" >"$PID"
  for _ in $(seq 1 50); do
    if server_up; then
      echo "legion: server on $URL, search ${SEARCH:-off} (log: $LOG)" >&2
      return 0
    fi
    sleep 0.2
  done
  echo "legion: server did not start; see $LOG" >&2
  return 1
}

server_stop() {
  if [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2>/dev/null; then
    kill "$(cat "$PID")"
    rm -f "$PID"
    echo "legion: server stopped" >&2
  else
    echo "legion: no server started by this script is running" >&2
  fi
  if command -v docker >/dev/null && docker stop "$SEARX_NAME" >/dev/null 2>&1; then
    echo "legion: SearXNG stopped" >&2
  fi
}

case "${1:-}" in
  serve) searxng_start && skills_make && mcp_make && server_exec ;;
  start) server_start ;;
  stop)  server_stop ;;
  web)   server_start && term_exec web "$URL" ;;
  device)
    case "${2:-}" in
      --install)   device_install ;;
      --uninstall) device_uninstall ;;
      *)           server_start && term_exec device "$URL" ;;
    esac ;;
  device-run) term_exec device "$URL" ;;
  log)   exec tail -f "$LOG" ;;
  knowledge) bun "$ROOT/local/prime/knowledge.ts" && echo "legion: then, in the chat: /import ~/.unii-prime/knowledge.json" >&2 ;;
  mcp-login)  mcp_make && exec bun "$ROOT/local/mcp-login.ts" "${2:?which server, e.g. atlassian}" ;;
  mcp-logout) mcp_make && exec bun "$ROOT/local/mcp-login.ts" "${2:?which server, e.g. atlassian}" --logout ;;
  google-login)  exec bun "$ROOT/local/google-login.ts" "${@:2}" ;;
  google-logout) exec bun "$ROOT/local/google-login.ts" --logout ;;
  harvest-login)  exec bun "$ROOT/local/harvest-login.ts" "${@:2}" ;;
  harvest-logout) exec bun "$ROOT/local/harvest-login.ts" --logout ;;
  "")    server_start && logs_make && UNII_IMPORT_ASK=1 term_exec "$URL" ;;
  *)     term_exec "$@" ;;
esac
