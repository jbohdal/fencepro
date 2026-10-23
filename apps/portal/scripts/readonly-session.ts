/**
 * A 3 hour, read only sign in for the Mac's own checks (the read only live
 * checker, apps/web/e2e/live-readonly.mjs). Jonathan's answer 6 of the sign in
 * plan (Oct 20, 2026): "yes, Mac only, 3 hours, shown in Settings > Team".
 *
 *   cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts [--email you@x.com] [--out <file>]
 *   cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts --end      # end every read only sign in now
 *
 * Makes a CrmUserSession row of kind 'readonly' (label "Read only checker on
 * the Mac") that ends 3 hours from now, and writes its cookie value to <file>
 * (default ~/.ezbiz-readonly-session, readable by this Mac user only). The
 * value is never printed. The server keeps only its SHA-256.
 *
 * What the server does with it (lib/staffSession.ts):
 *   - every request that is not a read (GET or HEAD) is refused (403 READ_ONLY);
 *   - it is refused (401 READ_ONLY_NOT_HERE) unless the request is made on the
 *     Mac itself straight to the server: from one of the Mac's own addresses
 *     (localhost, or its own Tailscale address), with no proxy in between
 *     (Tailscale serve and Funnel add forwarding headers and keep the public
 *     name in Host) and Host naming the Mac. From a phone, another computer, or
 *     through https://jonathans-mac-mini...ts.net it does not work;
 *   - it shows in Settings > Team > sessions with its end time, and can be
 *     ended there like any other sign in.
 *
 * Only this script makes one: there is no web route for it, so making one
 * needs a login on the Mac and the database (the settings file's DATABASE_URL).
 * It refuses to run anywhere but macOS, and the start up guard (liveGuard.ts)
 * refuses the live database outside ~/ezbiz.
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { liveDatabaseMisuse, databaseNameOf } from '../src/server/lib/liveGuard.js'
import { cookieHash, READONLY_HOURS } from '../src/server/lib/staffSession.js'

const argv = process.argv.slice(2)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const LABEL = 'Read only checker on the Mac'

if (process.platform !== 'darwin') { console.error('Refusing: a read only sign in is made on the Mac only.'); process.exit(2) }
const misuse = liveDatabaseMisuse(process.env.DATABASE_URL, process.cwd())
if (misuse) { console.error(`Refusing: ${misuse}`); process.exit(2) }

async function main() {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  try {
    const db = databaseNameOf(process.env.DATABASE_URL)
    if (argv.includes('--end')) {
      const r = await prisma.crmUserSession.updateMany({ where: { kind: 'readonly', revokedAt: null }, data: { revokedAt: new Date() } })
      console.log(`Ended ${r.count} read only sign in${r.count === 1 ? '' : 's'} on ${db}.`)
      return
    }
    const email = opt('email')
    const user = email
      ? await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
      : await prisma.crmUser.findFirst({ where: { role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } })
    if (!user || user.status !== 'active') { console.error(`No active login${email ? ` for ${email}` : ' with the owner role'} on ${db}.`); process.exit(1) }
    const value = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + READONLY_HOURS * 3600_000)
    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id, tokenHash: cookieHash(value), kind: 'readonly', readOnly: true, label: LABEL,
        ipAddress: '127.0.0.1', userAgent: `readonly-session (${os.hostname()})`, expiresAt, lastUsedAt: new Date(),
      },
    })
    const out = path.resolve(opt('out') ?? path.join(os.homedir(), '.ezbiz-readonly-session'))
    fs.writeFileSync(out, value + '\n', { mode: 0o600 })
    fs.chmodSync(out, 0o600)
    console.log(`Read only sign in for ${user.email} on ${db} (session ${session.id.slice(0, 8)}), ends ${expiresAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}.`)
    console.log(`Its cookie is in ${out} (this Mac user only). It shows in Settings > Team; end it there or with --end.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
