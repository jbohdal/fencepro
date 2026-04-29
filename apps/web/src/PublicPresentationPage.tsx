/**
 * Public presentation page for a customer — reached via a share token.
 * Renders only option cards. No internal cost or margin data exposed.
 *
 * Route: /#/present/:token
 */

import { useEffect, useState } from 'react'
import { getOptionByShareToken, updateOption, type QuoteOption } from './bundleStore'
import { CustomerPresentationContent } from './QuoteOptionsPanel'

function loadCompanyName(): string {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (raw) { const c = JSON.parse(raw); return c.company?.name || 'EZBiz' }
  } catch {}
  return 'EZBiz'
}

export default function PublicPresentationPage({ token }: { token: string }) {
  const [options, setOptions] = useState<QuoteOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const companyName = loadCompanyName()

  useEffect(() => {
    const opts = getOptionByShareToken(token)
    setOptions(opts)
    setLoaded(true)
  }, [token])

  if (!loaded) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Loading…</div>

  if (options.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <p className="text-4xl mb-3">🔗</p>
          <h1 className="text-xl font-bold text-gray-900">Link not found or expired</h1>
          <p className="text-sm text-gray-500 mt-2">Please contact {companyName} for a new quote link.</p>
        </div>
      </div>
    )
  }

  const quoteId = options[0].quoteId

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white">
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-8 py-5">
          <h1 className="text-2xl font-bold text-gray-900">{companyName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your personalized fence quote — choose the option that works best for your home.</p>
        </div>
      </div>
      <div className="py-12 px-8">
        <CustomerPresentationContent options={options} quoteId={quoteId} />
      </div>
      <footer className="max-w-6xl mx-auto px-8 py-8 text-center text-xs text-gray-400 border-t border-gray-100 mt-12">
        Powered by EZBiz · Questions? Contact {companyName}.
      </footer>
    </div>
  )
}
