/**
 * Website and phone leads waiting to be assigned, and the one tap Assign
 * (portal routes/lead-assign.ts, lib/leadAssign.ts; Jonathan, Oct 28 2026:
 * "unassigned website and phone leads push me right away with a one tap
 * Assign. They never sit unseen").
 *
 * Everything is read from and saved to the server; nothing is kept on the phone.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { signedInRole } from './permissions'
import { refreshPipeline } from './pipelineStore'
import { refreshCustomers } from './customerStore'
import { refreshQuotes } from './quoteStore'

export interface WaitingLead {
  customerId: string
  name: string
  source: string
  sourceWords: string
  town: string
  what: string
  phone: string
  at: string
  cardId: string | null
}
export interface LeadRep { name: string; from: 'customer' | 'card' | 'appointment'; by: string | null; at: string | null }
export interface AssignChoice { id: string; name: string; role: string; me: boolean }

/** The owner, admin, manager and office assign leads; the Salesman and the Installer do not. */
export const canAssignLeads = (role: string | null = signedInRole()): boolean =>
  role === 'super_admin' || role === 'admin' || role === 'manager' || role === 'office_staff'

/** Said whenever a lead is assigned on this phone, so the waiting count reads again. */
export const LEADS_ASSIGNED_EVENT = 'ezbiz:leads:assigned'

export async function loadWaitingLeads(): Promise<{ leads: WaitingLead[]; choices: AssignChoice[] } | null> {
  const r = await sendJson('GET', '/api/lead-assign')
  return r.result.ok ? r.json.data : null
}

export async function loadLead(customerId: string): Promise<{ ok: true; lead: WaitingLead & { rep: LeadRep | null }; choices: AssignChoice[] } | { ok: false; error: string }> {
  const r = await sendJson('GET', `/api/lead-assign/${encodeURIComponent(customerId)}`)
  if (r.result.ok) return { ok: true, lead: r.json.data.lead, choices: r.json.data.choices }
  return { ok: false, error: r.status === 0 ? 'No signal right now. Try again when there is signal.' : (r.json?.error || 'Could not load the lead.') }
}

export type AssignResult =
  /** quotesMoved: how many of the customer's open quotes went with them (portal lib/quotesFollowCustomer.ts). */
  | { ok: true; assignedTo: string; already: boolean; quotesMoved: number }
  | { ok: false; taken?: LeadRep; error: string }

/** Assign one lead. `replace`: the answer yes to "Already assigned to X". */
export async function assignLead(customerId: string, to: string, replace = false): Promise<AssignResult> {
  const r = await sendJson('POST', `/api/lead-assign/${encodeURIComponent(customerId)}`, { to, ...(replace ? { replace: true } : {}) })
  if (r.result.ok) {
    window.dispatchEvent(new Event(LEADS_ASSIGNED_EVENT))
    // The card, the customer and the customer's open quotes now carry the rep: read them again so this phone shows it.
    void refreshPipeline()
    void refreshCustomers()
    void refreshQuotes()
    return { ok: true, assignedTo: r.json.data.assignedTo, already: !!r.json.data.already, quotesMoved: Number(r.json.data.quotesMoved) || 0 }
  }
  if (r.status === 409 && r.json?.code === 'ALREADY_ASSIGNED') return { ok: false, taken: r.json.rep, error: r.json.error }
  return { ok: false, error: r.status === 0 ? 'No signal right now. Nothing was assigned; try again.' : (r.json?.error || 'Could not assign the lead.') }
}

/** The leads waiting, read now, every minute and when the app comes back to the front. Null until first read. */
export function useWaitingLeads(enabled: boolean): { leads: WaitingLead[]; choices: AssignChoice[] } | null {
  const [data, setData] = useState<{ leads: WaitingLead[]; choices: AssignChoice[] } | null>(null)
  useEffect(() => {
    if (!enabled) { setData(null); return }
    let live = true
    const read = () => { void loadWaitingLeads().then(d => { if (live && d) setData(d) }) }
    read()
    const timer = setInterval(read, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(LEADS_ASSIGNED_EVENT, read)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(LEADS_ASSIGNED_EVENT, read)
    }
  }, [enabled])
  return data
}

/** "2 hours ago", "Yesterday 3:10 PM", "Oct 21": when a lead came in. */
export function arrivedWords(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 12 * 60) return `${Math.round(mins / 60)} hr ago`
  const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' })
  const time = at.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  if (day(at) === day(now)) return `Today ${time}`
  if (day(at) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday ${time}`
  return at.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) + ` ${time}`
}
