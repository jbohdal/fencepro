/**
 * Pipeline seeder — when a new customer is created, add a matching lead
 * to the sales pipeline under First Contact.
 */

const PIPELINE_KEY = 'fencepro_pipeline'

const uid = () => Math.random().toString(36).slice(2, 9)

export interface NewCustomerForPipeline {
  id: string
  firstName: string
  lastName: string
  phone?: string
  email?: string
  serviceAddress?: string
  leadSource?: string
  notes?: string
  salesRep?: string
  createdAt?: string
}

export function addLeadForNewCustomer(customer: NewCustomerForPipeline): void {
  try {
    const raw = localStorage.getItem(PIPELINE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const leads = parsed?.leads || []
    const stages = parsed?.stages || [
      'First Contact', 'Appointment', 'Estimating', 'Pending Signature',
      'Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress',
      'Job Complete', 'Pending Payment', 'Paid & Closed', 'Lost Sale', 'No Answer',
    ]

    // Dedupe — if a lead already exists for this customer id, don't add again
    const customerKey = customer.id
    const already = leads.find((l: any) =>
      l.customerId === customerKey ||
      (l.firstName === customer.firstName && l.lastName === customer.lastName &&
        l.phone === (customer.phone || '') && !!customer.firstName)
    )
    if (already) return

    const newLead = {
      id: uid(),
      customerId: customer.id,
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.serviceAddress || '',
      leadSource: customer.leadSource || '',
      leadTemp: 0,
      fenceType: '',
      sections: 0,
      quotePrice: 0,
      crew: '',
      scheduledDate: '',
      jobValue: 0,
      paymentStatus: '',
      balanceDue: 0,
      notes: customer.notes || '',
      stage: 'First Contact',
      createdAt: customer.createdAt || new Date().toISOString().slice(0, 10),
      lastMoved: new Date().toISOString().slice(0, 10),
      assignedRep: customer.salesRep || '',
    }

    leads.unshift(newLead)
    localStorage.setItem(PIPELINE_KEY, JSON.stringify({ leads, stages }))

    // Signal open JobsPage instances to reload
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: PIPELINE_KEY }))
    } catch { /* noop */ }
  } catch { /* noop */ }
}
