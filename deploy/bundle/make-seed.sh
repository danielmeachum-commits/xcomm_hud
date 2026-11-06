#!/usr/bin/env bash
#
# Build the "seed" an offline host starts from: the app images and the code,
# taken from a branch AS IT IS ON GITHUB. Shared by the USB stick
# (deploy/usb/build.sh) and the Windows kit (deploy/windows/build-kit.sh), so
# both always carry the same thing.
#
#   deploy/bundle/make-seed.sh <branch> <output dir>
#
# Needs internet (it builds the images). Writes into <output dir>:
#   xcomm_hud.bundle       git bundle of the branch (under a throwaway name)
#   bundle-ref             that throwaway branch name
#   branch                 the branch the host tracks for updates
#   revision               short commit the images were built from
#   images/xcomm-<rev>.tar all four images, from deploy/bundle/xcomm save-images
#
# A host turns this into a checkout with:
#   git clone -b "$(cat bundle-ref)" xcomm_hud.bundle <dir>
#   git -C <dir> branch -m "$(cat branch)"   # and point origin at GitHub
set -euo pipefail

BRANCH="${1:?usage: make-seed.sh <branch> <output dir>}"
SEED="${2:?usage: make-seed.sh <branch> <output dir>}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BUNDLE_DIR/../.." && pwd)"

# A clean checkout of the branch as it is on GitHub, in a temporary worktree,
# so a host never carries uncommitted edits from the machine that built it.
git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
REV="$(git -C "$REPO_ROOT" rev-parse --short "origin/$BRANCH")"
WT="$(mktemp -d -t xcomm-seed-XXXXXX)"
SEED_REF="xcomm-seed-$REV-$$"
cleanup() {
  git -C "$REPO_ROOT" branch -D -q "$SEED_REF" 2>/dev/null || true
  git -C "$REPO_ROOT" worktree remove --force "$WT" 2>/dev/null || rm -rf "$WT"
}
trap cleanup EXIT
git -C "$REPO_ROOT" worktree add -q --detach "$WT" "origin/$BRANCH"
echo "Seed: $BRANCH at $REV."

# The images, built from that checkout.
"$WT/deploy/bundle/xcomm" build
"$WT/deploy/bundle/xcomm" save-images

rm -rf "$SEED"
mkdir -p "$SEED/images"
mv "$WT"/.bundle/images/xcomm-"$REV".tar "$SEED/images/"

# Bundled under a throwaway branch name, never `$BRANCH` itself: branches are
# shared by every worktree, so `git branch -f main` here would move — and could
# rewind — the main in the checkout this script was run from. The host renames
# it back to $BRANCH.
git -C "$WT" branch "$SEED_REF" HEAD
git -C "$WT" bundle create -q "$SEED/xcomm_hud.bundle" "$SEED_REF"
echo "$BRANCH" > "$SEED/branch"
echo "$SEED_REF" > "$SEED/bundle-ref"
echo "$REV" > "$SEED/revision"
du -sh "$SEED"/* | sed 's/^/  /'
