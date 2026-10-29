/**
 * Assigning website and phone leads (lib/leadAssign.ts; Jonathan, Oct 28 2026).
 *
 *   GET  /api/lead-assign              the leads waiting to be assigned, and who they can go to
 *   GET  /api/lead-assign/:customerId  one lead for the Assign screen: who has it now, and the choices
 *   POST /api/lead-assign/:customerId  { to: <login id>, replace?: true }: assign it
 *
 * The owner, admin, manager and office only; the Salesman and the Installer
 * are refused (403). A lead that already has a Salesman goes to someone else
 * only by the owner (Oct 29 2026); anyone else gets a 403 saying who has it.
 * The push's own buttons (public/sw.js) post here too, with the app's sign in
 * cookie.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { staffRoleOf } from '../lib/costRedact.js'
import { audit } from '../lib/auditLog.js'
import { plainZod } from '../lib/plainZod.js'
import { repName } from '../lib/salesRep.js'
import { assignLead, assignees, canAssignLeads, leadForAssign, waitingLeads } from '../lib/leadAssign.js'
import { isOwnerLogin } from '../lib/salesmanChoice.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireAssigner(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  let payload: any
  try { payload = jwt.verify(auth.slice(7), JWT_SECRET) } catch { res.status(401).json({ success: false, error: 'Invalid token' }); return }
  const role = staffRoleOf(req) ?? payload.role
  if (!canAssignLeads(role)) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the owner and the office assign leads.' }); return }
  const u = await prisma.crmUser.findUnique({ where: { id: String(payload.sub) }, select: { id: true, crmAccountId: true, firstName: true, lastName: true, email: true } })
  if (!u?.crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
  req.user = { id: u.id, email: u.email, role, crmAccountId: u.crmAccountId, name: repName(u) || u.email }
  next()
}

router.use(requireAssigner)

const choicesFor = async (req: any) => (await assignees(req.user.crmAccountId)).map(p => ({ id: p.id, name: p.name, role: p.role, me: p.id === req.user.id }))

router.get('/', async (req: any, res) => {
  try {
    const [leads, choices] = await Promise.all([waitingLeads(req.user.crmAccountId), choicesFor(req)])
    res.json({ success: true, data: { leads, choices } })
  } catch (err) {
    console.error('[lead-assign] list error:', err)
    res.status(500).json({ success: false, error: 'Could not load the leads waiting to be assigned' })
  }
})

router.get('/:customerId', async (req: any, res) => {
  try {
    const lead = await leadForAssign(req.user.crmAccountId, String(req.params.customerId))
    if (!lead) { res.status(404).json({ success: false, error: 'That customer is not on file any more.' }); return }
    res.json({ success: true, data: { lead, choices: await choicesFor(req) } })
  } catch (err) {
    console.error('[lead-assign] read error:', err)
    res.status(500).json({ success: false, error: 'Could not load the lead' })
  }
})

const assignSchema = z.object({ to: z.string().min(1, 'Choose who gets the lead').max(100), replace: z.boolean().optional() })

router.post('/:customerId', async (req: any, res) => {
  try {
    const body = assignSchema.parse(req.body ?? {})
    const contactId = String(req.params.customerId)
    // A lead that already has a Salesman is moved by the owner only (lib/salesmanChoice.ts isOwnerLogin).
    const byOwner = await isOwnerLogin(req.user.crmAccountId, req.user.id, req.user.role)
    const r = await assignLead({ accountId: req.user.crmAccountId, contactId, toUserId: body.to, by: { id: req.user.id, name: req.user.name }, replace: body.replace, byOwner })
    if (!r.ok) { res.status(r.status).json({ success: false, code: r.code, error: r.error, ...(r.rep ? { rep: r.rep } : {}) }); return }
    // The open quotes moved with the customer, with their prices (unchanged) and the commission each carries (lib/quotesFollowCustomer.ts).
    if (!r.already || r.quotesMoved.length) await audit(req, 'update', 'CrmContact', contactId, { newValues: { leadAssignedTo: r.assignedTo, cards: r.cardIds, callbacks: r.callbackIds, replace: !!body.replace, quotesMoved: r.quotesMoved } })
    res.json({ success: true, data: { assignedTo: r.assignedTo, already: r.already, cardIds: r.cardIds, quotesMoved: r.quotesMoved.length }, version: r.version })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[lead-assign] assign error:', err)
    res.status(500).json({ success: false, error: 'Could not assign the lead' })
  }
})

export default router
