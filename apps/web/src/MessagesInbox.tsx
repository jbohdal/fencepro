/**
 * Global Messages inbox dropdown — sits next to the notification bell in the
 * top nav. Polls /api/portal/messages/inbox every 30s. Clicking a thread
 * navigates to the customer's Messages tab.
 */

import { useEffect, useRef, useState } from 'react'
import { getMessagesInbox, type InboxThread } from './portalApiClient'
import { getCustomerById } from './customerStore'

const POLL_MS = 30_000

function lookupCustomerName(id: string): string {
  const c = getCustomerById(id)
  if (!c) return id.slice(0, 8)
  return `${c.firstName || ''} ${c.lastName || ''}`.trim() || id.slice(0, 8)
}

export default function MessagesInbox({ onNavigateToCustomer }: { onNavigateToCustomer: (customerId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [threads, setThreads] = useState<InboxThread[]>([])
  const [totalUnread, setTotalUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  async function load() {
    try {
      setLoading(true)
      const data = await getMessagesInbox()
      setThreads(data.threads || [])
      setTotalUnread(data.totalUnread || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    function refresh() { load() }
    window.addEventListener('fencepro:portal-messages:updated', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('fencepro:portal-messages:updated', refresh)
    }
  }, [])

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!dropdownRef.current) return
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [open])

  function handleThreadClick(t: InboxThread) {
    setOpen(false)
    onNavigateToCustomer(t.crmCustomerId)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button onClick={() => setOpen(o => !o)}
        className="relative text-gray-500 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        title="Customer messages">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[480px] bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Customer Messages</p>
              <p className="text-[10px] text-gray-400">
                {totalUnread > 0 ? `${totalUnread} unread from ${threads.filter(t => t.unreadCustomerCount > 0).length} customer${threads.filter(t => t.unreadCustomerCount > 0).length === 1 ? '' : 's'}` : 'All caught up'}
              </p>
            </div>
            <button onClick={() => load()} className="text-xs text-orange-600 hover:underline">Refresh</button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {loading && threads.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No portal messages yet.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {threads.map(t => {
                  const name = lookupCustomerName(t.crmCustomerId)
                  const isUnread = t.unreadCustomerCount > 0
                  return (
                    <button key={t.crmCustomerId} onClick={() => handleThreadClick(t)}
                      className={`block w-full text-left px-4 py-3 transition-colors ${isUnread ? 'bg-orange-50 hover:bg-orange-100' : 'bg-white hover:bg-gray-50'}`}>
                      <div className="flex items-start gap-2">
                        {isUnread && <span className="w-2 h-2 bg-orange-500 rounded-full mt-1.5 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className={`text-sm truncate ${isUnread ? 'text-gray-900 font-semibold' : 'text-gray-700 font-medium'}`}>{name}</p>
                            <p className="text-[10px] text-gray-400 shrink-0">{new Date(t.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                          </div>
                          <p className={`text-xs mt-0.5 line-clamp-2 ${isUnread ? 'text-gray-700' : 'text-gray-500'}`}>
                            <span className="text-gray-400">{t.lastSender === 'staff' ? 'You: ' : ''}</span>
                            {t.lastBody}
                          </p>
                          {isUnread && (
                            <span className="inline-block mt-1 text-[10px] bg-orange-500 text-white font-semibold rounded-full px-1.5 py-0.5">
                              {t.unreadCustomerCount} new
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
