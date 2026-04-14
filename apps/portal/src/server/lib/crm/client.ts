import type { CrmAdapter } from '../../../types/index.js'
import { FenceProCrmAdapter } from './adapters/fencepro.js'
import { cacheGet, cacheSet } from '../cache.js'

const CRM_PROVIDER = process.env.CRM_PROVIDER || 'fencepro'

let adapter: CrmAdapter | null = null

/** Get the configured CRM adapter (singleton) */
export function getCrmAdapter(): CrmAdapter {
  if (adapter) return adapter

  switch (CRM_PROVIDER) {
    case 'fencepro':
      adapter = new FenceProCrmAdapter()
      break
    // Add more adapters here:
    // case 'hubspot':
    //   adapter = new HubSpotCrmAdapter()
    //   break
    // case 'salesforce':
    //   adapter = new SalesforceCrmAdapter()
    //   break
    default:
      adapter = new FenceProCrmAdapter()
  }

  return adapter
}

/** Cached CRM account fetch (5-minute TTL) */
export async function getCachedAccount(externalId: string) {
  const cacheKey = `crm:account:${externalId}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const crm = getCrmAdapter()
  const account = await crm.getAccount(externalId)
  if (account) cacheSet(cacheKey, account)
  return account
}

/** Retry wrapper with exponential backoff */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 500): Promise<T> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err as Error
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}
