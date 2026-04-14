import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { TicketSummary, TicketDetail, TicketCommentView, PaginatedResponse } from '../../types/index'

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  waiting_customer: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-gray-100 text-gray-600',
  closed: 'bg-gray-100 text-gray-400',
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-400',
  medium: 'text-blue-600',
  high: 'text-orange-600',
  urgent: 'text-red-600',
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get<PaginatedResponse<TicketSummary>>(`/tickets?status=${statusFilter}`)
      .then(d => { setTickets(d.items); setTotal(d.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    api.get<TicketDetail>(`/tickets/${selectedId}`).then(setDetail).catch(() => setDetail(null))
  }, [selectedId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="waiting_customer">Waiting on Me</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
          <span className="text-xs text-gray-400">{total} tickets</span>
        </div>
        <button onClick={() => setShowCreate(true)} className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-4 py-2 rounded-lg">
          + New Ticket
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No tickets found</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Title</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-32">Status</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Priority</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tickets.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedId(t.id)}>
                  <td className="px-5 py-3 font-medium text-gray-900">{t.title}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[t.status] || 'bg-gray-100'}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={`px-3 py-3 text-xs font-semibold capitalize ${PRIORITY_COLORS[t.priority] || ''}`}>{t.priority}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{new Date(t.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ticket detail drawer */}
      {detail && (
        <TicketDrawer ticket={detail} onClose={() => setSelectedId(null)} onReply={() => {
          // Refresh detail after reply
          if (selectedId) api.get<TicketDetail>(`/tickets/${selectedId}`).then(setDetail)
        }} />
      )}

      {/* Create ticket modal */}
      {showCreate && (
        <CreateTicketModal onClose={() => setShowCreate(false)} onCreate={() => {
          setShowCreate(false)
          // Refresh list
          api.get<PaginatedResponse<TicketSummary>>(`/tickets?status=${statusFilter}`)
            .then(d => { setTickets(d.items); setTotal(d.total) })
        }} />
      )}
    </div>
  )
}

function TicketDrawer({ ticket, onClose, onReply }: { ticket: TicketDetail; onClose: () => void; onReply: () => void }) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  async function handleReply() {
    if (!reply.trim()) return
    setSending(true)
    try {
      await api.post(`/tickets/${ticket.id}/comments`, { body: reply })
      setReply('')
      onReply()
    } catch {} finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[500px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">{ticket.title}</h3>
            <div className="flex gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[ticket.status] || 'bg-gray-100'}`}>
                {ticket.status.replace('_', ' ')}
              </span>
              <span className={`text-xs font-semibold capitalize ${PRIORITY_COLORS[ticket.priority]}`}>{ticket.priority}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-4">
          {ticket.description && (
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">{ticket.description}</div>
          )}

          <p className="text-xs text-gray-400 font-semibold uppercase">Comments</p>
          {ticket.comments.length === 0 ? (
            <p className="text-sm text-gray-400">No comments yet</p>
          ) : ticket.comments.map((c: TicketCommentView) => (
            <div key={c.id} className="border-l-2 border-gray-200 pl-4">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">{c.authorName}</p>
                <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-sm text-gray-700 mt-1">{c.body}</p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-200">
          <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            rows={3} placeholder="Type a reply..." value={reply} onChange={e => setReply(e.target.value)} />
          <button onClick={handleReply} disabled={!reply.trim() || sending}
            className="mt-2 w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 text-white font-semibold py-2 rounded-xl text-sm">
            {sending ? 'Sending...' : 'Send Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateTicketModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.post('/tickets', { title, description, priority })
      onCreate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-[480px] p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 text-lg">New Support Ticket</h3>
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief description of the issue" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea required rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
            value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the issue in detail..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full" value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm">Cancel</button>
          <button type="submit" disabled={loading} className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 text-white font-semibold py-2 rounded-xl text-sm">
            {loading ? 'Creating...' : 'Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  )
}
