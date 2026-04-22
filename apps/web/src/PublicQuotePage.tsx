/**
 * Public customer-facing quote page.
 *
 * Route: /#/quote/:token
 *
 * Shows a branded, mobile-friendly view of the quote for acceptance.
 * No internal cost data — only price, footage, gate summary, features.
 * If the quote has QuoteOptions (Good/Better/Best), they are displayed
 * as side-by-side comparison cards; otherwise the single quote is shown.
 */

import { useEffect, useMemo, useState } from 'react'
import type { SavedQuote } from './QuotesPage'
import { getShareByToken, stampAccepted, addChangeRequest } from './quoteShareStore'
import { getOptionsForQuote } from './bundleStore'
import { CustomerPresentationContent } from './QuoteOptionsPanel'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function loadCompanyInfo() {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (!r) return { name: 'FencePro', phone: '', email: '', address: '' }
    const cfg = JSON.parse(r)
    return cfg.company || { name: 'FencePro' }
  } catch { return { name: 'FencePro' } }
}

function loadQuote(quoteId: string): SavedQuote | null {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    if (!raw) return null
    const all: SavedQuote[] = JSON.parse(raw)
    return all.find(q => q.id === quoteId) || null
  } catch { return null }
}

export default function PublicQuotePage({ token }: { token: string }) {
  const [quote, setQuote] = useState<SavedQuote | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const [changeRequestBody, setChangeRequestBody] = useState('')
  const [acceptName, setAcceptName] = useState('')
  const [acceptSignature, setAcceptSignature] = useState('')
  const [loading, setLoading] = useState(true)
  const company = loadCompanyInfo()

  useEffect(() => {
    const share = getShareByToken(token)
    if (!share) { setLoading(false); return }
    const q = loadQuote(share.quoteId)
    setQuote(q)
    setAccepted(!!share.acceptedAt)
    setLoading(false)
  }, [token])

  const options = useMemo(() => quote ? getOptionsForQuote(quote.id) : [], [quote])

  function handleAccept() {
    if (!acceptName.trim() || !acceptSignature.trim()) return
    stampAccepted(token, acceptName.trim(), acceptSignature.trim())
    setAccepted(true)
  }

  function submitChangeRequest() {
    if (!changeRequestBody.trim()) return
    addChangeRequest(token, changeRequestBody.trim())
    setChangeRequestBody('')
    setChangeRequestOpen(false)
    alert('Thanks! Your message was sent to the team.')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
        <div className="text-center max-w-md">
          <p className="text-4xl mb-2">🔗</p>
          <h1 className="text-xl font-bold text-gray-900">Quote link expired</h1>
          <p className="text-sm text-gray-500 mt-2">Please contact {company.name} for a new quote link.</p>
        </div>
      </div>
    )
  }

  const totalFootage = (quote.runs || []).reduce((s, n) => s + n, 0)
  const sectionCount = quote.sections || 0
  const gateSummary = [
    quote.walkGates ? `${quote.walkGates} walk gate${quote.walkGates === 1 ? '' : 's'}` : '',
    quote.dblGates ? `${quote.dblGates} double gate${quote.dblGates === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') || 'No gates'

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{company.name}</h1>
            {company.phone && <p className="text-xs text-gray-500 mt-0.5">{company.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-widest">Quote</p>
            <p className="text-sm font-semibold text-gray-700">#{quote.id.slice(-6).toUpperCase()}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* Hero */}
        <section>
          <p className="text-xs uppercase font-bold tracking-widest text-orange-500">Your Personalized Quote</p>
          <h2 className="text-3xl font-bold text-gray-900 mt-2">Hi {quote.customerName?.split(' ')[0] || 'there'},</h2>
          <p className="text-gray-600 mt-2 max-w-2xl">Thanks for letting {company.name} help with your fence project. Below is a breakdown of what we discussed for <strong>{quote.customerAddress || 'your property'}</strong>. Take your time — and when you're ready, just tap Accept.</p>
        </section>

        {/* Options — Good / Better / Best if present */}
        {options.length > 1 ? (
          <section>
            <h3 className="font-bold text-gray-900 mb-4 text-lg">Choose the option that's right for you</h3>
            <CustomerPresentationContent options={options} quoteId={quote.id} readOnly />
          </section>
        ) : (
          <section className="bg-white rounded-3xl border border-gray-200 shadow-md p-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-6 border-b border-gray-100">
              <div>
                <p className="text-sm text-gray-500">{quote.fenceStyle}</p>
                <p className="text-4xl font-black text-gray-900 mt-2">{fmt(quote.finalPrice || 0)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase">Footage</p>
                <p className="text-xl font-bold text-gray-900">{totalFootage} ft</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wide">Style</p>
                <p className="text-gray-800 mt-1">{quote.fenceStyle}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wide">Sections</p>
                <p className="text-gray-800 mt-1">{sectionCount}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wide">Gates</p>
                <p className="text-gray-800 mt-1">{gateSummary}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wide">Runs</p>
                <p className="text-gray-800 mt-1">{(quote.runs || []).filter(r => r > 0).length}</p>
              </div>
            </div>
          </section>
        )}

        {/* Run breakdown */}
        {(quote.runs || []).filter(r => r > 0).length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-3">Run Breakdown</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {(quote.runs || []).filter(r => r > 0).map((ft, i) => (
                <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Run {i + 1}</p>
                  <p className="text-gray-800 font-semibold">{ft} ft</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Action */}
        {accepted ? (
          <section className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
            <p className="text-5xl mb-2">✓</p>
            <h3 className="text-xl font-bold text-green-900">Quote Accepted</h3>
            <p className="text-sm text-green-700 mt-1">Thanks! Your {company.name} rep will be in touch to confirm next steps.</p>
          </section>
        ) : options.length <= 1 ? (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-4">Ready to accept?</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Full name</label>
                <input value={acceptName} onChange={e => setAcceptName(e.target.value)}
                  placeholder="Type your full name"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Signature (type your initials or full signature)</label>
                <input value={acceptSignature} onChange={e => setAcceptSignature(e.target.value)}
                  placeholder="Your signature"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-serif text-lg italic" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button onClick={handleAccept} disabled={!acceptName.trim() || !acceptSignature.trim()}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl transition-colors">
                  Accept Quote — {fmt(quote.finalPrice || 0)}
                </button>
                <button onClick={() => setChangeRequestOpen(true)}
                  className="flex-1 border border-gray-300 text-gray-700 font-semibold py-3 rounded-xl hover:bg-gray-50">
                  Request Changes
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {changeRequestOpen && (
          <section className="bg-white rounded-2xl border border-gray-200 p-6">
            <h3 className="font-bold text-gray-900 mb-3">Request Changes</h3>
            <textarea value={changeRequestBody} onChange={e => setChangeRequestBody(e.target.value)}
              rows={4} placeholder="What changes would you like?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setChangeRequestOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={submitChangeRequest} disabled={!changeRequestBody.trim()}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold px-4 py-2 rounded-lg text-sm">Send</button>
            </div>
          </section>
        )}
      </main>

      <footer className="max-w-4xl mx-auto px-6 py-10 text-center text-xs text-gray-400 border-t border-gray-100 mt-10">
        <p>Quote valid for 30 days from issue date.</p>
        <p className="mt-1">Questions? Contact {company.name}{company.phone ? ` at ${company.phone}` : ''}.</p>
      </footer>
    </div>
  )
}
