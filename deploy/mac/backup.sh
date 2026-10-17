#!/bin/bash
# Nightly backup for the Mac install: the ezbiz database and the uploads
# folder (photos, video, files), kept for 14 days. Run by the
# com.ezbiz.backup launch agent.
#
# Uploads are kept as daily snapshots made with rsync --link-dest: each night
# copies only what is new, and a photo or video that has not changed is a hard
# link to the same file, so 14 days of snapshots cost about one copy of the
# folder plus what changed. Each snapshot folder is a complete copy to restore
# from.
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
snap_root="$BACKUP_DIR/uploads-snapshots"

# Write to a .part name first, so a backup that was cut short never looks whole.
"$PG_BIN/pg_dump" --format=custom --no-owner --dbname="$DB_NAME" --file="$db_file.part"
# A dump that cannot be listed is not a backup.
"$PG_BIN/pg_restore" --list "$db_file.part" >/dev/null
mv "$db_file.part" "$db_file"
say "database: $db_file ($(du -h "$db_file" | cut -f1))"
# Tell the server a backup succeeded (its nightly check reads this; without it
# the log says "no successful backup" every day although the files are here).
"$PG_BIN/psql" -q -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "insert into \"BackupLog\" (id, \"backupType\", \"filePath\", \"fileSizeBytes\", status, \"startedAt\", \"completedAt\") values (gen_random_uuid()::text, '${EZBIZ_BACKUP_TYPE:-daily}', '$db_file', $(stat -f %z "$db_file"), 'success', now(), now())" \
  || say "database: backup is fine, but it could not be recorded for the server's nightly check"

snap=""
if [ -d "$UPLOADS_DIR" ]; then
  mkdir -p "$snap_root"
  snap="$snap_root/$stamp"
  link=()
  if [ -d "$snap_root/latest" ]; then link=(--link-dest="$snap_root/latest/"); fi
  # Leave out uploads still arriving from a phone; they are whole once finished.
  rsync -a --exclude 'media/incoming/' ${link[@]+"${link[@]}"} "$UPLOADS_DIR/" "$snap.part/"
  mv "$snap.part" "$snap"
  ln -sfn "$snap" "$snap_root/latest"
  say "uploads:  $snap ($(du -sh "$snap" | cut -f1) as a folder; new space used today: $(du -sh "$snap_root" | cut -f1) for all snapshots)"
else
  say "uploads:  no folder at $UPLOADS_DIR, skipped"
fi

if [ -n "$COPY_DIR" ]; then
  if [ -d "$COPY_DIR" ]; then
    cp -p "$db_file" "$COPY_DIR/"
    # Uploads: kept the same as tonight's snapshot (new and changed files only).
    if [ -n "$snap" ]; then rsync -a "$snap/" "$COPY_DIR/ezbiz-uploads/"; fi
    find "$COPY_DIR" -maxdepth 1 -type f -name 'ezbiz-*' -mtime +"$KEEP_DAYS" -delete
    say "copy:     $COPY_DIR"
  else
    say "copy:     $COPY_DIR is not there (drive unplugged?), skipped"
  fi
fi

# Only this script's own files, only in the backup folder.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'ezbiz-db_*.dump' -o -name 'ezbiz-uploads_*.tar.gz' -o -name '*.part' \) -mtime +"$KEEP_DAYS" -delete
if [ -d "$snap_root" ]; then
  find "$snap_root" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
  find "$snap_root" -mindepth 1 -maxdepth 1 -type d -name '*.part' -exec rm -rf {} +
fi
say "done. $(find "$BACKUP_DIR" -maxdepth 1 -name 'ezbiz-db_*.dump' | wc -l | tr -d ' ') database backups on hand."
