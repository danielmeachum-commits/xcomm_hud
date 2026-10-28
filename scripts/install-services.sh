#!/usr/bin/env bash
#
# Install xcomm_hud as systemd services using Podman Quadlet.
#
# Run as a normal user to get rootless user services (the default), or as
# root to get system services. Re-run after pulling new code: it rebuilds the
# api and webui images and restarts them, leaving the data volumes alone.
#
# Usage:
#   ./scripts/install-services.sh              # install / update
#   ./scripts/install-services.sh --port 8080  # publish the webui on 8080
#   ./scripts/install-services.sh --uninstall  # stop + remove units (keeps data)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PORT=3001
UNINSTALL=0
while (( $# )); do
  case "$1" in
    --port) WEB_PORT="${2:?--port needs a value}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if (( EUID == 0 )); then
  UNIT_DIR=/etc/containers/systemd
  CONF_DIR=/etc/xcomm-hud
  SYSTEMCTL=(systemctl)
else
  UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd"
  CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xcomm-hud"
  SYSTEMCTL=(systemctl --user)
fi
ENV_FILE="$CONF_DIR/xcomm-hud.env"
SERVICES=(xcomm-hud-postgres xcomm-hud-minio xcomm-hud-api xcomm-hud-webui)

if (( UNINSTALL )); then
  "${SYSTEMCTL[@]}" stop "${SERVICES[@]}" 2>/dev/null || true
  for f in "$REPO_ROOT"/deploy/quadlet/*; do
    rm -f "$UNIT_DIR/$(basename "$f")"
  done
  "${SYSTEMCTL[@]}" daemon-reload
  cat <<EOF
✓ services removed. Data and config were kept:
    podman volume rm xcomm-hud-pgdata xcomm-hud-miniodata   # delete data
    rm $ENV_FILE                                            # delete secrets
EOF
  exit 0
fi

"$REPO_ROOT/scripts/gen-env.sh" "$ENV_FILE" --prod

echo "… building images"
podman build --target prod -t localhost/xcomm-hud-api:latest "$REPO_ROOT/api"
podman build --target prod -t localhost/xcomm-hud-webui:latest "$REPO_ROOT/webui"

# Pull up front so the first service start isn't racing a download.
podman pull -q docker.io/library/postgres:16-alpine cgr.dev/chainguard/minio:latest >/dev/null

mkdir -p "$UNIT_DIR"
for f in "$REPO_ROOT"/deploy/quadlet/*; do
  sed -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@WEB_PORT@|$WEB_PORT|g" \
    "$f" > "$UNIT_DIR/$(basename "$f")"
done
"${SYSTEMCTL[@]}" daemon-reload

# Quadlet units are enabled through their [Install] section, so start/restart
# is all that's needed. Restart only the app containers so the data stores
# don't bounce on every update.
"${SYSTEMCTL[@]}" start xcomm-hud-postgres xcomm-hud-minio
"${SYSTEMCTL[@]}" restart xcomm-hud-api xcomm-hud-webui

echo "✓ xcomm_hud is running on port $WEB_PORT"
echo "  status: ${SYSTEMCTL[*]} status 'xcomm-hud-*'"
echo "  logs:   journalctl ${SYSTEMCTL[1]:-} -u xcomm-hud-api -f"
echo "  admin login is in $ENV_FILE"

if (( EUID != 0 )) && [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
  cat <<EOF

! Lingering is off for $USER, so these services stop when you log out and
  won't start at boot. Turn it on once with:
    sudo loginctl enable-linger $USER
EOF
fi
