#!/usr/bin/env bash
#
# Bring xcomm up on the USB stick. Runs as the `xcomm` user from
# xcomm-hud.service at every boot.
#
# First boot only: clone the checkout from the git bundle baked into the
# image, point it at GitHub for later updates, load the saved images, and run
# `xcomm init`. After that the checkout and images live in the user's home and
# this just starts the stack — so an update (git pull + rebuild) survives
# reboots, and the read-only seed is never touched again.
set -euo pipefail

SEED=/usr/share/xcomm-hud
CHECKOUT="$HOME/xcomm_hud"
UPSTREAM=https://github.com/danielmeachum-commits/xcomm_hud.git
XCOMM="$CHECKOUT/deploy/bundle/xcomm"

log() { echo "xcomm-boot: $*"; }

if [[ ! -x $XCOMM ]]; then
  log "first boot — setting up $CHECKOUT from the image"
  branch="$(cat "$SEED/branch")"
  # Clone into a temporary name and rename at the end, so a power cut part
  # way through leaves no half checkout that looks finished next boot.
  rm -rf "$CHECKOUT.partial"
  # The bundle holds the branch under a throwaway name (see build.sh); rename
  # it and point it at GitHub, so a later `git pull` on Wi-Fi just works.
  git clone -q -b "$(cat "$SEED/bundle-ref")" "$SEED/xcomm_hud.bundle" "$CHECKOUT.partial"
  git -C "$CHECKOUT.partial" branch -q -m "$branch"
  git -C "$CHECKOUT.partial" remote set-url origin "$UPSTREAM"
  git -C "$CHECKOUT.partial" config "branch.$branch.remote" origin
  git -C "$CHECKOUT.partial" config "branch.$branch.merge" "refs/heads/$branch"
  mkdir -p "$CHECKOUT.partial/.bundle/images"
  # A copy, not a link: save-images prunes old files in this directory.
  cp "$SEED"/images/xcomm-*.tar "$CHECKOUT.partial/.bundle/images/"
  mv "$CHECKOUT.partial" "$CHECKOUT"
fi

if [[ ! -f $CHECKOUT/.bundle/xcomm.env ]]; then
  # Port 80 is already allowed by /usr/lib/sysctl.d/90-xcomm-hud.conf, so
  # init needs no sudo here. It loads the images from .bundle/images/.
  log "generating secrets and loading images (a few minutes on first boot)"
  "$XCOMM" init
fi

exec "$XCOMM" start
