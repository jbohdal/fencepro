/**
 * The quote builder's prices from the server, for a Salesman or Installer
 * (their phone never gets costs, so it cannot price a quote itself): POST
 * /api/quote-pricing runs the same math (quoteJob.ts) and answers prices only
 * (quoteView). Asked again a moment after anything on the quote changes; an
 * answer to an older question is dropped.
 */

import { useEffect, useRef, useState } from 'react'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import type { QuoteJobRequest, QuoteView } from './quoteJob'
import type { QuoteCalc, QuoteStyle } from './quoteCalc'
import type { LineItem } from './materialCalculator'
import type { WorkResult } from './moveRepair'
import type { ResolvedTier } from './tiers'
import type { ProposalOption } from './proposal'

const API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/quote-pricing'

export async function fetchQuoteView(request: QuoteJobRequest, quoteId?: string | null, signal?: AbortSignal): Promise<QuoteView> {
  const r = await fetchWithAuth(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, quoteId: quoteId ?? null }), signal })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j?.success) throw new Error(j?.error || 'Could not price this quote. Check the signal and try again.')
  return j.data as QuoteView
}

/** The server's prices for this quote; null until the first answer (and while there is no style). */
export function useServerQuoteView(enabled: boolean, request: QuoteJobRequest, quoteId?: string | null): { view: QuoteView | null; pricing: boolean; error: string | null } {
  const [view, setView] = useState<QuoteView | null>(null)
  const [pricing, setPricing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = enabled && request.fenceStyle ? JSON.stringify({ request, quoteId }) : ''
  const asked = useRef(0)
  useEffect(() => {
    if (!key) { setView(null); setPricing(false); return }
    const n = ++asked.current
    const ctl = new AbortController()
    setPricing(true)
    const t = setTimeout(() => {
      fetchQuoteView(request, quoteId, ctl.signal)
        .then(v => { if (n === asked.current) { setView(v); setError(null) } })
        .catch(e => { if (n === asked.current && (e as Error).name !== 'AbortError') setError((e as Error).message) })
        .finally(() => { if (n === asked.current) setPricing(false) })
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  return { view, pricing, error }
}

// ── The server's prices in the shapes the quote builder reads (costs are 0: never shown to these logins) ──

const line = (l: QuoteView['pullSheet'][number]): LineItem => ({ item: l.item, qty: l.qty, unitCost: 0, total: 0, ...('costSource' in l && l.costSource ? { costSource: l.costSource as LineItem['costSource'] } : {}), ...('moneyOnly' in l && l.moneyOnly ? { moneyOnly: true } : {}) })
const NO_SNAPSHOT: ProposalOption['snapshot'] = { materialCost: 0, laborCost: 0, tearOutCost: 0, totalCOGS: 0, gmPct: 0, pullSheet: [], runSections: [] }
const option = (o: QuoteView['proposalOptions'][number]): ProposalOption => ({ ...o, snapshot: NO_SNAPSHOT })

export function viewCalc(local: QuoteCalc, v: QuoteView | null): QuoteCalc {
  const p = local.priced
  return {
    ...local,
    sections: v?.sections ?? local.sections,
    perRunSections: v?.perRunSections ?? local.perRunSections,
    perRunRail: v?.perRunRail ?? local.perRunRail,
    optimizer: null,
    materials: { ...local.materials, items: (v?.pullSheet ?? []).map(line), warnings: v?.materialWarnings ?? [] },
    materialCost: 0,
    priced: {
      ...p, subRate: 0, laborCost: 0, tearOutCost: 0, materialCost: 0, totalCOGS: 0, costFactor: 0, pricePerFootUsed: 0, basePrice: 0,
      commissionPct: 0, commissionAmt: 0, grossMargin: 0, gmPct: 0, notes: [],
      commissionMode: v?.commissionMode ?? p.commissionMode,
      price: v?.newFencePrice ?? 0, priceBeforeRounding: v?.newFencePrice ?? 0, roundingCents: 0, priceBeforeAdjustment: 0, listPrice: v?.listPrice ?? 0, adjustmentCents: v?.adjustmentCents ?? 0, adjustmentRefused: !!v?.adjustmentRefused, pricePerFoot: v?.pricePerFoot ?? 0, priceMethod: v?.priceMethod ?? p.priceMethod,
      manHours: v?.manHours ?? 0, crewSize: v?.crewSize ?? p.crewSize, crewHours: v?.crewHours ?? 0, crewDays: v?.crewDays ?? 0,
    },
  }
}

export function viewWork(w: QuoteView['work']): WorkResult | null {
  if (!w) return null
  return {
    ...w, lines: [], materialCents: 0, laborCents: 0, disposalCents: 0, costCents: 0, costFactor: 0, targetMarginPct: 0, marginFrom: '',
    basePriceCents: 0, roundingCents: 0, commissionCents: 0, grossMarginCents: 0, gmPct: 0, minimumCents: 0, pullSheet: w.pullSheet.map(line),
  }
}

export function viewTiers(v: QuoteView | null, styles: QuoteStyle[]): ResolvedTier[] {
  return (v?.tiers ?? []).map(t => ({
    spec: t.spec, category: t.category, popular: t.popular, off: t.off, swapped: t.swapped, widthFt: t.widthFt, otherWidth: t.otherWidth,
    ...(t.reason ? { reason: t.reason } : {}), ...(t.sameAs ? { sameAs: t.sameAs } : {}),
    ...(t.styleName && t.option ? { style: styles.find(s => s.name === t.styleName) ?? ({ name: t.styleName } as QuoteStyle), option: option(t.option) } : {}),
  }))
}

export function viewCompare(v: QuoteView | null, styles: Array<QuoteStyle & { id?: string }>): Array<{ style: QuoteStyle & { id?: string }; option: ProposalOption }> {
  return (v?.compare ?? []).map(r => ({ style: styles.find(s => s.name === r.styleName) ?? ({ id: r.styleName, name: r.styleName } as QuoteStyle & { id: string }), option: option(r.option) }))
}

export function viewProposalOptions(v: QuoteView | null): ProposalOption[] {
  return (v?.proposalOptions ?? []).map(option)
}
