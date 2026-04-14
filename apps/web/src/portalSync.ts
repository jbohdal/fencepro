/**
 * Portal Sync Client
 *
 * Pushes CRM data to the customer portal's API.
 * The portal server must be running for sync to work.
 * Failures are silent — the CRM works offline, portal syncs when available.
 */

const PORTAL_API = 'http://localhost:4000/api/sync'
const SYNC_KEY = 'dev-sync-key'

// Default account for this CRM instance
const ACCOUNT_EXTERNAL_ID = 'gdf-001'

async function syncPost(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${PORTAL_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': SYNC_KEY },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    // Portal offline — fail silently
    return false
  }
}

async function syncGet(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${PORTAL_API}${path}`, {
      headers: { 'X-API-Key': SYNC_KEY },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.success ? data.data : null
  } catch {
    return null
  }
}

/* ───────── Sync functions called from CRM actions ───────── */

/** Sync a customer to the portal (call when customer is created/updated) */
export async function syncCustomer(customer: {
  firstName: string; lastName: string; email: string; phone?: string
}): Promise<boolean> {
  if (!customer.email) return false
  return syncPost('/customers', {
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone || '',
    accountExternalId: ACCOUNT_EXTERNAL_ID,
  })
}

/** Sync a quote to the portal (call when quote is saved/status changes) */
export async function syncQuote(quote: {
  id: string; customerName: string; fenceStyle: string; sections: number
  finalPrice: number; status: string; date: string; customerAddress?: string
}): Promise<boolean> {
  return syncPost('/quotes', {
    externalId: quote.id,
    accountExternalId: ACCOUNT_EXTERNAL_ID,
    customerName: quote.customerName,
    fenceStyle: quote.fenceStyle,
    sections: quote.sections,
    totalPrice: quote.finalPrice,
    status: quote.status,
    date: quote.date,
    address: quote.customerAddress || '',
  })
}

/** Sync a job status to the portal (call when job is updated) */
export async function syncJob(job: {
  quoteId: string; status: string; crewAssigned?: string
  scheduledDate?: string; completedDate?: string; contractValue?: number
}): Promise<boolean> {
  return syncPost('/jobs', {
    externalId: job.quoteId,
    accountExternalId: ACCOUNT_EXTERNAL_ID,
    status: job.status,
    crewAssigned: job.crewAssigned,
    scheduledDate: job.scheduledDate,
    completedDate: job.completedDate,
    contractValue: job.contractValue,
  })
}

/** Sync an invoice to the portal */
export async function syncInvoice(invoice: {
  id: string; invoiceNumber: string; amountCents: number
  dueDate: string; status: 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded'
  paidAt?: string
}): Promise<boolean> {
  return syncPost('/invoices', {
    externalId: invoice.id,
    accountExternalId: ACCOUNT_EXTERNAL_ID,
    invoiceNumber: invoice.invoiceNumber,
    amountCents: invoice.amountCents,
    dueDate: invoice.dueDate,
    status: invoice.status,
    paidAt: invoice.paidAt,
  })
}

/** Fetch portal activity for display in CRM (tickets, documents, chats, customer actions) */
export async function getPortalActivity(): Promise<{
  tickets: { id: string; title: string; status: string; priority: string; createdAt: string; commentCount: number }[]
  documents: { id: string; filename: string; uploadedBy: string; uploadedAt: string }[]
  chats: { id: string; customerName: string; status: string; ticketId?: string; messageCount: number; lastMessages: { role: string; body: string; createdAt: string }[]; updatedAt: string }[]
  recentActivity: { action: string; user: string; timestamp: string }[]
} | null> {
  const data = await syncGet(`/activity/${ACCOUNT_EXTERNAL_ID}`)
  return data as any || null
}

/** Ensure the account exists in the portal */
export async function ensurePortalAccount(companyName: string, repName?: string, repEmail?: string): Promise<boolean> {
  return syncPost('/accounts', {
    externalCrmId: ACCOUNT_EXTERNAL_ID,
    name: companyName,
    status: 'active',
    assignedRepName: repName,
    assignedRepEmail: repEmail,
  })
}
