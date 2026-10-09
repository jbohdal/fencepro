# CLAUDE.md (EZ Biz repo)

Read GO_LIVE.md before doing anything that touches a database or a server.

## Hard rule: only ~/ezbiz uses the live database

- Live is the install in `~/ezbiz`: database `ezbiz`, login `ezbiz`, port 4000.
- Every other copy of this code, including the working folder in Downloads,
  uses the dev database `ezbiz_dev` (login `ezbiz_dev`, port 4001). It is a
  practice copy of live and can be thrown away.
- Never copy `~/ezbiz/apps/portal/.env` anywhere, and never put the `ezbiz`
  database, the `ezbiz` login or port 4000 into the working folder's settings.
- Before running anything that touches a database from the working folder
  (`prisma db push`, a migration, a seed, a script, the server), confirm that
  `DATABASE_URL` in `apps/portal/.env` names `ezbiz_dev`.
- `psql` and `pg_dump` run as the Mac user can open either database. Name the
  database on every command. `-d ezbiz` is a deliberate act on live: take a
  backup first (`bash ~/ezbiz/deploy/mac/backup.sh`), show the owner the plan,
  and wait for the OK.
- Code and schema changes reach live only by: commit in the working folder,
  push `main`, then `bash ~/ezbiz/deploy/mac/update.sh`.
- The dev database holds real customer contact details. Keep email, text and
  other outside service settings empty in the working folder.
- Refresh the practice data with `bash deploy/mac/refresh-dev-db.sh`.

Details and what enforces this: GO_LIVE.md, section 15.
