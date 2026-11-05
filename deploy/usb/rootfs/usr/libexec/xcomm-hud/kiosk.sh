#!/usr/bin/env bash
#
# Started by the desktop at login. Shows "Starting xcomm…" until the stack
# answers through the web UI, then opens it in Firefox.
#
# A normal maximized window rather than --kiosk on purpose: the XFCE panel
# stays visible, which is where Wi-Fi is joined when the stick needs an
# update. F11 makes it full screen.
set -uo pipefail

URL=http://localhost
HEALTH=$URL/api/be/healthz

healthy() { curl -fs -o /dev/null --max-time 3 "$HEALTH"; }

if ! healthy; then
  (
    # Pulsing progress dialog; closes itself when the loop below ends.
    for _ in $(seq 1 600); do
      healthy && break
      echo "# Starting xcomm… (the first boot loads its images and takes a few minutes)"
      sleep 2
    done
  ) | zenity --progress --pulsate --auto-close --no-cancel \
        --title="xcomm" --text="Starting xcomm…" --width=420 2>/dev/null
fi

if ! healthy; then
  zenity --error --title="xcomm" --width=420 \
    --text="xcomm didn't start.\n\nOpen a terminal and run:\n  ~/xcomm_hud/deploy/bundle/xcomm status\n  journalctl --user -u xcomm-hud" \
    2>/dev/null
  exit 1
fi

exec firefox --new-window "$URL"
