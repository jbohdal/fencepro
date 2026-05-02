import type {
  CrmAdapter, CrmAccountData, CrmTicketData, CrmInvoiceData, CrmContractData, CreateTicketRequest,
} from '../../../../types/index.js'
import { withRetry } from '../client.js'

const BASE_URL = process.env.CRM_BASE_URL || 'http://localhost:3000/api'
const API_KEY = process.env.CRM_API_KEY || ''

/**
 * EZ Biz CRM Adapter
 * Connects to the EZ Biz CRM REST API. For the localStorage-based CRM,
 * this adapter reads from the local data layer directly.
 * Swap this out for HubSpot, Salesforce, etc. by implementing the same interface.
 */
export class EzBizCrmAdapter implements CrmAdapter {
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    return withRetry(async () => {
      const res = await globalThis.fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: { ...this.headers, ...options?.headers },
      })
      if (!res.ok) throw new Error(`CRM API error: ${res.status} ${res.statusText}`)
      return res.json() as Promise<T>
    })
  }

  async getAccount(externalId: string): Promise<CrmAccountData | null> {
    try {
      return await this.fetch<CrmAccountData>(`/accounts/${externalId}`)
    } catch {
      return null
    }
  }

  async getTickets(accountId: string): Promise<CrmTicketData[]> {
    try {
      return await this.fetch<CrmTicketData[]>(`/accounts/${accountId}/tickets`)
    } catch {
      return []
    }
  }

  async getInvoices(accountId: string): Promise<CrmInvoiceData[]> {
    try {
      return await this.fetch<CrmInvoiceData[]>(`/accounts/${accountId}/invoices`)
    } catch {
      return []
    }
  }

  async getContracts(accountId: string): Promise<CrmContractData[]> {
    try {
      return await this.fetch<CrmContractData[]>(`/accounts/${accountId}/contracts`)
    } catch {
      return []
    }
  }

  async createTicket(accountId: string, data: CreateTicketRequest): Promise<CrmTicketData> {
    return this.fetch<CrmTicketData>(`/accounts/${accountId}/tickets`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async addTicketComment(ticketId: string, body: string, authorName: string): Promise<void> {
    await this.fetch(`/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, authorName, isInternal: false }),
    })
  }
}
