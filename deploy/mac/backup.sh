#!/bin/bash
# Nightly backup for the Mac install: the ezbiz database and the uploads
# folder, kept for 14 days. Run by the com.ezbiz.backup launch agent.
#
#   EZBIZ_BACKUP_DIR        where backups go            (default ~/ezbiz-backups)
#   EZBIZ_BACKUP_COPY_DIR   optional second copy, for example an external
#                           drive. Skipped with a note when it is not there.
#   EZBIZ_BACKUP_KEEP_DAYS  days to keep                (default 14)
set -euo pipefail

BACKUP_DIR="${EZBIZ_BACKUP_DIR:-$HOME/ezbiz-backups}"
COPY_DIR="${EZBIZ_BACKUP_COPY_DIR:-}"
KEEP_DAYS="${EZBIZ_BACKUP_KEEP_DAYS:-14}"
UPLOADS_DIR="${EZBIZ_UPLOADS_DIR:-$HOME/ezbiz/apps/portal/uploads}"
DB_NAME="${EZBIZ_DB_NAME:-ezbiz}"
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"

stamp="$(date +%Y-%m-%d_%H%M%S)"
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

db_file="$BACKUP_DIR/ezbiz-db_$stamp.dump"
up_file="$BACKUP_DIR/ezbiz-uploads_$stamp.tar.gz"

# Write to a .part name first, so a backup that was cut short never looks whole.
"$PG_BIN/pg_dump" --format=custom --no-owner --dbname="$DB_NAME" --file="$db_file.part"
# A dump that cannot be listed is not a backup.
"$PG_BIN/pg_restore" --list "$db_file.part" >/dev/null
mv "$db_file.part" "$db_file"
say "database: $db_file ($(du -h "$db_file" | cut -f1))"

if [ -d "$UPLOADS_DIR" ]; then
  tar -czf "$up_file.part" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  mv "$up_file.part" "$up_file"
  say "uploads:  $up_file ($(du -h "$up_file" | cut -f1))"
else
  say "uploads:  no folder at $UPLOADS_DIR, skipped"
fi

if [ -n "$COPY_DIR" ]; then
  if [ -d "$COPY_DIR" ]; then
    cp -p "$db_file" "$COPY_DIR/"
    if [ -f "$up_file" ]; then cp -p "$up_file" "$COPY_DIR/"; fi
    find "$COPY_DIR" -maxdepth 1 -type f -name 'ezbiz-*' -mtime +"$KEEP_DAYS" -delete
    say "copy:     $COPY_DIR"
  else
    say "copy:     $COPY_DIR is not there (drive unplugged?), skipped"
  fi
fi

# Only this script's own files, only in the backup folder.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'ezbiz-db_*.dump' -o -name 'ezbiz-uploads_*.tar.gz' -o -name '*.part' \) -mtime +"$KEEP_DAYS" -delete
say "done. $(find "$BACKUP_DIR" -maxdepth 1 -name 'ezbiz-db_*.dump' | wc -l | tr -d ' ') database backups on hand."
