#!/usr/bin/env bash
#
# Build the xcomm USB disk image. Needs internet and sudo, and ~30 GB free.
#
#   deploy/usb/build.sh                 # the stick tracks main
#   deploy/usb/build.sh --branch dev    # …or another branch on GitHub
#
# Steps:
#   1. Check out the branch as it is on GitHub into a clean temporary
#      worktree, so the stick never carries uncommitted edits.
#   2. Build and save the app images from that checkout (deploy/bundle/xcomm
#      build + save-images, rootless).
#   3. Seed: a git bundle of the branch and the saved images file.
#   4. Build the bootable OS image from deploy/usb/Containerfile (sudo podman).
#   5. Turn it into a raw disk image with bootc-image-builder (sudo).
#
# Output: deploy/usb/output/image/disk.raw — write it with deploy/usb/flash.sh.
set -euo pipefail

USB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$USB_DIR/../.." && pwd)"
BRANCH=main
while (( $# )); do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
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

# ---- 1. clean checkout of the branch as it is on GitHub ----
step "1/5  Checking out origin/$BRANCH"
git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
REV="$(git -C "$REPO_ROOT" rev-parse --short "origin/$BRANCH")"
WT="$(mktemp -d -t xcomm-usb-XXXXXX)"
cleanup() { git -C "$REPO_ROOT" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"; }
trap cleanup EXIT
git -C "$REPO_ROOT" worktree add -q --detach "$WT" "origin/$BRANCH"
echo "Building $BRANCH at $REV."

# ---- 2. app images from that checkout ----
step "2/5  Building the app images"
"$WT/deploy/bundle/xcomm" build
"$WT/deploy/bundle/xcomm" save-images

# ---- 3. seed ----
step "3/5  Assembling the seed"
rm -rf "$SEED"
mkdir -p "$SEED/images"
mv "$WT"/.bundle/images/xcomm-"$REV".tar "$SEED/images/"
# Bundled under a throwaway branch name, never `$BRANCH` itself: branches are
# shared by every worktree, so `git branch -f main` here would move — and
# could rewind — the main in the checkout this script was run from.
# boot.sh renames it back to $BRANCH on the stick.
SEED_REF="xcomm-usb-seed-$REV-$$"
git -C "$WT" branch "$SEED_REF" HEAD
git -C "$WT" bundle create -q "$SEED/xcomm_hud.bundle" "$SEED_REF"
git -C "$REPO_ROOT" branch -D -q "$SEED_REF"
echo "$BRANCH" > "$SEED/branch"
echo "$SEED_REF" > "$SEED/bundle-ref"
echo "$REV" > "$SEED/revision"
du -sh "$SEED"/* | sed 's/^/  /'

# ---- 4. the bootable OS image ----
# Rootful, because bootc-image-builder reads from root's image store.
step "4/5  Building the OS image (sudo)"
IMAGE="localhost/xcomm-hud-usb:$REV"
sudo podman build --pull=newer -t "$IMAGE" -t localhost/xcomm-hud-usb:current "$USB_DIR"

# ---- 5. disk image ----
step "5/5  Making the disk image (sudo)"
mkdir -p "$OUT"
CONFIG="$(mktemp -t xcomm-usb-config-XXXXXX.toml)"
chmod 600 "$CONFIG"
trap 'cleanup; rm -f "$CONFIG"' EXIT
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
