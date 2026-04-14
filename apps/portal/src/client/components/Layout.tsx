import { useAuth } from '../hooks/useAuth'
import type { ReactNode } from 'react'

const NAV_ITEMS = [
  { label: 'Dashboard', path: 'dashboard', icon: '📊', roles: ['customer', 'admin', 'support_agent'] },
  { label: 'Tickets', path: 'tickets', icon: '🎫', roles: ['customer', 'admin', 'support_agent'] },
  { label: 'Invoices', path: 'invoices', icon: '💳', roles: ['customer', 'admin', 'support_agent'] },
  { label: 'Documents', path: 'documents', icon: '📁', roles: ['customer', 'admin', 'support_agent'] },
  { label: 'Contracts', path: 'contracts', icon: '📄', roles: ['customer', 'admin', 'support_agent'] },
  { label: 'Knowledge Base', path: 'knowledge', icon: '🧠', roles: ['admin'] },
  { label: 'Admin', path: 'admin', icon: '⚙️', roles: ['admin'] },
]

export default function Layout({ activePage, onNavigate, children }: {
  activePage: string
  onNavigate: (page: string) => void
  children: ReactNode
}) {
  const { user, logout } = useAuth()
  if (!user) return null

  const visible = NAV_ITEMS.filter(n => n.roles.includes(user.role))

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <div className="w-56 bg-gray-900 flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-gray-700">
          <h1 className="text-white text-lg font-bold tracking-tight">Customer Portal</h1>
          <p className="text-gray-500 text-xs mt-0.5">{user.accountName}</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {visible.map(item => (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activePage === item.path
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold">
              {user.firstName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
              <p className="text-gray-400 text-xs capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
          <button onClick={logout} className="mt-3 w-full text-xs text-gray-500 hover:text-gray-300 text-left">
            Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {NAV_ITEMS.find(n => n.path === activePage)?.label || 'Portal'}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {children}
        </div>
      </div>
    </div>
  )
}
