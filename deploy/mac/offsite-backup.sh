#!/bin/bash
# Off site copy of the database backup: the newest ezbiz-db_*.dump goes to
# Google Drive (free 15 GB) with rclone, and only the newest 30 are kept
# there. Run by backup.sh after every backup. Until the Google sign in has
# been done once (rclone config, remote "gdrive"), it skips with a note.
#
#   EZBIZ_OFFSITE_REMOTE   where on Drive   (default "gdrive:EZ Biz backups")
#   EZBIZ_OFFSITE_KEEP     how many to keep (default 30)
set -euo pipefail

BACKUP_DIR="${EZBIZ_BACKUP_DIR:-$HOME/ezbiz-backups}"
REMOTE="${EZBIZ_OFFSITE_REMOTE:-gdrive:EZ Biz backups}"
KEEP="${EZBIZ_OFFSITE_KEEP:-30}"
DB_NAME="${EZBIZ_DB_NAME:-ezbiz}"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
RCLONE="$(command -v rclone || echo /opt/homebrew/bin/rclone)"
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') offsite: $*"; }
trap 'say "FAILED (exit $?): the Google Drive copy did not finish"' ERR

if [ ! -x "$RCLONE" ]; then say "rclone is not installed, skipped"; exit 0; fi
if ! "$RCLONE" listremotes | grep -qx "${REMOTE%%:*}:"; then say "Google Drive is not connected yet (rclone remote ${REMOTE%%:*}), skipped"; exit 0; fi

latest="$(ls -t "$BACKUP_DIR"/ezbiz-db_*.dump 2>/dev/null | head -1 || true)"
if [ -z "$latest" ]; then say "no database backup to copy"; exit 1; fi

# Google Drive answers 500 now and then (Oct 21, 10:28 and 10:32): retry with pauses.
RETRY=(--retries 5 --retries-sleep 20s --low-level-retries 10)
"$RCLONE" copy "$latest" "$REMOTE" --checksum "${RETRY[@]}"
say "copied $(basename "$latest") to $REMOTE"

# Keep the newest $KEEP (the names carry the date and time, so name order is age order).
old="$("$RCLONE" lsf "$REMOTE" --files-only --include 'ezbiz-db_*.dump' | sort | awk -v keep="$KEEP" '{ a[NR] = $0 } END { for (i = 1; i <= NR - keep; i++) print a[i] }')"
if [ -n "$old" ]; then
  while IFS= read -r f; do "$RCLONE" deletefile "$REMOTE/$f" --low-level-retries 10; done <<< "$old"
  say "removed $(printf '%s\n' "$old" | wc -l | tr -d ' ') older copies, keeping $KEEP"
fi

# Recorded for the app (Settings and the Finish setup card read it).
"$PG_BIN/psql" -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "insert into \"BackupLog\" (id, \"backupType\", \"filePath\", \"remoteUrl\", \"fileSizeBytes\", status, \"startedAt\", \"completedAt\") values (gen_random_uuid()::text, 'offsite', '$latest', '$REMOTE/$(basename "$latest")', $(stat -f %z "$latest"), 'success', now() at time zone 'utc', now() at time zone 'utc')" \
  || say "copied, but it could not be recorded for the app"
