#!/usr/bin/env bash
#
# Build the offline Windows install kit. Run on a connected Linux machine with
# podman; needs ~6 GB free.
#
#   deploy/windows/build-kit.sh                  # the host tracks main
#   deploy/windows/build-kit.sh --branch dev     # …or another branch on GitHub
#   deploy/windows/build-kit.sh --zip            # also write one .zip of the kit
#
# Output: deploy/windows/output/xcomm-windows-kit/ — copy the whole folder to a
# USB drive, and on the Windows machine double-click install.cmd. Nothing on
# the Windows side needs the internet.
#
#   install.cmd, install.ps1   the installer (from the branch, like the code)
#   README.txt
#   MANIFEST.txt               versions and SHA-256 of everything in the kit
#   installers/                WSL, Podman, Git for Windows, docker-compose,
#                              and Podman's WSL machine image
#   seed/                      app images + git bundle (deploy/bundle/make-seed.sh)
#
# Every download is pinned below and checked against the SHA-256 its publisher
# lists. Bump a version deliberately, then rebuild and test the kit.
set -euo pipefail

WIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WIN_DIR/../.." && pwd)"
OUT="$WIN_DIR/output/xcomm-windows-kit"
BRANCH=main
ZIP=0
while (( $# )); do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --zip) ZIP=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# ---- pinned versions: "repo tag asset" from GitHub releases ----
DOWNLOADS=(
  "microsoft/WSL 3.0.3 wsl.3.0.3.0.x64.msi"
  "containers/podman v6.1.4 podman-installer-windows-amd64.msi"
  "git-for-windows/git v2.56.0.windows.4 Git-2.56.0.4-64-bit.exe"
  "docker/compose v5.7.0 docker-compose-windows-x86_64.exe"
)
# Podman's WSL machine image. Its tag must match Podman's major.minor above:
# a client and machine of different versions are unsupported.
MACHINE_OS=quay.io/podman/machine-os
MACHINE_OS_TAG=6.1
MACHINE_IMAGE_NAME=podman-machine.x86_64.wsl.tar.zst
SKOPEO=quay.io/skopeo/stable:v1.20.0

B=$'\e[1m'; N=$'\e[0m'
step() { echo; echo "${B}== $*${N}"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v podman >/dev/null || die "podman is required."
command -v curl >/dev/null || die "curl is required."
command -v python3 >/dev/null || die "python3 is required."

# The kit's installer and xcomm.ps1 come from the branch itself, so it has to
# have the Windows support.
git -C "$REPO_ROOT" fetch -q origin "$BRANCH"
git -C "$REPO_ROOT" cat-file -e "origin/$BRANCH:deploy/windows/xcomm.ps1" 2>/dev/null ||
  die "origin/$BRANCH has no deploy/windows/xcomm.ps1 — build from a branch with the Windows support."

# Windows PowerShell 5.1 reads a script without a byte-order mark as
# Windows-1252, where the last byte of a UTF-8 em dash is a curly quote — and
# PowerShell treats curly quotes as real ones. Keep the Windows scripts ASCII.
for f in install.ps1 install.cmd xcomm.ps1; do
  if git -C "$REPO_ROOT" show "origin/$BRANCH:deploy/windows/$f" | grep -q -P '[^\x00-\x7F]'; then
    die "deploy/windows/$f has non-ASCII characters; Windows PowerShell 5.1 may misread them."
  fi
done

mkdir -p "$OUT/installers"

sha256() { sha256sum "$1" | cut -d' ' -f1; }

# ---- 1. installers ----
step "1/4  Installers (pinned, checksum-verified)"
for entry in "${DOWNLOADS[@]}"; do
  read -r repo tag asset <<<"$entry"
  dest="$OUT/installers/$asset"
  # The digest GitHub records for the release asset.
  want="$(curl -fsSL "https://api.github.com/repos/$repo/releases/tags/$tag" | python3 -c "
import json, sys
a = next((a for a in json.load(sys.stdin)['assets'] if a['name'] == '$asset'), None)
if a is None: sys.exit('no asset $asset in $repo $tag')
print((a.get('digest') or '').removeprefix('sha256:'))")"
  [[ -n $want ]] || die "GitHub lists no SHA-256 for $asset — can't verify it."
  if [[ -f $dest && "$(sha256 "$dest")" == "$want" ]]; then
    echo "  ✓ $asset (already downloaded)"
    continue
  fi
  echo "  … $asset ($repo $tag)"
  curl -fL --retry 3 -o "$dest.partial" "https://github.com/$repo/releases/download/$tag/$asset"
  got="$(sha256 "$dest.partial")"
  [[ $got == "$want" ]] || { rm -f "$dest.partial"; die "$asset: SHA-256 mismatch (got $got, want $want)."; }
  mv "$dest.partial" "$dest"
  echo "  ✓ $asset"
done

# ---- 2. the Podman machine image ----
step "2/4  Podman WSL machine image ($MACHINE_OS:$MACHINE_OS_TAG)"
# The tag is an index with one disk per (architecture, disk type); pick the
# x86_64 WSL one and pin it by digest.
digest="$(podman run --rm "$SKOPEO" inspect --raw "docker://$MACHINE_OS:$MACHINE_OS_TAG" 2>/dev/null | python3 -c "
import json, sys
idx = json.load(sys.stdin)
print(next(m['digest'] for m in idx['manifests']
           if m.get('annotations', {}).get('disktype') == 'wsl'
           and m['platform']['architecture'] in ('x86_64', 'amd64')))")"
layer="$(podman run --rm "$SKOPEO" inspect --raw "docker://$MACHINE_OS@$digest" 2>/dev/null | python3 -c "
import json, sys
m = json.load(sys.stdin)
l = next(l for l in m['layers']
         if l.get('annotations', {}).get('org.opencontainers.image.title') == '$MACHINE_IMAGE_NAME')
print(l['digest'].removeprefix('sha256:'))")"
dest="$OUT/installers/$MACHINE_IMAGE_NAME"
if [[ -f $dest && "$(sha256 "$dest")" == "$layer" ]]; then
  echo "  ✓ $MACHINE_IMAGE_NAME (already downloaded)"
else
  tmp="$(mktemp -d)"
  podman run --rm -v "$tmp:/out:Z" "$SKOPEO" copy -q "docker://$MACHINE_OS@$digest" dir:/out/machine-os
  [[ "$(sha256 "$tmp/machine-os/$layer")" == "$layer" ]] || die "Machine image checksum mismatch."
  mv "$tmp/machine-os/$layer" "$dest"
  rm -rf "$tmp"
  echo "  ✓ $MACHINE_IMAGE_NAME ($digest)"
fi

# ---- 3. the seed: app images + code ----
step "3/4  App images and code from origin/$BRANCH"
"$REPO_ROOT/deploy/bundle/make-seed.sh" "$BRANCH" "$OUT/seed"
REV="$(cat "$OUT/seed/revision")"
for f in install.ps1 install.cmd; do
  git -C "$REPO_ROOT" show "origin/$BRANCH:deploy/windows/$f" > "$OUT/$f"
done
# git show gives the repository's bytes; batch files need CRLF.
sed -i 's/\r*$/\r/' "$OUT/install.cmd"

# ---- 4. README and manifest ----
step "4/4  README and manifest"
cat > "$OUT/README.txt" <<EOF
xcomm_hud - offline install kit for Windows
Built $(date -u +%Y-%m-%dT%H:%MZ) from $BRANCH at $REV.

Needs: 64-bit Windows 10 (2004 or later) or Windows 11, an administrator
account, and hardware virtualization turned on in the BIOS/UEFI (it usually
is). No internet.

To install:
  1. Copy this whole folder to the Windows machine, or run it from a USB drive.
  2. Log in as the account that will run xcomm, and double-click install.cmd.
     Allow it to run as administrator.
  3. If Windows asks to restart (to turn on WSL), let it. Setup carries on by
     itself after you log back in as the same account.

When it finishes, a browser opens xcomm and the window shows the first admin
login. Other machines on the network open http://<this machine's address>/;
the "xcomm status" shortcut on the desktop shows the addresses.

xcomm starts by itself whenever that account logs in. To have it come up
unattended after a power cut, turn on automatic login for that account.

Day to day (PowerShell):
  C:\xcomm\xcomm_hud\deploy\windows\xcomm.ps1 status | start | stop | logs
  C:\xcomm\xcomm_hud\deploy\windows\xcomm.ps1 admin-password

Install log: C:\xcomm\install.log
EOF
sed -i 's/\r*$/\r/' "$OUT/README.txt"
{
  echo "xcomm_hud Windows kit — $BRANCH at $REV"
  echo
  for entry in "${DOWNLOADS[@]}"; do echo "  $entry"; done
  echo "  $MACHINE_OS:$MACHINE_OS_TAG @ $digest"
  echo
  (cd "$OUT" && find . -type f ! -name MANIFEST.txt -print0 | sort -z | xargs -0 sha256sum)
} > "$OUT/MANIFEST.txt"

if (( ZIP )); then
  zip_path="$WIN_DIR/output/xcomm-windows-kit-$REV.zip"
  echo "  … $zip_path"
  python3 - "$OUT" "$zip_path" <<'EOF'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
base = os.path.dirname(src)
# Stored, not deflated: the big files are already compressed.
with zipfile.ZipFile(dst, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
    for root, _, files in os.walk(src):
        for f in files:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, base))
EOF
fi

echo
du -sh "$OUT" | sed 's/^/  /'
echo "✓ Kit: $OUT  ($BRANCH at $REV)"
echo "  Copy the folder to the Windows machine and double-click install.cmd."
