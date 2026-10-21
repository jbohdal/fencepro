/**
 * Pipeline seeder — the card a new customer gets on the sales pipeline, in
 * the "new cards land here" stage (Settings > Pipeline Stages).
 */

import { roleId } from './pipelineStagesStore'
import { getPipeline } from './pipelineStore'
import { newId } from './recordSync'
import { businessDate } from './businessDate'

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
  /** The column it goes in (a stage id); the first stage unless added to another one. */
  stage?: string
}

/**
 * The card for a new customer, or null when one is already on
 * the board. It is not saved here: it goes to the server in the same save as
 * the customer (customerStore), so both are saved or neither is.
 */
export function leadForNewCustomer(customer: NewCustomerForPipeline): Record<string, unknown> | null {
  try {
    const leads = getPipeline().leads || []

    // Dedupe — if a lead already exists for this customer id, don't add again
    const customerKey = customer.id
    const already = leads.find((l: any) =>
      l.customerId === customerKey ||
      (l.firstName === customer.firstName && l.lastName === customer.lastName &&
        l.phone === (customer.phone || '') && !!customer.firstName)
    )
    if (already) return null

    return {
      id: newId(),
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
      stage: customer.stage || roleId('first'),
      createdAt: customer.createdAt || businessDate(new Date()),
      lastMoved: businessDate(new Date()),
      assignedRep: customer.salesRep || '',
    }
  } catch { return null }
}
