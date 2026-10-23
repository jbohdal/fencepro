/**
 * A real sign in session on the PRACTICE database, for the browser tests.
 *
 *   cd apps/portal && npx tsx scripts/dev-session-token.ts --out <file> [--email you@x.com] [--days 7]
 *   cd apps/portal && npx tsx scripts/dev-session-token.ts --cookie --out <file> [--email you@x.com] [--days 7]
 *
 * --cookie: a cookie sign in instead (lib/staffSession.ts): writes the value
 * of the `ezbiz_staff` cookie, for E2E_STAFF_COOKIE (e2e/lib.mjs
 * signInByCookie). That is how the browser tests sign in once the old token
 * is switched off (stage D). Without it: the old access token (E2E_ACCESS_TOKEN),
 * which the app moves over to a cookie on its first load.
 *
 * Makes a CrmUserSession row on ezbiz_dev (its refresh token is random and
 * thrown away) and writes an access token that names it (`sid`, see
 * src/server/lib/sessionGuard.ts) to <file>, or prints it when no --out is
 * given. Use it as E2E_ACCESS_TOKEN. Signing that session out in Settings >
 * Team, or deleting the row, stops the token at once.
 *
 * Refuses unless DATABASE_URL names ezbiz_dev, NODE_ENV is not production and
 * this is not the live install. Never use it against live.
 */

import 'dotenv/config'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { liveDatabaseMisuse, databaseNameOf } from '../src/server/lib/liveGuard.js'
import { resolveSecret } from '../src/server/lib/secrets.js'
import { cookieHash } from '../src/server/lib/staffSession.js'

const argv = process.argv.slice(2)
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

const db = databaseNameOf(process.env.DATABASE_URL)
const misuse = liveDatabaseMisuse(process.env.DATABASE_URL, process.cwd())
if (db !== 'ezbiz_dev' || process.env.NODE_ENV === 'production' || misuse) {
  console.error(`Refusing: this makes a sign in for the practice database only (DATABASE_URL must name ezbiz_dev, not "${db || 'nothing'}"; NODE_ENV must not be production).${misuse ? ' ' + misuse : ''}`)
  process.exit(2)
}

const days = Math.min(30, Math.max(1, Number(opt('days') ?? 7) || 7))
const email = opt('email')
const out = opt('out')

async function main() {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  try {
    const user = email
      ? await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
      : await prisma.crmUser.findFirst({ where: { role: 'super_admin', status: 'active' }, orderBy: { createdAt: 'asc' } })
    if (!user || user.status === 'deactivated') { console.error(`No active login${email ? ` for ${email}` : ' with the owner role'} on ezbiz_dev.`); process.exit(1) }
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    if (argv.includes('--cookie')) {
      const value = crypto.randomBytes(32).toString('base64url')
      const s = await prisma.crmUserSession.create({ data: { userId: user.id, tokenHash: cookieHash(value), kind: 'cookie', lastUsedAt: new Date(), ipAddress: '127.0.0.1', userAgent: 'dev-session-token --cookie (browser tests)', expiresAt } })
      if (out) { fs.writeFileSync(out, value + '\n', { mode: 0o600 }); console.log(`Wrote a ${days} day dev cookie sign in for ${user.email} (session ${s.id.slice(0, 8)}) to ${out}.`) }
      else console.log(value)
      return
    }
    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: await bcrypt.hash(crypto.randomBytes(40).toString('hex'), 10),
        ipAddress: '127.0.0.1',
        userAgent: 'dev-session-token (browser tests)',
        expiresAt,
      },
    })
    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: user.crmAccountId, sid: session.id },
      resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'),
      { expiresIn: `${days}d` },
    )
    if (out) {
      fs.writeFileSync(out, token + '\n', { mode: 0o600 })
      console.log(`Wrote a ${days} day dev token for ${user.email} (session ${session.id.slice(0, 8)}) to ${out}.`)
    } else {
      console.log(token)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
