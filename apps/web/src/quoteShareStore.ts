/**
 * Quote share tokens — maps a public URL token to a quote ID so the
 * customer-facing page can render a specific quote without auth.
 *
 * Also records acceptance + request-changes events per token.
 */

const KEY = 'fencepro_quote_shares'

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)

export interface QuoteShare {
  token: string
  quoteId: string
  createdAt: string
  sentAt?: string
  sentTo?: string
  acceptedAt?: string
  acceptedBy?: string
  acceptedSignature?: string
  changeRequests: { at: string; body: string }[]
}

export function getShares(): QuoteShare[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveAll(all: QuoteShare[]) { localStorage.setItem(KEY, JSON.stringify(all)) }

export function getShareByToken(token: string): QuoteShare | null {
  return getShares().find(s => s.token === token) || null
}

export function getShareByQuoteId(quoteId: string): QuoteShare | null {
  return getShares().find(s => s.quoteId === quoteId) || null
}

/** Issue (or reuse) a share for a given quote. */
export function ensureShareForQuote(quoteId: string): QuoteShare {
  const existing = getShareByQuoteId(quoteId)
  if (existing) return existing
  const share: QuoteShare = {
    token: uid(), quoteId,
    createdAt: new Date().toISOString(),
    changeRequests: [],
  }
  const all = getShares()
  all.unshift(share)
  saveAll(all)
  return share
}

export function stampSent(token: string, to: string): QuoteShare | null {
  const all = getShares()
  const idx = all.findIndex(s => s.token === token)
  if (idx < 0) return null
  all[idx] = { ...all[idx], sentAt: new Date().toISOString(), sentTo: to }
  saveAll(all)
  return all[idx]
}

export function stampAccepted(token: string, name: string, signature: string): QuoteShare | null {
  const all = getShares()
  const idx = all.findIndex(s => s.token === token)
  if (idx < 0) return null
  all[idx] = {
    ...all[idx],
    acceptedAt: new Date().toISOString(),
    acceptedBy: name, acceptedSignature: signature,
  }
  saveAll(all)
  try { window.dispatchEvent(new CustomEvent('fencepro:quote_accepted', { detail: all[idx] })) } catch {}
  return all[idx]
}

export function addChangeRequest(token: string, body: string): QuoteShare | null {
  const all = getShares()
  const idx = all.findIndex(s => s.token === token)
  if (idx < 0) return null
  all[idx] = {
    ...all[idx],
    changeRequests: [...(all[idx].changeRequests || []), { at: new Date().toISOString(), body }],
  }
  saveAll(all)
  return all[idx]
}
