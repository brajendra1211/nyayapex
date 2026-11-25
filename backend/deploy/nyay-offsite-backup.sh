#!/bin/bash
# Nightly, after the local backup (cron 02:30): encrypt today's backup with gpg (AES-256) and copy it off this server.
# Restore: gpg -d FILE.gpg > FILE   (passphrase from /root/.nyay-backup-pass, which must also be kept offline)
set -euo pipefail
ENV=/root/.nyay-offsite.env
PASS=/root/.nyay-backup-pass
SRC=/home/nyayapex/backups
APP=/home/nyayapex/app/backend
OUT=/root/offsite-staging
DAY=$(date +%F)

[ -f "$ENV" ] || { echo "$(date '+%F %T') off-site backup not configured ($ENV missing)"; exit 0; }
set -a; . "$ENV"; set +a
[ -s "$PASS" ] || { echo "missing $PASS"; exit 1; }

mkdir -p "$OUT"; chmod 700 "$OUT"; rm -f "$OUT"/*
files=()
for f in "$SRC/nyay-$DAY.dump" "$SRC/uploads-$DAY.tgz" "$APP/.env"; do
  [ -f "$f" ] || { echo "missing $f"; exit 1; }
  name=$(basename "$f"); [ "$name" = ".env" ] && name="backend-env-$DAY"
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASS" --symmetric --cipher-algo AES256 \
      -o "$OUT/$name.gpg" "$f"
  files+=("$OUT/$name.gpg")
done
cd "$APP"
"$APP/.venv/bin/python" -m app.offsite upload "${files[@]}"
rm -f "$OUT"/*
echo "$(date '+%F %T') off-site backup done"
