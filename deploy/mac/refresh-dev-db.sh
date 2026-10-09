#!/bin/bash
# Refill the dev database (ezbiz_dev) with a fresh copy of live (ezbiz).
#
# The working folder in Downloads uses ezbiz_dev so nothing run there can
# touch live. This throws away whatever is in ezbiz_dev and copies live in
# again. Live is only read. Run it whenever you want fresh practice data:
#
#   bash deploy/mac/refresh-dev-db.sh
#
# Stop the dev server first if it is running.
set -euo pipefail

PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
LIVE_DB="ezbiz"
DEV_DB="ezbiz_dev"
DEV_ROLE="ezbiz_dev"

if [ "$DEV_DB" = "$LIVE_DB" ]; then echo "Refusing: the dev database must not be the live one." >&2; exit 1; fi
if ! "$PG_BIN/psql" -d postgres -Atc "select 1 from pg_roles where rolname = '$DEV_ROLE'" | grep -q 1; then
  echo "The login $DEV_ROLE does not exist. See GO_LIVE.md, \"Live and dev are separate\"." >&2; exit 1
fi

dump="$(mktemp -t ezbiz-dev-refresh)"
trap 'rm -f "$dump"' EXIT

"$PG_BIN/pg_dump" --format=custom --no-owner --no-privileges --dbname="$LIVE_DB" --file="$dump"
"$PG_BIN/dropdb" --if-exists "$DEV_DB"
"$PG_BIN/createdb" --owner="$DEV_ROLE" "$DEV_DB"
"$PG_BIN/psql" -q -d postgres -c "revoke connect on database $DEV_DB from public"
"$PG_BIN/pg_restore" --no-owner --no-privileges --role="$DEV_ROLE" --dbname="$DEV_DB" "$dump"

echo "$DEV_DB now holds a copy of $LIVE_DB taken $(date '+%Y-%m-%d %H:%M')."
echo "Customers: $("$PG_BIN/psql" -d "$DEV_DB" -Atc 'select count(*) from "CrmContact"')"
