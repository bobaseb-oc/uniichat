#!/usr/bin/env bash
# OKF ontology MCP server, for Legion (mcp.extra.json "okf")
# ==========================================================
# Starts the OnCorps Knowledge Framework's own read-only MCP server
# (src/scripts/okf_mcp_server.py, stdio) from an OKF checkout of 0.x:
# $OKF_CHECKOUT, else ~/.unii/okf (a link to the checkout). Before it starts,
# it (re)builds the internal dataset when the manifest is missing or was
# built from another commit, so the agents read the checkout's current
# ontology. stdout is the MCP stream only: everything else goes to stderr.
set -euo pipefail

okf="${OKF_CHECKOUT:-$HOME/.unii/okf}"
if [[ ! -f "$okf/src/scripts/okf_mcp_server.py" ]]; then
  echo "okf-mcp: no OKF checkout at $okf (set OKF_CHECKOUT, or link ~/.unii/okf to a checkout of 0.x)" >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  echo "okf-mcp: uv is not on PATH" >&2
  exit 1
fi

manifest="$okf/build/internal.manifest.json"
head="$(git -C "$okf" rev-parse HEAD)"
if [[ ! -f "$manifest" ]] || ! grep -q "\"okf_commit\": *\"$head\"" "$manifest"; then
  echo "okf-mcp: building the internal dataset at ${head:0:8}" >&2
  (cd "$okf" && uv run --quiet src/scripts/build_client_dataset.py --internal --out-dir build --okf-commit "$head") >&2
fi

cd "$okf"
export OKF_DATASET_MANIFEST="$manifest"
exec uv run --quiet --project "$okf" python "$okf/src/scripts/okf_mcp_server.py"
