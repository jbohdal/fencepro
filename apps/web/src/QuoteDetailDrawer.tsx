/**
 * Quote Detail Drawer — a slide-over panel that shows a full readable
 * view of a single saved quote + primary actions.
 *
 * Used from:
 *   - Customer profile Quotes tab (click a row)
 *   - Quotes list (any row)
 */

import { formatPhone } from './phoneFormat'
import { can } from './permissions'
import { styleLabel } from './fenceCatalog'
import { useEffect, useMemo, useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import { updateQuote, getQuoteById } from './quoteStore'
import { markQuoteSold, markQuoteLost } from './signedContractFlow'
import { issueShareToken } from './savedQuotesApi'
import { proposalUrl } from './proposal'
import { getEmailTemplate, renderTemplate } from './emailTemplatesStore'
import { toast } from './toast'
import { TEMPLATES, getDefaultTemplateKey, type TemplateKey, type QuotePresentation } from './quoteTemplatesStore'
import QuoteTemplateRenderer from './QuoteTemplateRenderer'
import RunSpacingTable from './RunSpacingTable'
import ProposalSend from './ProposalSend'
import QuotePlan, { quoteHasPlan } from './QuotePlan'
import MediaGallery from './MediaGallery'
import DollarPickets from './DollarPickets'
import { getConfig, overheadPctOf } from './configStore'
import { useBackLayer, BackClose } from './nav'
import { SaveStatus } from './SaveStatus'
import SignedDocuments from './SignedDocuments'

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
  quote: opened,
  onClose,
  onEdit,
  onChange,
  internalView: wantInternal = true,
}: {
  quote: SavedQuote
  onClose: () => void
  onEdit?: () => void
  onChange?: () => void
  internalView?: boolean
}) {
  // Costs, margin and the pull sheet's costs: the owner, admin, manager and office only (a Salesman's or Installer's copy has none).
  const internalView = wantInternal && can('costs.view')
  // The newest copy: a customer may accept online while this is open (it shows Sold then).
  const [, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener('fencepro:quotes:updated', h)
    return () => window.removeEventListener('fencepro:quotes:updated', h)
  }, [])
  const quote = (getQuoteById(opened.id) as SavedQuote | null) ?? opened
  const [sendOpen, setSendOpen] = useState(false)
  // Its own address (?qv=<quote>): Back closes it, a reload reopens it.
  useBackLayer(onClose, { key: 'qv', params: { qv: quote.id } })
  const status = STATUS_STYLES[quote.status]
  const totalFootage = useMemo(() => (quote.runs || []).reduce((a, b) => a + b, 0), [quote.runs])
  // The customer's link under the public door (/p/<link>): the proposal, or for a quote with none, the quote itself.
  const linkOpen = !!quote.shareToken && !quote.shareDisabledAt && !(quote.shareExpiresAt && new Date(quote.shareExpiresAt).getTime() < Date.now())
  const [madeUrl, setMadeUrl] = useState<string | null>(null)
  const shareUrl = madeUrl ?? (linkOpen ? proposalUrl(quote.shareToken!) : null)

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

  async function handleCopyShareLink() {
    const t = await issueShareToken(quote.id).catch(() => null)
    if (!t?.shareToken) { toast.error('Could not make the link. Check the connection and try again.'); return }
    const url = proposalUrl(t.shareToken)
    setMadeUrl(url)
    navigator.clipboard?.writeText(url).catch(() => {})
    toast.success('Link copied', url)
  }

  return (
    <div className="fixed inset-0 z-50 flex" data-quote-drawer>
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl h-full overflow-y-auto slideover-responsive">
        {/* Header */}
        <div className="px-8 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">Quote #{quote.id.slice(-6).toUpperCase()}</h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.text}`}>{status.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">{quote.customerName} · {quote.date}</p>
          </div>
          <SaveStatus keys={[`quote:${quote.id}`]} />
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>

        <div className="px-8 py-6 space-y-6">
          {/* Top price bar */}
          <div className="bg-gradient-to-r from-orange-50 to-white rounded-2xl border border-orange-100 p-6 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold text-orange-600">Quote Price</p>
              <p className="text-4xl font-black text-gray-900 mt-2">{fmt0(quote.finalPrice)}</p>
              <p className="text-xs text-gray-500 mt-1">{styleLabel(quote.fenceStyle)}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-gray-500">{totalFootage} ft total</p>
              <p className="text-gray-500">{quote.sections} sections</p>
              {internalView && <p className={`mt-1 font-semibold ${quote.gmPct >= 0.34 ? 'text-green-700' : quote.gmPct >= 0.27 ? 'text-yellow-600' : 'text-red-600'}`}>{fmtPct(quote.gmPct)} margin</p>}
            </div>
          </div>

          {/* Customer block */}
          <section>
            <p className="text-xs font-bold text-gray-400 mb-2">Customer</p>
            <div className="bg-gray-50 rounded-xl p-4 text-sm">
              <p className="font-semibold text-gray-900">{quote.customerName}</p>
              <p className="text-gray-500">{quote.customerAddress || '—'}</p>
              <p className="text-gray-500">{[formatPhone(quote.customerPhone), quote.customerEmail].filter(Boolean).join(' · ')}</p>
            </div>
          </section>


          {internalView && (
            <section>
              <p className="text-xs font-bold text-gray-500 mb-2">Proposal</p>
              <ProposalSend quote={quote} />
            </section>
          )}

          {quoteHasPlan(quote) && (
            <section>
              <p className="text-xs font-bold text-gray-500 mb-2">Site plan</p>
              <QuotePlan quote={quote} style={getConfig().fenceStyles.find(s => s.name === quote.fenceStyle)} caption={false} />
            </section>
          )}

          {/* Internal: where every dollar of this quote goes */}
          {quote.finalPrice > 0 && quote.totalCOGS > 0 && (() => {
            const cfg = getConfig()
            const pct = typeof quote.pricing?.commissionPct === 'number' ? quote.pricing.commissionPct : (quote.hasSalesman ? cfg.pricing.commissionSalesman : cfg.pricing.commissionNonSalesman) ?? 0
            // Rounded to the whole dollar: commission and overhead stay on the price before rounding (the cents are out of profit).
            const rounding = typeof quote.pricing?.roundingCents === 'number' ? quote.pricing.roundingCents : 0
            // The ± dollar adjustment is out of profit too: commission and overhead stay on the price before it.
            const adj = typeof quote.pricing?.priceAdjustmentCents === 'number' ? quote.pricing.priceAdjustmentCents : 0
            return <DollarPickets price={quote.finalPrice} materials={quote.materialCost} labor={(quote.laborCost || 0) + (quote.tearOutCost || 0)}
              commission={(quote.finalPrice + rounding / 100 - adj / 100) * pct} overheadPct={typeof quote.pricing?.overheadPct === 'number' ? quote.pricing.overheadPct : overheadPctOf(cfg)} roundingCents={rounding} adjustmentCents={adj} />
          })()}

          {/* Photos and video taken for this quote (site walk, gate location, ...) */}
          <section data-quote-photos>
            <MediaGallery where={{ quoteKey: quote.id, customerId: quote.customerId }} layout={quote.layout?.yard ?? null} />
          </section>

          {/* Runs, with the post spacing the crew sets */}
          {(quote.runs || []).length > 0 && (
            <section>
              <p className="text-xs font-bold text-gray-500 mb-2">Runs</p>
              <RunSpacingTable quote={quote} />
            </section>
          )}

          {/* Gates + corners */}
          <section className="grid grid-cols-4 gap-3 text-sm">
            <div><p className="text-[10px] text-gray-400 font-bold">Corners</p><p className="font-medium text-gray-900">{quote.corners}</p></div>
            <div><p className="text-[10px] text-gray-400 font-bold">Ends</p><p className="font-medium text-gray-900">{quote.ends}</p></div>
            <div><p className="text-[10px] text-gray-400 font-bold">Walk gates</p><p className="font-medium text-gray-900">{quote.walkGates}</p></div>
            <div><p className="text-[10px] text-gray-400 font-bold">Double gates</p><p className="font-medium text-gray-900">{quote.dblGates}</p></div>
          </section>

          {/* Internal pricing breakdown */}
          {internalView && (
            <section>
              <p className="text-xs font-bold text-gray-400 mb-2">Pricing (Internal)</p>
              <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Material cost</span><span>{fmt(quote.materialCost)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Labor cost</span><span>{fmt(quote.laborCost)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Tear out</span><span>{fmt(quote.tearOutCost)}</span></div>
                <div className="flex justify-between font-semibold border-t border-gray-200 pt-1 mt-1"><span>Total cost</span><span>{fmt(quote.totalCOGS)}</span></div>
                <div className="flex justify-between font-bold text-orange-700 border-t border-gray-200 pt-1 mt-1"><span>Quote Price</span><span>{fmt(quote.finalPrice)}</span></div>
                <div className="flex justify-between pt-1 text-xs text-gray-500"><span>Gross Margin</span><span>{fmtPct(quote.gmPct)}</span></div>
              </div>
            </section>
          )}

          {/* Pull sheet (internal) */}
          {internalView && quote.pullSheet?.length > 0 && (
            <section>
              <p className="text-xs font-bold text-gray-400 mb-2">Pull Sheet</p>
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
              <p className="text-xs font-bold text-gray-400 mb-2">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
            </section>
          )}

          {shareUrl && (
            <section className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-xs font-bold text-blue-700">Customer Share Link</p>
              <p className="text-xs font-mono text-blue-900 mt-1 break-all">{shareUrl}</p>
            </section>
          )}

          {/* The signed contract and signed change orders, as stored at signing (SignedDocuments.tsx). */}
          {quote.acceptedAt && <SignedDocuments which={{ quoteId: quote.id }} heading="Signed documents" />}
        </div>

        {/* Template picker + preview */}
        <div className="px-8 py-3 border-t border-gray-100 bg-gray-50">
          <TemplatePicker quote={quote} onChange={onChange} />
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-8 py-4 flex flex-wrap gap-2 justify-end">
          {onEdit && (
            <button onClick={onEdit} className="btn btn-secondary">Edit</button>
          )}
          {/* Quotes with a proposal are sent with its own link above; the old share link only for older quotes. */}
          {!quote.proposal && <button onClick={handleCopyShareLink} className="btn btn-secondary">Copy Share Link</button>}
          {!quote.proposal && quote.status !== 'SOLD' && quote.status !== 'LOST' && (
            <button onClick={() => setSendOpen(true)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium">Send to Customer</button>
          )}
          {/* Not offered once the customer has accepted and signed. */}
          {quote.status !== 'LOST' && !quote.acceptedAt && (
            <button onClick={handleMarkLost} className="text-sm text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg">Mark Lost</button>
          )}
          {quote.status !== 'SOLD' && (
            <button onClick={handleMarkSold} className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold">Mark as Sold</button>
          )}
        </div>

        {sendOpen && <BackClose name="send-quote" onClose={() => setSendOpen(false)} />}
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
          <p className="text-[10px] font-bold text-gray-500 mb-1.5">Quote Template</p>
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
          className="btn btn-secondary">
          Preview Quote
        </button>
      </div>

      {previewOpen && <BackClose name="quote-preview" onClose={() => setPreviewOpen(false)} />}
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
              <button onClick={() => setPreviewOpen(false)} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
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
  // The customer's link under the public door (/p/<link>), made (or reused while it works) on the server.
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [linkError, setLinkError] = useState(false)
  useEffect(() => {
    let live = true
    issueShareToken(quote.id).then(t => { if (!live) return; if (t?.shareToken) setShareUrl(proposalUrl(t.shareToken)); else setLinkError(true) }).catch(() => { if (live) setLinkError(true) })
    return () => { live = false }
  }, [quote.id])
  if (shareUrl) return <SendQuoteForm quote={quote} shareUrl={shareUrl} onClose={onClose} onSent={onSent} />
  return (
    <div className="fixed inset-0 z-60 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3" data-send-quote-link>
        <p className="text-sm text-gray-800">{linkError ? 'Could not make the customer link. Check the connection and try again.' : 'Making the customer link…'}</p>
        <div className="flex justify-end"><button onClick={onClose} className="btn btn-secondary">Close</button></div>
      </div>
    </div>
  )
}

function SendQuoteForm({ quote, shareUrl, onClose, onSent }: { quote: SavedQuote; shareUrl: string; onClose: () => void; onSent: () => void }) {
  const tpl = getEmailTemplate('quote_sent')

  const company = useMemo((): any => getConfig().company || {}, [])

  const mergeData: Record<string, string> = {
    customer_name: quote.customerName,
    customer_first_name: quote.customerName?.split(' ')[0] || '',
    quote_number: `#${quote.id.slice(-6).toUpperCase()}`,
    quote_total: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(quote.finalPrice),
    quote_link: shareUrl,
    fence_style: styleLabel(quote.fenceStyle),
    rep_name: quote.salesRep || '',
    company_name: (company as any).name || 'Getter Done Fence',
    company_phone: (company as any).phone || '',
  }
  const rendered = renderTemplate(tpl, mergeData)

  const [to, setTo] = useState(quote.customerEmail || '')
  const [subject, setSubject] = useState(rendered.subject)
  const [body, setBody] = useState(rendered.body)

  function handleSend() {
    if (!to.trim()) { toast.error('Enter a recipient email'); return }
    // In this local-storage build we don't have a live email service directly
    // from the browser. We mark the quote as SENT and hand
    // off to the user's email client via mailto: if nothing else is configured.
    try {
      // Mark as SENT (only if currently DRAFT)
      const current = getQuoteById(quote.id)
      if (current && current.status === 'DRAFT') {
        updateQuote(quote.id, { status: 'SENT' })
      }

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Send Quote to Customer</h3>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">To</label>
            <input value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)}
              rows={10}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono" />
            <p className="text-[11px] text-gray-400 mt-1">Template pulled from Admin → Settings → Email Templates · Share link: <code className="bg-gray-100 px-1">{shareUrl}</code></p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSend} className="btn btn-primary">Send</button>
        </div>
      </div>
    </div>
  )
}
