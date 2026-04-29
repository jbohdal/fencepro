/**
 * Messages tab for a customer profile (staff side).
 *
 * Server-backed via portalApiClient. Auto-marks customer messages as read by
 * staff on first load. Polls every 15s for new messages while open.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from './toast'
import {
  listCustomerMessages,
  staffReplyToCustomer,
  type PortalMessage,
} from './portalApiClient'

export default function CustomerMessagesTab({ customerId, sender }: { customerId: string; sender: string }) {
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const initialLoad = useRef(true)

  const refresh = useCallback(async () => {
    const rows = await listCustomerMessages(customerId)
    setMessages(rows)
    setLoading(false)
    if (initialLoad.current) {
      initialLoad.current = false
      requestAnimationFrame(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
      })
      // Notify any global inbox badge to refresh
      try { window.dispatchEvent(new Event('fencepro:portal-messages:updated')) } catch {}
    }
  }, [customerId])

  useEffect(() => {
    initialLoad.current = true
    setLoading(true)
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    const r = await staffReplyToCustomer(customerId, body, sender)
    setSending(false)
    if (!r.ok) {
      toast.error('Could not send message', r.error)
      return
    }
    setDraft('')
    await refresh()
    requestAnimationFrame(() => {
      if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    })
    try { window.dispatchEvent(new Event('fencepro:portal-messages:updated')) } catch {}
  }

  return (
    <div className="flex flex-col h-[calc(100vh-340px)] bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <div>
          <p className="font-semibold text-gray-900 text-sm">Customer Portal Messages</p>
          <p className="text-xs text-gray-500">Conversations between this customer and your team</p>
        </div>
        <p className="text-xs text-gray-400">
          {loading ? 'Loading…' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50">
        {messages.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-400 text-sm">
            <p className="text-3xl mb-2">💬</p>
            <p>No messages yet. Start the conversation below.</p>
          </div>
        )}
        {messages.map(m => {
          const isStaff = m.senderType === 'staff'
          return (
            <div key={m.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                isStaff
                  ? 'bg-orange-500 text-white rounded-br-md'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-md'
              }`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-1 ${isStaff ? 'text-orange-100' : 'text-gray-400'}`}>
                  {isStaff ? (m.senderUser ? `${m.senderUser} · ` : '') : 'Customer · '}
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
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold px-5 rounded-xl"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
