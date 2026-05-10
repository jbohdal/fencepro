import { useState, useEffect, useCallback } from 'react'
import { getPortalActivity } from './portalSync'

interface PortalTicket {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  commentCount: number
  latestComment?: { authorName: string; body: string; createdAt: string } | null
}

interface PortalDocument {
  id: string
  filename: string
  uploadedBy: string
  uploadedAt: string
  mimeType?: string
  sizeBytes?: number
}

interface PortalChat {
  id: string
  customerName: string
  status: string
  ticketId?: string
  messageCount: number
  lastMessages: { role: string; body: string; createdAt: string }[]
  updatedAt: string
}

interface PortalActivityItem {
  action: string
  user: string
  timestamp: string
}

const POLL_INTERVAL = 30_000 // 30 seconds

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_customer: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-gray-100 text-gray-600',
  closed: 'bg-gray-100 text-gray-400',
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-400',
  low: 'bg-gray-300',
}

export default function PortalInbox() {
  const [tickets, setTickets] = useState<PortalTicket[]>([])
  const [documents, setDocuments] = useState<PortalDocument[]>([])
  const [chats, setChats] = useState<PortalChat[]>([])
  const [activity, setActivity] = useState<PortalActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [connected, setConnected] = useState(false)
  const [tab, setTab] = useState<'tickets' | 'documents' | 'chats' | 'activity'>('tickets')

  const fetchData = useCallback(async () => {
    try {
      const data = await getPortalActivity()
      if (data) {
        setTickets(data.tickets)
        setDocuments(data.documents)
        setChats(data.chats || [])
        setActivity(data.recentActivity)
        setConnected(true)
        setLastUpdated(new Date())
      } else {
        setConnected(false)
      }
    } catch {
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + polling
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData])

  const openTickets = tickets.filter(t => t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting_customer')
  const newDocs = documents.filter(d => {
    const age = Date.now() - new Date(d.uploadedAt).getTime()
    return age < 24 * 60 * 60 * 1000 // last 24 hours
  })

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Customer Portal</h2>
          <p className="text-sm text-gray-400 mt-0.5">Live view of customer portal activity</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-600' : 'text-red-500'}`}>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
            {connected ? 'Connected' : 'Portal offline'}
          </div>
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchData} className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Open Tickets</p>
          <p className={`text-2xl font-bold mt-1 ${openTickets.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>{openTickets.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Total Tickets</p>
          <p className="text-2xl font-bold mt-1 text-gray-900">{tickets.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Documents</p>
          <p className="text-2xl font-bold mt-1 text-blue-600">{documents.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">New Today</p>
          <p className={`text-2xl font-bold mt-1 ${newDocs.length > 0 ? 'text-orange-600' : 'text-gray-300'}`}>{newDocs.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {([
          { key: 'tickets' as const, label: `Tickets (${tickets.length})`, icon: '🎫' },
          { key: 'chats' as const, label: `Chats (${chats.length})`, icon: '💬' },
          { key: 'documents' as const, label: `Documents (${documents.length})`, icon: '📁' },
          { key: 'activity' as const, label: 'Activity Log', icon: '📋' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading portal data...</div>
      ) : !connected ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
          <p className="text-4xl mb-3">🔌</p>
          <p className="text-gray-500 text-lg font-medium">Portal not connected</p>
          <p className="text-gray-400 text-sm mt-1">Start the portal server to see customer activity</p>
          <p className="text-gray-300 text-xs mt-3 font-mono">cd apps/portal && pnpm dev</p>
        </div>
      ) : (
        <>
          {/* Tickets tab */}
          {tab === 'tickets' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {tickets.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 text-sm">No tickets from customers yet</div>
              ) : (
                <table className="w-full text-sm table-responsive-cards">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-4" />
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Subject</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Status</th>
                      <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-16">Replies</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tickets.map(t => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td data-label="Priority" className="px-5 py-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} title={t.priority} />
                        </td>
                        <td data-label="Subject" className="px-3 py-3">
                          <p className="font-medium text-gray-900">{t.title}</p>
                          {t.latestComment && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-md">
                              {t.latestComment.authorName}: {t.latestComment.body}
                            </p>
                          )}
                        </td>
                        <td data-label="Status" className="px-3 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[t.status] || 'bg-gray-100'}`}>
                            {t.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td data-label="Replies" className="px-3 py-3 text-right text-xs text-gray-500">{t.commentCount}</td>
                        <td data-label="Created" className="px-5 py-3 text-right text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Documents tab */}
          {tab === 'documents' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {documents.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 text-sm">No customer uploads yet</div>
              ) : (
                <table className="w-full text-sm table-responsive-cards">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">File</th>
                      <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-36">Uploaded By</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {documents.map(d => {
                      const isNew = Date.now() - new Date(d.uploadedAt).getTime() < 24 * 60 * 60 * 1000
                      return (
                        <tr key={d.id} className={`hover:bg-gray-50 ${isNew ? 'bg-orange-50/30' : ''}`}>
                          <td data-label="File" className="px-5 py-3 flex items-center gap-2">
                            <span>📄</span>
                            <span className="font-medium text-gray-900">{d.filename}</span>
                            {isNew && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold">NEW</span>}
                          </td>
                          <td data-label="Uploaded By" className="px-3 py-3 text-gray-600">{d.uploadedBy}</td>
                          <td data-label="Date" className="px-5 py-3 text-right text-xs text-gray-400">{new Date(d.uploadedAt).toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Chats tab */}
          {tab === 'chats' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {chats.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 text-sm">No chat conversations yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {chats.map(c => {
                    const isActive = c.status === 'active'
                    const isEscalated = c.status === 'escalated'
                    return (
                      <div key={c.id} className={`px-6 py-4 ${isActive ? 'bg-orange-50/30' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900">{c.customerName}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                              isActive ? 'bg-green-100 text-green-700' :
                              isEscalated ? 'bg-red-100 text-red-600' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {c.status}
                            </span>
                            {isEscalated && <span className="text-[10px] text-red-500">→ Ticket created</span>}
                          </div>
                          <span className="text-xs text-gray-400">{new Date(c.updatedAt).toLocaleString()}</span>
                        </div>
                        {/* Show last messages as a mini thread */}
                        <div className="space-y-1 ml-2 border-l-2 border-gray-100 pl-3">
                          {[...c.lastMessages].reverse().map((m, i) => (
                            <div key={i} className="text-xs">
                              <span className={`font-semibold ${m.role === 'customer' ? 'text-orange-600' : m.role === 'agent' ? 'text-blue-600' : 'text-gray-500'}`}>
                                {m.role === 'customer' ? 'Customer' : m.role === 'agent' ? 'Agent' : 'AI'}:
                              </span>{' '}
                              <span className="text-gray-600">{m.body}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Activity log tab */}
          {tab === 'activity' && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {activity.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 text-sm">No recent activity</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {activity.map((a, i) => (
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-900">
                          <span className="font-medium">{a.user}</span>
                          <span className="text-gray-400"> — </span>
                          <span className="text-gray-600">{a.action.replace('_', ' ')}</span>
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
