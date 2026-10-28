#!/usr/bin/env bash
#
# One-time dev setup for a fresh clone. Safe to re-run: it only fills in
# what is missing and never touches an existing .env.
#
# Usage:
#   ./scripts/setup.sh      (or: npm run setup)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
missing=0

if command -v podman >/dev/null; then
  echo "✓ podman $(podman --version | awk '{print $3}')"
else
  echo "✗ podman not found — install it: sudo apt install podman"
  missing=1
fi

# `podman compose` is only a front end; it needs one of these on PATH.
if command -v podman-compose >/dev/null || command -v docker-compose >/dev/null; then
  echo "✓ compose provider found"
else
  echo "✗ no compose provider — install one: sudo apt install podman-compose"
  missing=1
fi

"$REPO_ROOT/scripts/gen-env.sh" "$REPO_ROOT/.env"

# The webui runs on the host (see podman-compose.yml), so it needs Node and
# its deps. Next.js 16 needs Node >= 20.9; distro packages are often older.
node_new_enough() {
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a==20&&b>=9)?0:1)'
}
if ! command -v node >/dev/null; then
  echo "✗ Node not found — install Node 20.9+ (e.g. nvm install, which reads .nvmrc)"
  missing=1
elif ! node_new_enough; then
  echo "✗ Node $(node --version) is too old (need >= 20.9) — e.g. nvm install, which reads .nvmrc"
  missing=1
elif [[ -d "$REPO_ROOT/webui/node_modules" ]]; then
  echo "✓ Node $(node --version), webui dependencies installed"
else
  echo "… installing webui dependencies"
  npm --prefix "$REPO_ROOT/webui" install
fi

if (( missing )); then
  echo
  echo "Fix the ✗ items above, then re-run this script."
  exit 1
fi

cat <<'EOF'

Ready. Start the stack with:
  podman-compose -f podman-compose.yml up --build
  npm --prefix webui run dev:host          # in a second terminal
Then open http://localhost:3001 (credentials are in .env).
EOF
