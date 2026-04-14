import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import type { DashboardSummary } from '../../types/index'

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

export default function DashboardPage({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<DashboardSummary>('/dashboard').then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-20 text-gray-400">Loading dashboard...</div>
  if (!data) return <div className="text-center py-20 text-gray-400">Failed to load dashboard</div>

  const kpis = [
    { label: 'Open Tickets', value: data.openTickets, icon: '🎫', color: data.openTickets > 0 ? 'text-orange-600' : 'text-green-600', click: () => onNavigate('tickets') },
    { label: 'Pending Invoices', value: data.pendingInvoices, icon: '💳', color: 'text-blue-600', click: () => onNavigate('invoices') },
    { label: 'Overdue Invoices', value: data.overdueInvoices, icon: '⚠️', color: data.overdueInvoices > 0 ? 'text-red-500' : 'text-green-600', click: () => onNavigate('invoices') },
    { label: 'Active Contracts', value: data.activeContracts, icon: '📄', color: 'text-purple-600', click: () => onNavigate('contracts') },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gray-900 rounded-2xl p-6 flex items-center justify-between">
        <div>
          <p className="text-gray-400 text-sm">Welcome back,</p>
          <p className="text-white text-2xl font-bold mt-1">{user?.firstName} {user?.lastName}</p>
          {user?.assignedRep && (
            <p className="text-gray-400 text-xs mt-2">Your rep: {user.assignedRep}</p>
          )}
        </div>
        {data.totalOwed > 0 && (
          <div className="text-right">
            <p className="text-gray-400 text-xs uppercase tracking-wide">Balance Due</p>
            <p className="text-orange-400 text-3xl font-bold mt-1">{fmt(data.totalOwed)}</p>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <div key={kpi.label} onClick={kpi.click}
            className="bg-white rounded-2xl border border-gray-200 p-5 cursor-pointer hover:border-orange-300 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase">{kpi.label}</p>
              <span className="text-lg">{kpi.icon}</span>
            </div>
            <p className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Recent Activity</h3>
        </div>
        {data.recentActivity.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-400 text-sm">No recent activity</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.recentActivity.map(item => (
              <div key={item.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.title}</p>
                  <p className="text-xs text-gray-400">{item.description}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(item.timestamp).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
