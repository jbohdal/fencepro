/**
 * Create (or recover) the owner login on a database.
 *
 * A fresh production database has no users, and the demo seed is not meant
 * for production. This makes the one login you need to get in, linked to the
 * company so every module works.
 *
 *   pnpm --filter ezbiz-portal exec tsx scripts/create-owner.ts \
 *     you@example.com 'a long password' 'First Last' ['Company Name']
 *
 * If the email already exists nothing is changed unless you add --reset, which
 * sets the new password, reactivates the login, clears any lockout and signs
 * every device out. Use that if you are ever locked out.
 */

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import prisma from '../src/server/lib/prisma.js'

async function main() {
  const args = process.argv.slice(2)
  const reset = args.includes('--reset')
  const [emailArg, password, fullName, companyArg] = args.filter(a => a !== '--reset')

  if (!emailArg || !password || !fullName) {
    console.error("Usage: tsx scripts/create-owner.ts <email> <password> '<First Last>' ['Company Name'] [--reset]")
    process.exit(1)
  }
  const email = emailArg.toLowerCase().trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('That does not look like an email address.'); process.exit(1) }
  if (password.length < 10) { console.error('Use a password of at least 10 characters.'); process.exit(1) }

  const [firstName, ...rest] = fullName.trim().split(/\s+/)
  const lastName = rest.join(' ')

  // One company per install: reuse it if it exists, otherwise create it.
  let account = await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!account) {
    account = await prisma.crmAccount.create({
      data: { name: companyArg || process.env.COMPANY_NAME || 'My Company', status: 'active' },
    })
    console.log(`Created company: ${account.name}`)
  } else {
    console.log(`Using company: ${account.name}`)
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const existing = await prisma.crmUser.findUnique({ where: { email } })

  if (existing && !reset) {
    console.error(`A login for ${email} already exists. Nothing was changed. Add --reset to set a new password on it.`)
    process.exit(1)
  }

  if (existing) {
    await prisma.crmUser.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        status: 'active',
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        crmAccountId: existing.crmAccountId ?? account.id,
      },
    })
    await prisma.crmUserSession.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } })
    console.log(`Password reset for ${email}. Every device was signed out.`)
  } else {
    await prisma.crmUser.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'super_admin',
        status: 'active',
        mustChangePassword: false,
        crmAccountId: account.id,
      },
    })
    console.log(`Owner login created: ${email}`)
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
