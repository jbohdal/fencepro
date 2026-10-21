/**
 * The customer's answer to texts, on the customer page: "Texts: Yes, verbal,
 * recorded by Christa on Oct 21" / "No" / "Not asked", with Record yes
 * (verbal) and Record no. Read from the server each time the customer opens
 * and saved there (with who and when; every answer is kept in the history).
 * The app texts only a yes (apps/portal/src/server/lib/textConsent.ts).
 */

import { useCallback, useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { fetchWithAuth } from './crmAuth'
import { API_ORIGIN } from './syncHttp'
import { plainError, plainThrown } from './plainError'
import { toast } from './toast'
import { describeTextConsent, asTextConsent, type TextConsentState } from '../../portal/src/server/lib/textConsentModel'

interface ConsentEvent { id: string; consent: 'yes' | 'no'; source: string; byName: string; at: string; wording: string | null }
type ConsentData = TextConsentState & { history: ConsentEvent[] }

async function call(method: 'GET' | 'POST', customerId: string, body?: unknown): Promise<ConsentData> {
  try {
    const res = await fetchWithAuth(`${API_ORIGIN}/api/crm-contacts/${encodeURIComponent(customerId)}/text-consent`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) throw new Error(plainError(res.status, json?.error).message)
    return json.data as ConsentData
  } catch (err) {
    throw new Error(plainThrown(err).message)
  }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const COLOR = { yes: 'bg-green-100 text-green-800 border-green-200', no: 'bg-red-50 text-red-800 border-red-200', unknown: 'bg-gray-100 text-gray-700 border-gray-200' }

export default function TextConsent({ customerId }: { customerId: string }) {
  const [data, setData] = useState<ConsentData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    try { setData(await call('GET', customerId)); setError('') }
    catch (err) { setError((err as Error).message) }
  }, [customerId])
  useEffect(() => { setData(null); setShowHistory(false); void load() }, [load])

  async function record(consent: 'yes' | 'no') {
    setBusy(true)
    try {
      setData(await call('POST', customerId, { consent }))
      toast.success(consent === 'yes' ? 'Texts: Yes recorded' : 'Texts: No recorded')
    } catch (err) { toast.error('Could not save the texting answer', (err as Error).message) }
    finally { setBusy(false) }
  }

  const consent = asTextConsent(data?.textConsent)
  return (
    <div className="mt-2" data-text-consent={data ? consent : 'loading'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-2 py-1 ${COLOR[consent]}`} data-text-consent-state>
          <MessageSquare size={12} aria-hidden="true" />
          Texts: {data ? describeTextConsent(data) : error ? 'could not load' : '…'}
        </span>
        {data && consent !== 'yes' && <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy} onClick={() => record('yes')} data-text-consent-yes>Record yes (verbal)</button>}
        {data && consent !== 'no' && <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" disabled={busy} onClick={() => record('no')} data-text-consent-no>Record no</button>}
        {data && data.history.length > 0 && <button type="button" className="text-xs text-gray-600 underline min-h-[44px]" onClick={() => setShowHistory(s => !s)} data-text-consent-history-toggle>{showHistory ? 'Hide history' : `History (${data.history.length})`}</button>}
        {error && <button type="button" className="text-xs text-gray-600 underline min-h-[44px]" onClick={() => void load()}>Try again</button>}
      </div>
      {showHistory && data && (
        <ol className="mt-1 space-y-1 text-xs text-gray-700" data-text-consent-history>
          {data.history.map(h => (
            <li key={h.id} data-text-consent-event={h.consent}>
              <span className="font-semibold">{h.consent === 'yes' ? 'Yes' : 'No'}</span>
              {' · '}{h.source === 'website_checkbox' ? `website checkbox ${h.consent === 'yes' ? 'checked' : 'left unchecked'}` : `verbal, recorded by ${h.byName}`}
              {' · '}{when(h.at)}
              {h.wording && <span className="block text-gray-500">"{h.wording}"</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
