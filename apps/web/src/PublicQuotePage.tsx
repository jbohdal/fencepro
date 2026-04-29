/**
 * Public customer-facing quote page at /#/quote/:token.
 *
 * Renders the quote inside the selected template via QuoteTemplateRenderer.
 * Records view events, enforces expiry, handles acceptance → flips the quote
 * to SOLD and triggers the signed-contract cascade.
 */

import { useEffect, useMemo, useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import { getShareByToken, stampAccepted } from './quoteShareStore'
import { markQuoteSold } from './signedContractFlow'
import QuoteTemplateRenderer from './QuoteTemplateRenderer'
import { getTemplate, getDefaultTemplateKey, type QuotePresentation } from './quoteTemplatesStore'
import { logCustomerActivity } from './customerStore'

function loadCompanyInfo() {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (!r) return { name: 'EZBiz', phone: '', email: '' }
    const cfg = JSON.parse(r)
    return cfg.company || { name: 'EZBiz' }
  } catch { return { name: 'EZBiz' } }
}

function loadQuote(quoteId: string): (SavedQuote & QuotePresentation) | null {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    if (!raw) return null
    const all: (SavedQuote & QuotePresentation)[] = JSON.parse(raw)
    return all.find(q => q.id === quoteId) || null
  } catch { return null }
}

function recordQuoteView(quoteId: string): void {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    if (!raw) return
    const all: (SavedQuote & QuotePresentation)[] = JSON.parse(raw)
    const idx = all.findIndex(q => q.id === quoteId)
    if (idx < 0) return
    const q = all[idx]
    const firstView = !q.viewedAt
    const now = new Date().toISOString()
    all[idx] = {
      ...q,
      viewedAt: q.viewedAt || now,
      lastViewedAt: now,
      viewCount: (q.viewCount || 0) + 1,
    }
    localStorage.setItem('fencepro_quotes', JSON.stringify(all))
    try { window.dispatchEvent(new CustomEvent('fencepro:quotes:updated')) } catch {}

    // On first view, log on customer and fire a rep notification event
    if (firstView) {
      if (q.customerId) {
        logCustomerActivity(q.customerId,
          `Quote #${(q.id || '').slice(-6).toUpperCase()} viewed by the customer`,
          { actor: 'system', kind: 'quote' })
      }
      try {
        window.dispatchEvent(new CustomEvent('fencepro:quote_first_viewed', { detail: { quoteId } }))
      } catch {}
    }
  } catch {}
}

export default function PublicQuotePage({ token }: { token: string }) {
  const [quote, setQuote] = useState<(SavedQuote & QuotePresentation) | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const company = loadCompanyInfo()

  useEffect(() => {
    const share = getShareByToken(token)
    if (!share) { setLoaded(false); setLoaded(true); return }
    const q = loadQuote(share.quoteId)
    setQuote(q)
    setAccepted(!!share.acceptedAt)
    if (q) recordQuoteView(q.id)
    setLoaded(true)
  }, [token])

  const template = useMemo(() => getTemplate(quote?.templateKey || getDefaultTemplateKey()), [quote?.templateKey])

  const expired = useMemo(() => {
    if (!quote) return false
    const days = quote.validityDays ?? 30
    if (!quote.date) return false
    const issued = new Date(quote.date)
    return new Date().getTime() - issued.getTime() > days * 864e5
  }, [quote])

  function handleAccept(name: string, signature: string) {
    if (!quote) return
    try {
      stampAccepted(token, name, signature)
      const res = markQuoteSold(quote.id, { actor: 'customer-accept' })
      // Record presentation-level acceptance too
      try {
        const raw = localStorage.getItem('fencepro_quotes')
        if (raw) {
          const all = JSON.parse(raw)
          const idx = all.findIndex((x: any) => x.id === quote.id)
          if (idx >= 0) {
            all[idx] = { ...all[idx], acceptedAt: new Date().toISOString(), acceptedBy: name, acceptedSignature: signature }
            localStorage.setItem('fencepro_quotes', JSON.stringify(all))
            window.dispatchEvent(new CustomEvent('fencepro:quotes:updated'))
          }
        }
      } catch {}
      setAccepted(true)
      if (quote.customerId) {
        logCustomerActivity(quote.customerId,
          `${name} accepted quote #${(quote.id || '').slice(-6).toUpperCase()} for $${Math.round(quote.finalPrice).toLocaleString()}`,
          { actor: 'customer', kind: 'quote' })
      }
      try {
        window.dispatchEvent(new CustomEvent('fencepro:quote_accepted', { detail: { quoteId: quote.id, name, signature } }))
      } catch {}
      console.log('[Quote] Accepted via hosted page', res.job.id)
    } catch (err) {
      alert('Could not accept quote. Please contact us to complete the acceptance.')
    }
  }

  if (!loaded) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
        <div className="text-center max-w-md">
          <p className="text-4xl mb-3">🔗</p>
          <h1 className="text-xl font-bold text-gray-900">Quote link not found</h1>
          <p className="text-sm text-gray-500 mt-2">Please contact {company.name} for an updated link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <QuoteTemplateRenderer
        quote={quote}
        template={template}
        interactive={!accepted && !expired}
        accepted={accepted}
        expired={expired}
        onAccept={handleAccept}
      />
    </div>
  )
}
