#!/usr/bin/env bash
#
# Diagnose and repair domscribe relay port drift.
#
# The relay port is baked into the client bundle at transform time, so the
# browser overlay can only reach a relay that is listening on the port the
# bundle was built against. Nothing renegotiates this at runtime: if the two
# disagree, the overlay just reads "disconnected" forever.
#
# Drift happens because RelayControl.ensureRunning() reuses whatever healthy
# relay it finds, ignoring the port it was asked for -- so the first process to
# start the relay picks the port for everyone. An unpinned spawn (the Claude
# Code MCP adapter passes no port at all) lands on a random one.
#
# Usage:
#   ./scripts/domscribe-doctor.sh              # diagnose, then repair
#   ./scripts/domscribe-doctor.sh --check      # diagnose only; exit 1 on drift
#   ./scripts/domscribe-doctor.sh --bust-cache # also clear stale transforms
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$REPO_ROOT/.domscribe/relay.lock"
NEXT_CONFIG="$REPO_ROOT/webui/next.config.ts"
CHUNK_DIR="$REPO_ROOT/webui/.next/dev/static/chunks"

MODE=fix
BUST_CACHE=0
for arg in "$@"; do
  case "$arg" in
    --check)      MODE=check ;;
    --bust-cache) BUST_CACHE=1 ;;
    -h|--help)    sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *)            echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

# --- 1. The pinned port -------------------------------------------------------
# webui/next.config.ts is the source of truth: it is what the bundle is built
# against. Everything else has to agree with it.
PINNED="$(grep -oP 'relay:\s*\{\s*port:\s*\K[0-9]+' "$NEXT_CONFIG" 2>/dev/null || true)"
if [[ -z "$PINNED" ]]; then
  red "Could not read the pinned relay port from $NEXT_CONFIG"
  echo "Expected something like: withDomscribe({ relay: { port: 4400 } })"
  exit 2
fi

# --- 2. What the relay is actually doing --------------------------------------
LOCK_PORT=""
LOCK_PID=""
if [[ -f "$LOCK" ]]; then
  read -r LOCK_PORT LOCK_PID < <(python3 -c "
import json,sys
try:
    d = json.load(open('$LOCK'))
    print(d.get('port',''), d.get('pid',''))
except Exception:
    print('', '')
")
fi

RELAY_HEALTHY=0
if [[ -n "$LOCK_PORT" ]] && curl -sf -m 3 "http://127.0.0.1:$LOCK_PORT/health" >/dev/null 2>&1; then
  RELAY_HEALTHY=1
fi

# --- 3. What the browser bundle believes --------------------------------------
# Distinct ports across chunks mean a partially rebuilt cache -- also drift.
BUNDLE_PORTS=""
if [[ -d "$CHUNK_DIR" ]]; then
  BUNDLE_PORTS="$(grep -rhoP '__DOMSCRIBE_RELAY_PORT__\s*=\s*\K[0-9]+' "$CHUNK_DIR"/*.js 2>/dev/null | sort -un || true)"
fi

# --- 4. Report ----------------------------------------------------------------
bold "domscribe relay"
echo "  pinned (next.config.ts): $PINNED"
if [[ -z "$LOCK_PORT" ]]; then
  echo "  running:                 (no relay lock -- not running)"
elif [[ $RELAY_HEALTHY -eq 1 ]]; then
  echo "  running:                 $LOCK_PORT (pid $LOCK_PID, healthy)"
else
  echo "  running:                 $LOCK_PORT (pid $LOCK_PID, NOT responding -- stale lock)"
fi
if [[ -z "$BUNDLE_PORTS" ]]; then
  echo "  bundle:                  (no built chunks -- start the dev server to check)"
else
  echo "  bundle:                  $(echo "$BUNDLE_PORTS" | tr '\n' ' ')"
fi
echo

RELAY_DRIFT=0
CACHE_DRIFT=0
[[ $RELAY_HEALTHY -eq 1 && "$LOCK_PORT" == "$PINNED" ]] || RELAY_DRIFT=1
if [[ -n "$BUNDLE_PORTS" && "$BUNDLE_PORTS" != "$PINNED" ]]; then
  CACHE_DRIFT=1
fi

if [[ $RELAY_DRIFT -eq 0 && $CACHE_DRIFT -eq 0 ]]; then
  grn "No drift. The overlay should connect."
  exit 0
fi

[[ $RELAY_DRIFT -eq 1 ]] && red "DRIFT: the relay is not listening on the pinned port."
[[ $CACHE_DRIFT -eq 1 ]] && red "DRIFT: the built chunks point at a port that is not $PINNED (stale transform cache)."

if [[ "$MODE" == check ]]; then
  echo
  echo "Run without --check to repair."
  exit 1
fi

# --- 5. Repair ----------------------------------------------------------------
cd "$REPO_ROOT"

if [[ $RELAY_DRIFT -eq 1 ]]; then
  echo
  bold "Restarting the relay on port $PINNED"
  # Annotations live in .domscribe/annotations and survive a restart.
  if [[ -n "$LOCK_PORT" ]]; then
    npx domscribe stop >/dev/null 2>&1 || true
  fi
  npx domscribe serve -d -p "$PINNED" >/dev/null
  for _ in $(seq 1 20); do
    curl -sf -m 1 "http://127.0.0.1:$PINNED/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
  if curl -sf -m 2 "http://127.0.0.1:$PINNED/health" >/dev/null 2>&1; then
    grn "  relay healthy on $PINNED"
  else
    red "  relay did not come up on $PINNED"
    exit 1
  fi
fi

if [[ $CACHE_DRIFT -eq 1 ]]; then
  echo
  if [[ $BUST_CACHE -eq 1 ]]; then
    bold "Clearing stale transform caches"
    rm -rf "$REPO_ROOT/webui/.next/dev" "$REPO_ROOT/.domscribe/transform-cache"
    grn "  cleared -- the dev server must be restarted to rebuild them"
  else
    ylw "The built chunks are stale. Re-run with --bust-cache to clear them:"
    echo "    ./scripts/domscribe-doctor.sh --bust-cache"
    echo "  (deletes webui/.next/dev and .domscribe/transform-cache; stop the dev server first)"
  fi
fi

echo
bold "Next steps"
echo "  1. Reload the page -- the overlay reconnects on load."
if pgrep -f "next dev" >/dev/null 2>&1; then
  echo "  2. Restart your dev server if you cleared the cache."
else
  echo "  2. Start the dev server: cd webui && npm run dev:host"
fi
echo "  3. Reconnect the domscribe MCP server with /mcp -- it caches the port on connect."
