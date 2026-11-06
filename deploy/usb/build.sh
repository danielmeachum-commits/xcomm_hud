#!/usr/bin/env bash
#
# Build the xcomm USB disk image. Needs internet and sudo, and ~30 GB free.
#
#   deploy/usb/build.sh                 # the stick tracks main
#   deploy/usb/build.sh --branch dev    # …or another branch on GitHub
#   deploy/usb/build.sh --debug         # for diagnosing a stick that won't boot
#
# --debug stops on a boot failure instead of rebooting (rd.emergency=halt) and
# opens a root shell on Ctrl+Alt+F9 that works even though root is locked
# (systemd.debug_shell). From it:
#   mkdir -p /tmp/e && mount /dev/disk/by-label/EFI-SYSTEM /tmp/e
#   cp /run/initramfs/rdsosreport.txt /tmp/e/ && umount /tmp/e
# puts the boot report on the stick, readable from any other machine. Never
# ship a --debug stick: that shell needs no password.
#
# Steps:
#   1–3. The seed (deploy/bundle/make-seed.sh): the branch as it is on
#        GitHub, its app images, and a git bundle of it — never uncommitted
#        edits from this machine.
#   4. Build the bootable OS image from deploy/usb/Containerfile (sudo podman).
#   5. Turn it into a raw disk image with bootc-image-builder (sudo).
#
# Output: deploy/usb/output/image/disk.raw — write it with deploy/usb/flash.sh.
set -euo pipefail

USB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$USB_DIR/../.." && pwd)"
BRANCH=main
DEBUG=0
while (( $# )); do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --debug) DEBUG=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

SEED="$USB_DIR/seed"
OUT="$USB_DIR/output"
# bootc-image-builder publishes a moving tag only; this is a build-time tool,
# not something that ends up on the stick.
BIB=quay.io/centos-bootc/bootc-image-builder:latest
ROOT_SIZE="40 GiB"

B=$'\e[1m'; N=$'\e[0m'
step() { echo; echo "${B}== $*${N}"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v podman >/dev/null || die "podman is required."
# The password prompt below and sudo both need a terminal to type into.
# Without one, `read` hits end-of-input and the script used to exit silently.
[[ -t 0 ]] || die "Run this in a terminal window: it asks for passwords (the stick's account, then sudo)."
git -C "$REPO_ROOT" rev-parse >/dev/null || die "Run this from the xcomm_hud checkout."

# ---- password for the stick's account (sudo, screen unlock) ----
step "Account on the stick"
echo "The stick logs in as 'xcomm' automatically. Choose its password —"
echo "it's needed for sudo and to unlock the screen."
while :; do
  read -rsp "Password for xcomm: " PW1; echo
  read -rsp "Again: " PW2; echo
  [[ -n $PW1 && $PW1 == "$PW2" ]] && break
  echo "Didn't match (or empty) — try again."
done

# ---- 1–3. the seed: app images + a git bundle, from GitHub ----
# Shared with the Windows kit, so both always carry the same thing.
step "1–3/5  Building the seed from origin/$BRANCH"
"$REPO_ROOT/deploy/bundle/make-seed.sh" "$BRANCH" "$SEED"
REV="$(cat "$SEED/revision")"

# ---- 4. the bootable OS image ----
# Rootful, because bootc-image-builder reads from root's image store.
step "4/5  Building the OS image (sudo)"
IMAGE="localhost/xcomm-hud-usb:$REV"
sudo podman build --pull=newer -t "$IMAGE" -t localhost/xcomm-hud-usb:current "$USB_DIR"

# ---- 5. disk image ----
step "5/5  Making the disk image (sudo)"
mkdir -p "$OUT"
KARGS_DEBUG=""
if (( DEBUG )); then
  KARGS_DEBUG=" rd.emergency=halt systemd.debug_shell=1"
  echo "DEBUG build: stops on boot failures; passwordless root shell on Ctrl+Alt+F9."
fi
CONFIG="$(mktemp -t xcomm-usb-config-XXXXXX.toml)"
chmod 600 "$CONFIG"
trap 'rm -f "$CONFIG"' EXIT
# TOML basic strings: escape backslashes and quotes in the password.
PW_TOML="${PW1//\\/\\\\}"; PW_TOML="${PW_TOML//\"/\\\"}"
cat >"$CONFIG" <<EOF
[[customizations.user]]
name = "xcomm"
password = "$PW_TOML"
groups = ["wheel", "autologin"]

[[customizations.filesystem]]
mountpoint = "/"
minsize = "$ROOT_SIZE"

# bootc-image-builder adds "console=tty0 console=ttyS0". The LAST console is
# the primary one, so boot status and emergency-mode errors went to a serial
# port laptops don't have, and the screen just stopped at "emergency mode"
# with nothing above it. Appending tty0 again makes the screen primary.
[customizations.kernel]
append = "console=tty0${KARGS_DEBUG}"
EOF
sudo podman run --rm --privileged --pull=newer \
  --security-opt label=type:unconfined_t \
  -v "$CONFIG":/config.toml:ro \
  -v "$OUT":/output \
  -v /var/lib/containers/storage:/var/lib/containers/storage \
  "$BIB" --type raw --rootfs xfs "$IMAGE"
sudo chown -R "$(id -u):$(id -g)" "$OUT"

echo
echo "✓ Disk image: $OUT/image/disk.raw  ($BRANCH at $REV)"
echo "  Write it to a stick (≥ 64 GB recommended):  deploy/usb/flash.sh /dev/sdX"
