/**
 * Intake — leads that arrived from outside the CRM.
 *
 * A quote completed on the website (EZ Quote widget) or a call handled by the
 * phone agent (Retell) is saved by the server as a customer plus a note. The
 * sales pipeline is saved by the browser as one document, so the server does
 * not touch it; it queues the lead and this module adds the pipeline card,
 * then tells the server the lead has been picked up.
 *
 * Runs after login, once a minute, and when the tab gets focus again.
 */

import { fetchWithAuth } from './crmAuth'
import { refreshCustomers, getCustomerById } from './customerStore'
import { getPipeline, savePipeline, isPipelineHydrated } from './pipelineStore'
import { newId } from './recordSync'
import { toast } from './toast'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

export interface IntakeLead {
  id: string
  source: 'ez_quote' | 'retell' | string
  crmContactId: string | null
  name: string
  phone: string
  email: string
  address: string
  fenceType: string
  summary: string
  estimate: number | null
  callbackAt: string | null
  status: string
  createdAt: string
}

const DEFAULT_STAGES = [
  'First Contact', 'Appointment', 'Estimating', 'Pending Signature',
  'Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress',
  'Job Complete', 'Pending Payment', 'Paid & Closed', 'Lost Sale', 'No Answer',
]

const SOURCE_LABEL: Record<string, string> = { ez_quote: 'Website Quote', retell: 'Phone (AI receptionist)' }

let running = false
let timer: ReturnType<typeof setInterval> | null = null

async function api<T>(method: string, path: string): Promise<T | null> {
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/intake${path}`, { method })
    if (!res.ok) return null
    const json = await res.json().catch(() => ({}))
    return json?.success ? (json.data as T) : null
  } catch { return null }
}

/** One open pipeline card per customer; a repeat call or a second quote updates it. */
function upsertPipelineCard(lead: IntakeLead): void {
  const cached = getPipeline()
  const leads = [...(cached.leads || [])]
  const stages = cached.stages && cached.stages.length > 0 ? cached.stages : DEFAULT_STAGES
  const today = new Date().toISOString().slice(0, 10)
  const customer = lead.crmContactId ? getCustomerById(lead.crmContactId) : null
  const header = lead.source === 'retell'
    ? `Phone call ${today}${lead.callbackAt ? ' · callback: ' + lead.callbackAt : ''}`
    : `Website quote ${today}${lead.estimate ? ' · budget shown $' + Math.round(lead.estimate).toLocaleString('en-US') : ''}`

  const idx = lead.crmContactId ? leads.findIndex((l: any) => l.customerId === lead.crmContactId) : -1
  if (idx >= 0) {
    const cur = leads[idx]
    leads[idx] = {
      ...cur,
      notes: [header, cur.notes].filter(Boolean).join('\n'),
      fenceType: cur.fenceType || lead.fenceType || '',
      quotePrice: cur.quotePrice || (lead.source === 'ez_quote' ? lead.estimate || 0 : 0),
    }
  } else {
    const [first, ...rest] = (customer ? `${customer.firstName} ${customer.lastName}` : lead.name).trim().split(/\s+/)
    leads.unshift({
      id: newId(),
      customerId: lead.crmContactId || '',
      firstName: first || 'Unknown',
      lastName: rest.join(' '),
      phone: customer?.phone || lead.phone || '',
      email: customer?.email || lead.email || '',
      address: customer?.serviceAddress || lead.address || '',
      leadSource: SOURCE_LABEL[lead.source] || lead.source,
      leadTemp: 0,
      fenceType: lead.fenceType || '',
      sections: 0,
      quotePrice: lead.source === 'ez_quote' ? lead.estimate || 0 : 0,
      crew: '',
      scheduledDate: '',
      jobValue: 0,
      paymentStatus: '',
      balanceDue: 0,
      notes: header,
      stage: stages[0] || 'First Contact',
      createdAt: today,
      lastMoved: today,
      assignedRep: '',
    })
  }
  savePipeline(leads, stages)
}

/** Pull new intake leads into the pipeline. Safe to call any time; returns how many were added. */
export async function syncIntake(): Promise<number> {
  if (running || !isPipelineHydrated()) return 0
  running = true
  try {
    const leads = await api<IntakeLead[]>('GET', '')
    if (!leads || leads.length === 0) return 0
    // The server created or matched the customers; get them into this browser.
    await refreshCustomers()
    let added = 0
    for (const lead of leads) {
      upsertPipelineCard(lead)
      const ok = await api<{ updated: number }>('POST', `/${lead.id}/ack`)
      if (!ok) continue
      added++
      toast.info(
        lead.source === 'retell' ? `New call: ${lead.name}` : `New website quote: ${lead.name}`,
        lead.source === 'retell'
          ? (lead.callbackAt ? `Callback booked: ${lead.callbackAt}` : 'Added to the sales pipeline')
          : `${lead.fenceType || 'Fence quote'}${lead.estimate ? ' · $' + Math.round(lead.estimate).toLocaleString('en-US') : ''} · added to the sales pipeline`,
      )
    }
    return added
  } finally {
    running = false
  }
}

/** Start checking for new leads. Call once after the stores have loaded. */
export function startIntakeSync(): void {
  if (timer) return
  void syncIntake()
  timer = setInterval(() => { void syncIntake() }, 60_000)
  window.addEventListener('focus', () => { void syncIntake() })
}
