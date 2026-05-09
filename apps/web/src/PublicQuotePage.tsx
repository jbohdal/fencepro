/**
 * Public customer-facing quote page at /#/quote/:token.
 *
 * Renders the quote inside the selected template via QuoteTemplateRenderer.
 * This page runs in the *customer's* browser, where there is no staff JWT
 * and no shared localStorage with the CRM. All data comes from the public
 * share endpoints:
 *   GET  /api/saved-quotes/share/:token         — fetch the quote
 *   POST /api/saved-quotes/share/:token/accept  — record acceptance
 */

import { useEffect, useMemo, useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import QuoteTemplateRenderer from './QuoteTemplateRenderer'
import { getTemplate, getDefaultTemplateKey, type QuotePresentation } from './quoteTemplatesStore'
import {
  fetchPublicQuoteByToken,
  acceptPublicQuoteByToken,
  type SavedQuoteRecord,
} from './savedQuotesApi'

function loadCompanyInfo() {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (!r) return { name: 'EZBiz', phone: '', email: '' }
    const cfg = JSON.parse(r)
    return cfg.company || { name: 'EZBiz' }
  } catch { return { name: 'EZBiz' } }
}

function recordToSavedQuote(r: SavedQuoteRecord): SavedQuote & QuotePresentation {
  return {
    id: r.id,
    customerId: r.crmContactId || undefined,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    customerAddress: r.customerAddress,
    leadSource: r.leadSource,
    salesRep: r.salesRep,
    fenceStyle: r.fenceStyle,
    runs: Array.isArray(r.runs) ? r.runs : [],
    runRails: r.runRails || undefined,
    corners: r.corners,
    ends: r.ends,
    walkGates: r.walkGates,
    dblGates: r.dblGates,
    tearOutSections: r.tearOutSections,
    tearOutGates: r.tearOutGates,
    adjLaborHrs: r.adjLaborHrs,
    hasSalesman: r.hasSalesman,
    priceAdjust: r.priceAdjust,
    sections: r.sections,
    materialCost: r.materialCost,
    laborCost: r.laborCost,
    tearOutCost: r.tearOutCost,
    totalCOGS: r.totalCOGS,
    finalPrice: r.finalPrice,
    gmPct: r.gmPct,
    pullSheet: Array.isArray(r.pullSheet) ? r.pullSheet : [],
    status: r.status,
    date: r.date,
    notes: r.notes,
    leadTemp: r.leadTemp,
  } as SavedQuote & QuotePresentation
}

export default function PublicQuotePage({ token }: { token: string }) {
  const [quote, setQuote] = useState<(SavedQuote & QuotePresentation) | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const company = loadCompanyInfo()

  useEffect(() => {
    let cancelled = false
    fetchPublicQuoteByToken(token).then(r => {
      if (cancelled) return
      if (r) {
        setQuote(recordToSavedQuote(r))
        setAcceptedAt(r.acceptedAt)
      }
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [token])

  const template = useMemo(
    () => getTemplate(quote?.templateKey || getDefaultTemplateKey()),
    [quote?.templateKey],
  )

  const expired = useMemo(() => {
    if (!quote) return false
    const days = quote.validityDays ?? 30
    if (!quote.date) return false
    const issued = new Date(quote.date)
    return new Date().getTime() - issued.getTime() > days * 864e5
  }, [quote])

  async function handleAccept(name: string, signature: string) {
    if (!quote) return
    const updated = await acceptPublicQuoteByToken(token, { name, signature })
    if (updated) {
      setAcceptedAt(updated.acceptedAt)
      setQuote(recordToSavedQuote(updated))
    } else {
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

  const accepted = !!acceptedAt

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
