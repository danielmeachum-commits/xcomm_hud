#!/usr/bin/env bash
#
# Write the xcomm disk image to a USB stick. ERASES THE STICK.
#
#   deploy/usb/flash.sh               # list USB disks
#   deploy/usb/flash.sh /dev/sdX      # write deploy/usb/output/image/disk.raw to it
#
# Refuses anything that isn't a whole USB disk, anything holding a mounted
# system path, and anything too small; and makes you type the device name
# back before it writes. Needs sudo.
set -euo pipefail

USB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${XCOMM_USB_IMAGE:-$USB_DIR/output/image/disk.raw}"

die() { echo "✗ $*" >&2; exit 1; }

list_usb() {
  echo "USB disks on this machine:"
  lsblk -dpno NAME,SIZE,TRAN,MODEL | awk '$3 == "usb" { print "  " $0 }' | grep . ||
    echo "  (none — plug the stick in)"
}

DEV="${1:-}"
if [[ -z $DEV ]]; then
  list_usb
  echo
  echo "Then:  $0 /dev/sdX"
  exit 0
fi

[[ -f $IMAGE ]] || die "No disk image at $IMAGE — run deploy/usb/build.sh first."
[[ -b $DEV ]] || die "$DEV is not a block device."

# Key=value output: plain columns shift when a field (like TRAN) is empty.
eval "$(lsblk -dnbPo TYPE,TRAN,SIZE "$DEV")"
type="$TYPE" tran="$TRAN" size="$SIZE"
model="$(lsblk -dno MODEL "$DEV" | xargs)"
[[ $type == disk ]] || die "$DEV is a $type, not a whole disk — give the disk (/dev/sdX), not a partition."
[[ $tran == usb ]] || die "$DEV is not a USB disk (transport: ${tran:-none}). Refusing."

# Never the disk this machine is running from.
while read -r mp; do
  case "$mp" in
    /|/boot|/boot/efi|/home|/usr|/var) die "$DEV holds $mp — that's this machine's system disk." ;;
  esac
done < <(lsblk -nrpo MOUNTPOINT "$DEV" | grep .)

need="$(stat -c %s "$IMAGE")"
(( size >= need )) || die "$DEV is $(numfmt --to=iec "$size"); the image needs $(numfmt --to=iec "$need")."

echo "About to ERASE and write:"
echo "  $DEV  $(numfmt --to=iec "$size")  ${model:-unknown model}"
lsblk -pno NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$DEV" | sed 's/^/    /'
echo
read -rp "Type the device name ($DEV) to continue: " confirm
[[ $confirm == "$DEV" ]] || die "Didn't match — nothing written."

# Unmount anything the desktop auto-mounted from the stick.
while read -r part mp; do
  [[ -n $mp ]] && sudo umount "$part"
done < <(lsblk -nrpo NAME,MOUNTPOINT "$DEV" | awk 'NF == 2')

echo "Writing $(numfmt --to=iec "$need") (sparse, so mostly the used part)…"
# conv=sparse skips the image's empty regions, which is most of the 40 GiB
# root partition — the write takes minutes, not an hour.
sudo dd if="$IMAGE" of="$DEV" bs=4M conv=sparse,fsync status=progress

# The image's GPT backup header sits at the end of the IMAGE, not the stick.
# Move it to the real end so partitioning tools don't complain.
if command -v sgdisk >/dev/null; then
  sudo sgdisk -e "$DEV" >/dev/null 2>&1 || true
fi
sync

echo "✓ Done. Boot a laptop from $DEV (usually F12, F9 or Esc at power-on for the boot menu)."
