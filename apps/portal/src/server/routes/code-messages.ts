/**
 * Messages from Code, at /api/code-messages (lib/codeMessages.ts). The owner's
 * alone: the owner as lib/salesmanChoice.ts isOwnerLogin finds him. Anyone
 * else (another admin, the office, a Salesman, an Installer) gets a 403 on
 * every route but /status.
 *
 *   GET  /status        any signed in staff: { owner, unread }. owner false
 *                       (and unread 0) for anyone but the owner: the app shows
 *                       the menu line and its badge only when owner is true.
 *   GET  /              owner: the messages, newest first (the first 200
 *                       characters of each one's details)
 *   GET  /:id           owner: one message with all its details
 *   POST /:id/read      owner: marks it read (the first open's time is kept)
 *   POST /:id/answered  owner: { answered: boolean } marks a message answered
 *                       or not
 *
 * Messages are written by scripts/code-message.ts, never through this API.
 */

import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requestIsOwner } from '../lib/salesmanChoice.js'
import { codeMessageView } from '../lib/codeMessages.js'

const router = Router()
router.use(requireUser, requireAccount)

export const CODE_MESSAGES_OWNER_ONLY = 'Messages from Code are for the owner only.'

async function ownerOnly(req: any, res: any, next: any) {
  if (!(await requestIsOwner(req).catch(() => false))) { res.status(403).json({ success: false, error: CODE_MESSAGES_OWNER_ONLY }); return }
  next()
}

const accountOf = (req: any) => String(req.user.crmAccountId)

router.get('/status', async (req: any, res) => {
  try {
    if (!(await requestIsOwner(req).catch(() => false))) { res.json({ success: true, data: { owner: false, unread: 0 } }); return }
    const unread = await prisma.codeMessage.count({ where: { accountId: accountOf(req), readAt: null } })
    res.json({ success: true, data: { owner: true, unread } })
  } catch {
    res.status(500).json({ success: false, error: 'Could not read Messages from Code.' })
  }
})

router.get('/', ownerOnly, async (req: any, res) => {
  try {
    const rows = await prisma.codeMessage.findMany({ where: { accountId: accountOf(req) }, orderBy: { createdAt: 'desc' }, take: 500 })
    res.json({ success: true, data: rows.map(r => codeMessageView(r, false)) })
  } catch {
    res.status(500).json({ success: false, error: 'Could not read Messages from Code.' })
  }
})

router.get('/:id', ownerOnly, async (req: any, res) => {
  const row = await prisma.codeMessage.findFirst({ where: { id: String(req.params.id), accountId: accountOf(req) } }).catch(() => null)
  if (!row) { res.status(404).json({ success: false, error: 'That message is not here (it may have been removed).' }); return }
  res.json({ success: true, data: codeMessageView(row, true) })
})

router.post('/:id/read', ownerOnly, async (req: any, res) => {
  const where = { id: String(req.params.id), accountId: accountOf(req) }
  // Only an unread one changes: the first open's time is kept.
  await prisma.codeMessage.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } }).catch(() => null)
  const row = await prisma.codeMessage.findFirst({ where }).catch(() => null)
  if (!row) { res.status(404).json({ success: false, error: 'That message is not here (it may have been removed).' }); return }
  res.json({ success: true, data: codeMessageView(row, true) })
})

router.post('/:id/answered', ownerOnly, async (req: any, res) => {
  const where = { id: String(req.params.id), accountId: accountOf(req) }
  const answered = req.body?.answered !== false
  const found = await prisma.codeMessage.findFirst({ where }).catch(() => null)
  if (!found) { res.status(404).json({ success: false, error: 'That message is not here (it may have been removed).' }); return }
  const row = await prisma.codeMessage.update({ where: { id: found.id }, data: { answeredAt: answered ? (found.answeredAt ?? new Date()) : null, readAt: found.readAt ?? new Date() } })
  res.json({ success: true, data: codeMessageView(row, true) })
})

export default router
