/**
 * Send Jonathan a message from Code: saved under "Messages from Code" in the
 * app, and its one line title pushed to the OWNER's phone only (never another
 * admin, the office, a Salesman or an Installer). Tapping the push opens the
 * message in the app. See lib/codeMessages.ts.
 *
 *   cd ~/ezbiz/apps/portal && pnpm exec tsx scripts/code-message.ts --kind live --title "Live: Messages from Code"
 *   ... --kind live|needs_answer|failed|info   required
 *   ... --title "one line"                     required: what the push says
 *   ... --body "text"                          the details (plain text or simple markdown)
 *   ... --body-file path                       the details from a file (instead of --body)
 *   ... --no-push                              save it only, no push
 *   ... --account <id>                         the company (needed only when there is more than one)
 *
 * When to send which (Jonathan, Oct 30 2026):
 *   live          after a deploy is confirmed up (update.sh said "EZ Biz is up"): what is live, one line.
 *   needs_answer  something needs his answer or OK: one line saying what, the details in --body(-file).
 *   failed        a deploy or a live data change failed.
 *   info          anything else worth a note.
 *
 * Works without the server: straight to the database (DATABASE_URL from the
 * .env of the folder it is run from) and the phone push sender. Only the live
 * install (~/ezbiz, live database, NODE_ENV=production) reaches the phone (the
 * outbound gate, lib/outboundGate.ts); run anywhere else, the message is saved
 * in that copy's database and the push is written to the dev outbox
 * (apps/portal/logs/dev-outbox.log), never sent. Refuses the live database
 * from any folder but ~/ezbiz. Prints what it did and how many phones got the
 * push; exits 1 when it could not save, 3 when it saved but no phone got the
 * push on the live install.
 */

import 'dotenv/config'
import fs from 'fs'
import { liveDatabaseMisuse, databaseNameOf } from '../src/server/lib/liveGuard.js'
import { outboundBlockReason } from '../src/server/lib/outboundGate.js'

const USAGE = 'Usage: pnpm exec tsx scripts/code-message.ts --kind live|needs_answer|failed|info --title "one line" [--body "text" | --body-file path] [--no-push] [--account <id>]'

export interface CodeMessageArgs { kind: string; title: string; body: string; push: boolean; account: string | null }

/** Read the command line. Throws a plain message when something is missing or wrong. */
export function parseCodeMessageArgs(argv: string[], readFile: (p: string) => string = p => fs.readFileSync(p, 'utf8')): CodeMessageArgs {
  const out: CodeMessageArgs = { kind: '', title: '', body: '', push: true, account: null }
  let bodyFile: string | null = null
  let bodyGiven = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value.\n${USAGE}`)
      return v
    }
    if (a === '--kind') out.kind = val()
    else if (a === '--title') out.title = val()
    else if (a === '--body') { out.body = val(); bodyGiven = true }
    else if (a === '--body-file') bodyFile = val()
    else if (a === '--no-push') out.push = false
    else if (a === '--account') out.account = val()
    else if (a === '--help' || a === '-h') throw new Error(USAGE)
    else throw new Error(`Unknown option "${a}".\n${USAGE}`)
  }
  if (bodyFile && bodyGiven) throw new Error(`Give --body or --body-file, not both.\n${USAGE}`)
  if (bodyFile) out.body = readFile(bodyFile)
  if (!['live', 'needs_answer', 'failed', 'info'].includes(out.kind)) throw new Error(`--kind must be live, needs_answer, failed or info.\n${USAGE}`)
  if (!out.title.trim()) throw new Error(`--title is required (one line: what the push says).\n${USAGE}`)
  return out
}

async function main() {
  let args: CodeMessageArgs
  try { args = parseCodeMessageArgs(process.argv.slice(2)) } catch (err) { console.error((err as Error).message); process.exit(2) }
  const misuse = liveDatabaseMisuse(process.env.DATABASE_URL, process.cwd())
  if (misuse) { console.error(misuse); process.exit(2) }

  // Loaded after the checks above, so nothing opens the database before them.
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { createCodeMessage, codeMessagePath } = await import('../src/server/lib/codeMessages.js')
  try {
    let accountId = args.account
    if (!accountId) {
      // The company with staff logins; more than one: say which with --account.
      const accounts = await prisma.crmUser.groupBy({ by: ['crmAccountId'], where: { crmAccountId: { not: null } } })
      const ids = accounts.map(a => a.crmAccountId).filter((x): x is string => !!x)
      if (ids.length !== 1) { console.error(ids.length ? `More than one company here; say which with --account (${ids.join(', ')}).` : 'No company with staff logins in this database.'); process.exit(2) }
      accountId = ids[0]
    }
    const saved = await createCodeMessage(accountId, { kind: args.kind as any, title: args.title, body: args.body }, { push: args.push })
    const gate = outboundBlockReason()
    console.log(`Saved message ${saved.id} in database "${databaseNameOf(process.env.DATABASE_URL) || '?'}" (${args.kind}): ${args.title.replace(/\s+/g, ' ').trim()}`)
    console.log(`Opens in the app at ${codeMessagePath(saved.id)}`)
    if (!saved.push) { console.log('No push (--no-push).'); return }
    const p = saved.push
    console.log(`Push to the owner only (${saved.ownerIds.length} owner login${saved.ownerIds.length === 1 ? '' : 's'}, ${p.subscribers} phone${p.subscribers === 1 ? '' : 's'}): sent ${p.sent}, held ${p.held}, failed ${p.failed}, removed ${p.removed}.`)
    if (gate) console.log(`Not sent to a phone: ${gate}. Written to the dev outbox instead.`)
    for (const e of p.errors) console.log(`  ${e}`)
    if (!gate && p.sent === 0) { console.error('No phone got the push. On the owner\'s phone, open EZ Biz > Automations and tap Turn on push.'); process.exitCode = 3 }
  } finally {
    await prisma.$disconnect()
  }
}

// Run only when started as a script (the tests import parseCodeMessageArgs).
if (process.argv[1] && /code-message\.ts$/.test(process.argv[1])) {
  main().catch(err => { console.error('Could not save the message:', (err as Error).message); process.exit(1) })
}
