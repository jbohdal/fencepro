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
- Dev and tests never send: outbound gate + scrubbed refresh. Pushes, email,
  texts, calendar writes and webhooks go out only from the live install
  (`lib/outboundGate.ts`; elsewhere they land in `apps/portal/logs/dev-outbox.log`),
  and every refresh of `ezbiz_dev` is scrubbed (fake emails and phones, no
  live sign ins). Dev logins are `<login>@example.invalid`.

Details and what enforces this: GO_LIVE.md, section 15.

## Hard rule: ask before reading anything personal

Never read Jonathan's personal files, browser history or profiles, email,
messages, or anything outside this project folder and the app's own data
(the dev and live databases, the app's logs in ~/.pm2/logs, its backups in
~/ezbiz-backups, and the reference files he named for the work) without
asking him first and getting his OK for that specific thing. This applies to
every agent and script. If an investigation needs it, stop and ask; say what
you want to read and why. (Set by Jonathan on Oct 20, 2026, after an agent
read a copy of his Chrome Beta history while tracing a Settings change.)

## Hard rule: done means used for real, start to finish

Jonathan does not have time to test the work, so:
- A feature is done only after it has been used for its real purpose, start
  to finish, as the real user (owner, office, salesman or installer), on a
  phone where that is how it is used, with realistic data, through every step
  before and after it (how you get to it, and what happens next). Passing
  tests is required but not enough.
- The builder runs the tests that cover the change and does that real use
  before deploying. For money, contracts, customer facing pages and live data
  changes, a separate reviewer agent that did not build it also does the real
  use, reports anything confusing, slow, missing or broken, and it is fixed
  before Jonathan is told it is done. (Changed by Jonathan on Oct 30, 2026.)
- Ask Jonathan to look only when it touches money, contracts or what
  customers see, and then give him one specific 1 minute check, not a list.
- Reports say what the reviewer did and found, in plain words. No recordings
  unless he asks.
- Through Oct 31, 2026: make existing features work end to end before
  building anything new, unless he says otherwise.
- After every big round, rerun the full workflow walkthrough (an independent
  agent, on a copy of live data, each step as the right person) and report a
  short ranked list of gaps, worst first, with who it affects and how often.
(Set by Jonathan on Oct 24, 2026.)
