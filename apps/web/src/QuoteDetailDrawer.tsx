/**
 * Quote Detail Drawer — a slide-over panel that shows a full readable
 * view of a single saved quote + primary actions.
 *
 * Used from:
 *   - Customer profile Quotes tab (click a row)
 *   - Quotes list (any row)
 */

import { useMemo, useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import { updateQuote, getQuoteById } from './quoteStore'
import { markQuoteSold, markQuoteLost } from './signedContractFlow'
import { ensureShareForQuote, stampSent, getShareByQuoteId } from './quoteShareStore'
import { getEmailTemplate, renderTemplate } from './emailTemplatesStore'
import { getOptionsForQuote } from './bundleStore'
import { toast } from './toast'
import { TEMPLATES, getDefaultTemplateKey, type TemplateKey, type QuotePresentation } from './quoteTemplatesStore'
import QuoteTemplateRenderer from './QuoteTemplateRenderer'
import { getConfig } from './configStore'
import { sectionsForRun } from './sectionCount'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
const fmt0 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const STATUS_STYLES: Record<SavedQuote['status'], { bg: string; text: string; label: string }> = {
  DRAFT: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  SENT:  { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Sent' },
  SOLD:  { bg: 'bg-green-100', text: 'text-green-700', label: 'Sold' },
  LOST:  { bg: 'bg-red-100', text: 'text-red-700', label: 'Lost' },
}

export default function QuoteDetailDrawer({
  quote,
  onClose,
  onEdit,
  onChange,
  internalView = true,
}: {
  quote: SavedQuote
  onClose: () => void
  onEdit?: () => void
  onChange?: () => void
  internalView?: boolean
}) {
  const [sendOpen, setSendOpen] = useState(false)
  const status = STATUS_STYLES[quote.status]
  const totalFootage = useMemo(() => (quote.runs || []).reduce((a, b) => a + b, 0), [quote.runs])
  const options = useMemo(() => getOptionsForQuote(quote.id), [quote.id])
  const share = getShareByQuoteId(quote.id)
  const shareUrl = share ? `${window.location.origin}/#/quote/${share.token}` : null

  function handleMarkSold() {
    if (!confirm(`Mark this quote as SOLD and create a job?`)) return
    try {
      const res = markQuoteSold(quote.id, { actor: 'user' })
      toast.success(res.alreadySold ? 'Already SOLD — job ensured' : 'Quote marked SOLD',
        `Job created on the Operations board · ${res.job.customerName}`)
      onChange?.()
      onClose()
    } catch (err: any) {
      toast.error('Could not mark as sold', err?.message)
    }
  }

  function handleMarkLost() {
    const reason = prompt('Reason this was lost? (optional)') || ''
    if (reason === null) return
    markQuoteLost(quote.id, reason, 'user')
    toast.success('Marked as Lost')
    onChange?.()
    onClose()
  }

  function handleCopyShareLink() {
    const s = ensureShareForQuote(quote.id)
    const url = `${window.location.origin}/#/quote/${s.token}`
    navigator.clipboard?.writeText(url).catch(() => {})
    toast.success('Link copied', url)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl h-full overflow-y-auto">
        {/* Header */}
        <div className="px-8 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">Quote #{quote.id.slice(-6).toUpperCase()}</h2>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{quote.customerName} · {quote.date}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Top price bar */}
          <div className="bg-gradient-to-r from-orange-50 to-white rounded-2xl border border-orange-100 p-6 flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest font-bold text-orange-600">Quote Price</p>
              <p className="text-4xl font-black text-gray-900 mt-2">{fmt0(quote.finalPrice)}</p>
              <p className="text-xs text-gray-500 mt-1">{quote.fenceStyle}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-500">{totalFootage} ft total</p>
              <p className="text-gray-500">{quote.sections} sections</p>
              {internalView && <p className={`mt-1 font-semibold ${quote.gmPct >= 0.34 ? 'text-green-700' : quote.gmPct >= 0.27 ? 'text-yellow-600' : 'text-red-600'}`}>{fmtPct(quote.gmPct)} margin</p>}
            </div>
          </div>

          {/* Customer block */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Customer</p>
            <div className="bg-gray-50 rounded-xl p-4 text-sm">
              <p className="font-semibold text-gray-900">{quote.customerName}</p>
              <p className="text-gray-500">{quote.customerAddress || '—'}</p>
              <p className="text-gray-500">{[quote.customerPhone, quote.customerEmail].filter(Boolean).join(' · ')}</p>
            </div>
          </section>

          {/* Options present */}
          {options.length > 0 && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Good / Better / Best Options</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {options.map(o => (
                  <div key={o.id} className={`rounded-xl border p-3 ${o.isRecommended ? 'border-orange-400 ring-2 ring-orange-200' : 'border-gray-200'}`}>
                    <p className="text-[10px] uppercase font-bold text-gray-500">{o.tierLabel}</p>
                    <p className="text-lg font-bold text-gray-900">{fmt0(o.quotePriceCents / 100)}</p>
                    <p className="text-xs text-gray-500">{o.footage} ft · {fmt(o.pricePerFootCents / 100)}/ft</p>
                    {o.status === 'accepted' && <p className="text-[10px] text-green-700 mt-1">✓ Accepted {o.acceptedBy ? `by ${o.acceptedBy}` : ''}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Runs */}
          {(quote.runs || []).length > 0 && (() => {
            // Look up the panel width from configStore by style name. Falls back
            // to 6 if the style is missing from the config (legacy quotes).
            const styleCfg = getConfig().fenceStyles.find(s => s.name === quote.fenceStyle)
            const panelWidth = styleCfg?.panelWidth ?? 6
            const perRunSections = (quote.runs || []).map(ft => sectionsForRun(ft, panelWidth))
            const totalSections = perRunSections.reduce((s, n) => s + n, 0)
            return (
              <section>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Run Breakdown</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase font-semibold text-gray-400 tracking-widest border-b border-gray-100">
                      <th className="text-left py-2">Run</th>
                      <th className="text-right py-2">Footage</th>
                      <th className="text-right py-2">Sections</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(quote.runs || []).map((ft, i) => (
                      <tr key={i}>
                        <td className="py-2 text-gray-700">Run {i + 1}</td>
                        <td className="py-2 text-right font-medium">{ft} ft</td>
                        <td className="py-2 text-right text-orange-600 font-medium">{perRunSections[i]}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-gray-200">
                      <td className="py-2 text-gray-900">Total</td>
                      <td className="py-2 text-right">{totalFootage} ft</td>
                      <td className="py-2 text-right text-orange-700">{totalSections}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            )
          })()}

          {/* Gates + corners */}
          <section className="grid grid-cols-4 gap-3 text-sm">
            <div><p className="text-[10px] uppercase text-gray-400 font-bold">Corners</p><p className="font-medium text-gray-900">{quote.corners}</p></div>
            <div><p className="text-[10px] uppercase text-gray-400 font-bold">Ends</p><p className="font-medium text-gray-900">{quote.ends}</p></div>
            <div><p className="text-[10px] uppercase text-gray-400 font-bold">Walk Gates</p><p className="font-medium text-gray-900">{quote.walkGates}</p></div>
            <div><p className="text-[10px] uppercase text-gray-400 font-bold">Double Gates</p><p className="font-medium text-gray-900">{quote.dblGates}</p></div>
          </section>

          {/* Internal pricing breakdown */}
          {internalView && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Pricing (Internal)</p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Material Cost</span><span>{fmt(quote.materialCost)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Labor Cost</span><span>{fmt(quote.laborCost)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Tear Out</span><span>{fmt(quote.tearOutCost)}</span></div>
                <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total COGS</span><span>{fmt(quote.totalCOGS)}</span></div>
                <div className="flex justify-between font-bold text-orange-700 border-t border-gray-200 pt-1 mt-1"><span>Quote Price</span><span>{fmt(quote.finalPrice)}</span></div>
                <div className="flex justify-between pt-1 text-xs text-gray-500"><span>Gross Margin</span><span>{fmtPct(quote.gmPct)}</span></div>
              </div>
            </section>
          )}

          {/* Pull sheet (internal) */}
          {internalView && quote.pullSheet?.length > 0 && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Pull Sheet</p>
              <div className="bg-gray-50 rounded-xl p-3 max-h-48 overflow-y-auto">
                {quote.pullSheet.map((li, i) => (
                  <div key={i} className="flex justify-between py-1 text-xs border-b border-gray-100 last:border-0">
                    <span className="text-gray-700 truncate pr-2">{li.item}</span>
                    <span className="text-gray-500">{li.qty} × {fmt(li.unitCost)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {quote.notes && (
            <section>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
            </section>
          )}

          {shareUrl && (
            <section className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Customer Share Link</p>
              <p className="text-xs font-mono text-blue-900 mt-1 break-all">{shareUrl}</p>
            </section>
          )}
        </div>

        {/* Template picker + preview */}
        <div className="px-8 py-3 border-t border-gray-100 bg-gray-50">
          <TemplatePicker quote={quote} onChange={onChange} />
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-8 py-4 flex flex-wrap gap-2 justify-end">
          {onEdit && (
            <button onClick={onEdit} className="text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg">Edit</button>
          )}
          <button onClick={handleCopyShareLink} className="text-sm border border-gray-200 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg">Copy Share Link</button>
          {quote.status !== 'SOLD' && quote.status !== 'LOST' && (
            <button onClick={() => setSendOpen(true)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium">Send to Customer</button>
          )}
          {quote.status !== 'LOST' && (
            <button onClick={handleMarkLost} className="text-sm text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg">Mark Lost</button>
          )}
          {quote.status !== 'SOLD' && (
            <button onClick={handleMarkSold} className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold">Mark as Sold</button>
          )}
        </div>

        {sendOpen && (
          <SendQuoteModal quote={quote} onClose={() => setSendOpen(false)}
            onSent={() => { setSendOpen(false); onChange?.() }} />
        )}
      </div>
    </div>
  )
}

// ── Template picker + preview ──

function TemplatePicker({ quote, onChange }: { quote: SavedQuote & QuotePresentation; onChange?: () => void }) {
  const [active, setActive] = useState<TemplateKey>(((quote as any).templateKey as TemplateKey) || getDefaultTemplateKey())
  const [previewOpen, setPreviewOpen] = useState(false)

  function saveTemplate(key: TemplateKey) {
    setActive(key)
    updateQuote(quote.id, { templateKey: key } as any)
    onChange?.()
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase text-gray-500 tracking-widest mb-1.5">Quote Template</p>
          <div className="flex gap-1.5 flex-wrap">
            {(Object.values(TEMPLATES)).map(t => (
              <button key={t.key} onClick={() => saveTemplate(t.key)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${active === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}
                title={t.description}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setPreviewOpen(true)}
          className="text-sm border border-gray-300 text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded-lg h-fit">
          Preview Quote
        </button>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex flex-col" onClick={() => setPreviewOpen(false)}>
          <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900">Preview — {TEMPLATES[active].name}</p>
            <div className="flex gap-2">
              {(Object.values(TEMPLATES)).map(t => (
                <button key={t.key} onClick={() => saveTemplate(t.key)}
                  className={`text-xs px-3 py-1.5 rounded-lg ${active === t.key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {t.name}
                </button>
              ))}
              <button onClick={() => setPreviewOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-gray-200" onClick={e => e.stopPropagation()}>
            <div className="bg-white my-4 mx-auto max-w-4xl shadow-xl">
              <QuoteTemplateRenderer quote={quote as any} template={TEMPLATES[active]} interactive={false} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Send Quote Modal ──

function SendQuoteModal({ quote, onClose, onSent }: { quote: SavedQuote; onClose: () => void; onSent: () => void }) {
  const tpl = getEmailTemplate('quote_sent')
  const share = ensureShareForQuote(quote.id)
  const shareUrl = `${window.location.origin}/#/quote/${share.token}`

  const company = useMemo(() => {
    try { const r = localStorage.getItem('fencepro_config'); if (r) return JSON.parse(r).company || {} } catch {}
    return {}
  }, [])

  const mergeData: Record<string, string> = {
    customer_name: quote.customerName,
    customer_first_name: quote.customerName?.split(' ')[0] || '',
    quote_number: `#${quote.id.slice(-6).toUpperCase()}`,
    quote_total: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(quote.finalPrice),
    quote_link: shareUrl,
    fence_style: quote.fenceStyle,
    rep_name: quote.salesRep || '',
    company_name: (company as any).name || 'EZBiz',
    company_phone: (company as any).phone || '',
  }
  const rendered = renderTemplate(tpl, mergeData)

  const [to, setTo] = useState(quote.customerEmail || '')
  const [subject, setSubject] = useState(rendered.subject)
  const [body, setBody] = useState(rendered.body)

  function handleSend() {
    if (!to.trim()) { toast.error('Enter a recipient email'); return }
    // In this local-storage build we don't have a live email service directly
    // from the browser. We mark the quote as SENT, stamp the share, and hand
    // off to the user's email client via mailto: if nothing else is configured.
    try {
      // Mark as SENT (only if currently DRAFT)
      const current = getQuoteById(quote.id)
      if (current && current.status === 'DRAFT') {
        updateQuote(quote.id, { status: 'SENT' })
      }
      stampSent(share.token, to)

      // Build mailto for a seamless handoff. Body is stripped of HTML for
      // mailto safety; customer still gets the live HTML link in their email.
      const plainBody = body.replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n\n')
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainBody)}`
      window.open(mailto, '_blank')

      toast.success('Quote marked as sent', 'Share link ready — opened your email client to complete the send.')
      onSent()
    } catch (err: any) {
      toast.error('Could not send', err?.message)
    }
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Send Quote to Customer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">To</label>
            <input value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              rows={10}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
            <p className="text-[11px] text-gray-400 mt-1">Template pulled from Admin → Settings → Email Templates · Share link: <code className="bg-gray-100 px-1">{shareUrl}</code></p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSend} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Send</button>
        </div>
      </div>
    </div>
  )
}
