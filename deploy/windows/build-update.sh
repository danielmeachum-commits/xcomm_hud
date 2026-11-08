#!/usr/bin/env bash
#
# Build an update package for a Windows host that already has xcomm (from the
# install kit). Run on a connected Linux machine with podman; needs ~5 GB free.
#
#   deploy/windows/build-update.sh                  # main, as it is on GitHub
#   deploy/windows/build-update.sh --branch dev     # …or another branch
#
# Output: deploy/windows/output/xcomm-windows-update/ — copy the folder to a
# USB drive (it fits on FAT32) and, on the Windows machine, double-click
# update.cmd as the account that runs xcomm. Nothing there needs the internet.
#
#   update.cmd, update.ps1   bring the code up to date, then run
#                            `xcomm.ps1 update` with the images below
#   README.txt
#   MANIFEST.txt             SHA-256 of everything in the package
#   seed/                    app images + git bundle (deploy/bundle/make-seed.sh)
#
# The same seed as the install kit, without the installers.
set -euo pipefail

WIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WIN_DIR/../.." && pwd)"
OUT="$WIN_DIR/output/xcomm-windows-update"
BRANCH=main
while (( $# )); do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

B=$'\e[1m'; N=$'\e[0m'
step() { echo; echo "${B}== $*${N}"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v podman >/dev/null || die "podman is required."

# update.ps1 runs the branch's own xcomm.ps1 update, so the branch needs it.
git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
for f in update.ps1 update.cmd xcomm.ps1; do
  git -C "$REPO_ROOT" cat-file -e "origin/$BRANCH:deploy/windows/$f" 2>/dev/null ||
    die "origin/$BRANCH has no deploy/windows/$f — build from a branch with the Windows update support."
  # Windows PowerShell 5.1 reads a script without a byte-order mark as
  # Windows-1252; keep the Windows scripts ASCII (see build-kit.sh).
  if git -C "$REPO_ROOT" show "origin/$BRANCH:deploy/windows/$f" | grep -q -P '[^\x00-\x7F]'; then
    die "deploy/windows/$f has non-ASCII characters; Windows PowerShell 5.1 may misread them."
  fi
done
git -C "$REPO_ROOT" show "origin/$BRANCH:deploy/windows/xcomm.ps1" | grep -q "'update'" ||
  die "origin/$BRANCH's xcomm.ps1 has no update command."

rm -rf "$OUT"
mkdir -p "$OUT"

step "1/2  App images and code from origin/$BRANCH"
"$REPO_ROOT/deploy/bundle/make-seed.sh" "$BRANCH" "$OUT/seed"
REV="$(cat "$OUT/seed/revision")"
for f in update.ps1 update.cmd; do
  git -C "$REPO_ROOT" show "origin/$BRANCH:deploy/windows/$f" > "$OUT/$f"
done
# git show gives the repository's bytes; batch files need CRLF.
sed -i 's/\r*$/\r/' "$OUT/update.cmd"

step "2/2  README and manifest"
cat > "$OUT/README.txt" <<TXT
xcomm_hud - update package for Windows
Built $(date -u +%Y-%m-%dT%H:%MZ) from $BRANCH at $REV.

For a machine that already runs xcomm (installed from the install kit).
Data, logins, secrets and settings are kept. No internet needed.

To update:
  1. Copy this whole folder to the Windows machine, or run it from a USB drive.
  2. Log in as the account that runs xcomm and double-click update.cmd.
     (Not "Run as administrator".)
  3. Wait for "Updated: <old> -> $REV". It takes a few minutes; xcomm is
     down for about a minute of that.

What it does: brings C:\\xcomm\\xcomm_hud to $REV, backs up the database to
C:\\xcomm\\xcomm_hud\\.bundle\\backups, loads the new images, restarts xcomm
and checks it answers, then removes the previous version's images.

If the backup fails, nothing is changed. If the new version doesn't come up,
the window shows the API's logs and where the backup is.
TXT
sed -i 's/\r*$/\r/' "$OUT/README.txt"
{
  echo "xcomm_hud Windows update — $BRANCH at $REV"
  echo
  (cd "$OUT" && find . -type f ! -name MANIFEST.txt -print0 | sort -z | xargs -0 sha256sum)
} > "$OUT/MANIFEST.txt"

echo
du -sh "$OUT" | sed 's/^/  /'
echo "✓ Update package: $OUT  ($BRANCH at $REV)"
echo "  Copy the folder to the Windows machine and double-click update.cmd."
