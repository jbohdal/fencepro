/**
 * Messages tab for a customer profile (staff side).
 *
 * Server-backed via portalStaffApi. Auto-marks customer messages as read by
 * staff on first load. Polls every 15s for new messages while open.
 *
 * Part of the page (it scrolls with the customer page, no box of its own):
 * the newest messages, "Show earlier" for older ones, and the reply under them.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Messages shown at first, and per "Show earlier". */
const MESSAGES_PAGE = 30
import { toast } from './toast'
import {
  listCustomerMessages,
  staffReplyToCustomer,
  type PortalMessage,
} from './portalStaffApi'
import { currentUser } from './crmAuth'
import { getConfig } from './configStore'
import { portalSenderLabel } from './customerPage'

/**
 * `customerName`: shown on the customer's own messages. Replies are saved with
 * the signed in person's name (the server reads it from the sign in) and show
 * as "You" to them, by name to everyone else.
 */
export default function CustomerMessagesTab({ customerId, customerName }: { customerId: string; customerName: string }) {
  const me = (() => { const u = currentUser(); return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null : null })()
  const company = getConfig().company.name || ''
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  // One id per message typed: Send tapped twice, or sent again after an error, saves it once.
  const requestId = useRef(crypto.randomUUID())
  const inFlight = useRef(false)
  const initialLoad = useRef(true)
  const [limit, setLimit] = useState(MESSAGES_PAGE)

  const refresh = useCallback(async () => {
    const rows = await listCustomerMessages(customerId)
    setMessages(rows)
    setLoading(false)
    if (initialLoad.current) {
      initialLoad.current = false
      // Notify any global inbox badge to refresh
      try { window.dispatchEvent(new Event('fencepro:portal-messages:updated')) } catch {}
    }
  }, [customerId])

  useEffect(() => {
    initialLoad.current = true
    setLimit(MESSAGES_PAGE)
    setLoading(true)
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || sending || inFlight.current) return
    inFlight.current = true
    setSending(true)
    const r = await staffReplyToCustomer(customerId, body, me ?? undefined, requestId.current)
    inFlight.current = false
    setSending(false)
    if (!r.ok) {
      toast.error('Could not send message', r.error)
      return
    }
    setDraft('')
    requestId.current = crypto.randomUUID()
    await refresh()
    try { window.dispatchEvent(new Event('fencepro:portal-messages:updated')) } catch {}
  }

  return (
    <div className="flex flex-col bg-white rounded-2xl border border-gray-200 overflow-hidden" data-customer-messages>
      <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <p className="font-semibold text-gray-900 text-sm">Customer Portal Messages</p>
          <p className="text-xs text-gray-500">Conversations between this customer and your team</p>
        </div>
        <p className="text-xs text-gray-400">
          {loading ? 'Loading…' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-3 bg-gray-50">
        {messages.length > limit && (
          <button type="button" className="btn btn-quiet btn-sm w-full" data-show-more="messages" onClick={() => setLimit(l => l + MESSAGES_PAGE)}>
            Show {Math.min(MESSAGES_PAGE, messages.length - limit)} earlier <span className="font-normal text-gray-500">({limit} of {messages.length})</span>
          </button>
        )}
        {messages.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-400 text-sm">
            <p className="text-3xl mb-2">💬</p>
            <p>No messages yet. Start the conversation below.</p>
          </div>
        )}
        {messages.slice(-limit).map(m => {
          const isStaff = m.senderType === 'staff'
          return (
            <div key={m.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                isStaff
                  ? 'bg-orange-500 text-white rounded-br-md'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md'
              }`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-1 ${isStaff ? 'text-orange-100' : 'text-gray-500'}`} data-message-sender={portalSenderLabel(m, { me, customerName, company })}>
                  {portalSenderLabel(m, { me, customerName, company })}{' · '}
                  {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <form onSubmit={handleSend} className="border-t border-gray-200 bg-white px-4 py-3 flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Type a reply… (Enter to send, Shift+Enter for new line)"
          rows={2}
          className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="btn btn-primary"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
