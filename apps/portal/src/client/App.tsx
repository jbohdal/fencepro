import { useState } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import TicketsPage from './pages/TicketsPage'
import InvoicesPage from './pages/InvoicesPage'
import DocumentsPage from './pages/DocumentsPage'
import ContractsPage from './pages/ContractsPage'
import AdminPage from './pages/AdminPage'
import ChatWidget from './components/ChatWidget'
import LeadChatWidget from './components/LeadChatWidget'
import KnowledgeBasePage from './pages/KnowledgeBasePage'

function PortalRouter() {
  const { user, loading } = useAuth()
  const [page, setPage] = useState('dashboard')

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (!user) return (
    <>
      <LoginPage />
      <LeadChatWidget />
    </>
  )

  return (
    <>
      <Layout activePage={page} onNavigate={setPage}>
        {page === 'dashboard' && <DashboardPage onNavigate={setPage} />}
        {page === 'tickets'   && <TicketsPage />}
        {page === 'invoices'  && <InvoicesPage />}
        {page === 'documents' && <DocumentsPage />}
        {page === 'contracts' && <ContractsPage />}
        {page === 'knowledge' && <KnowledgeBasePage />}
        {page === 'admin'     && <AdminPage />}
      </Layout>
      {user.role === 'customer' && <ChatWidget />}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <PortalRouter />
    </AuthProvider>
  )
}
