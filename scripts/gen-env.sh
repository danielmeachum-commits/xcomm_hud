#!/usr/bin/env bash
#
# Write an env file from .env.example with freshly generated secrets.
# Never overwrites an existing file, so it is safe to call on every setup.
#
# Usage:
#   ./scripts/gen-env.sh <path>          # dev: random DB password + secret key
#   ./scripts/gen-env.sh <path> --prod   # also randomizes admin + MinIO creds
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:?usage: gen-env.sh <path> [--prod]}"
PROD=0
[[ "${2:-}" == "--prod" ]] && PROD=1

token() { python3 -c 'import secrets;print(secrets.token_urlsafe(24))'; }
secret_key() {
  python3 -c 'import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
}

if [[ -e "$TARGET" ]]; then
  # Existing file: leave every value alone, but add keys introduced since it
  # was written (an install predating them would otherwise fail without them).
  if ! grep -q '^XCOMM_HUD_ID_KEY=.' "$TARGET"; then
    sed -i '/^XCOMM_HUD_ID_KEY=$/d' "$TARGET"
    printf '\n# DoD ID hashing key (CAC check-in). Back it up with this file.\nXCOMM_HUD_ID_KEY=%s\n' "$(secret_key)" >> "$TARGET"
    echo "✓ added XCOMM_HUD_ID_KEY to $TARGET"
  fi
  echo "✓ $TARGET already exists (other values left as is)"
  exit 0
fi

# Generated values are base64url, so they never contain the '|' delimiter.
subs=(
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(token)|"
  -e "s|^XCOMM_HUD_SECRET_KEY=.*|XCOMM_HUD_SECRET_KEY=$(secret_key)|"
  -e "s|^XCOMM_HUD_ID_KEY=.*|XCOMM_HUD_ID_KEY=$(secret_key)|"
)
if (( PROD )); then
  s3_key="xcomm-$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
  s3_secret="$(token)"
  subs+=(
    -e "s|^XCOMM_HUD_INITIAL_ADMIN_PASSWORD=.*|XCOMM_HUD_INITIAL_ADMIN_PASSWORD=$(token)|"
    -e "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$s3_key|"
    -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$s3_secret|"
  )
fi

mkdir -p "$(dirname "$TARGET")"
umask 077
sed "${subs[@]}" "$REPO_ROOT/.env.example" > "$TARGET"

if (( PROD )); then
  # Quadlet can't interpolate one variable into another, so the MinIO
  # container gets its root credentials under its own names.
  cat >> "$TARGET" <<EOF

# MinIO server credentials — must match S3_ACCESS_KEY / S3_SECRET_KEY above.
MINIO_ROOT_USER=$s3_key
MINIO_ROOT_PASSWORD=$s3_secret
EOF
fi

echo "✓ wrote $TARGET with generated secrets"
