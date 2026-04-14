// ── Auth ──

export interface TokenPayload {
  sub: string        // customer id
  email: string
  role: 'customer' | 'admin' | 'support_agent'
  accountId: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  firstName: string
  lastName: string
  phone?: string
  accountId: string
}

// ── API Responses ──

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ── Dashboard ──

export interface DashboardSummary {
  openTickets: number
  pendingInvoices: number
  overdueInvoices: number
  activeContracts: number
  totalOwed: number
  recentActivity: ActivityItem[]
}

export interface ActivityItem {
  id: string
  type: 'ticket_update' | 'invoice_created' | 'document_uploaded' | 'contract_update'
  title: string
  description: string
  timestamp: string
}

// ── Tickets (customer-facing) ──

export interface TicketSummary {
  id: string
  title: string
  status: string
  priority: string
  createdAt: string
  updatedAt: string
}

export interface TicketDetail extends TicketSummary {
  description: string | null
  comments: TicketCommentView[]
}

export interface TicketCommentView {
  id: string
  authorName: string
  body: string
  createdAt: string
}

export interface CreateTicketRequest {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

// ── Invoices (customer-facing) ──

export interface InvoiceView {
  id: string
  invoiceNumber: string
  amountCents: number
  currency: string
  dueDate: string
  paidAt: string | null
  status: string
  hasPdf: boolean
}

// ── Contracts (customer-facing) ──

export interface ContractView {
  id: string
  name: string
  description: string | null
  startDate: string
  endDate: string | null
  status: string
}

// ── Documents ──

export interface DocumentView {
  id: string
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  linkedEntity: string | null
  linkedEntityId: string | null
  uploadedAt: string
}

// ── CRM Adapter ──

export interface CrmAdapter {
  getAccount(externalId: string): Promise<CrmAccountData | null>
  getTickets(accountId: string): Promise<CrmTicketData[]>
  getInvoices(accountId: string): Promise<CrmInvoiceData[]>
  getContracts(accountId: string): Promise<CrmContractData[]>
  createTicket(accountId: string, data: CreateTicketRequest): Promise<CrmTicketData>
  addTicketComment(ticketId: string, body: string, authorName: string): Promise<void>
}

export interface CrmAccountData {
  externalId: string
  name: string
  status: string
  assignedRepName?: string
  assignedRepEmail?: string
}

export interface CrmTicketData {
  externalId: string
  title: string
  description?: string
  status: string
  priority: string
  createdAt: string
  updatedAt: string
  comments?: { authorName: string; body: string; isInternal: boolean; createdAt: string }[]
}

export interface CrmInvoiceData {
  externalId: string
  invoiceNumber: string
  amountCents: number
  currency: string
  dueDate: string
  paidAt?: string
  status: string
  pdfUrl?: string
}

export interface CrmContractData {
  externalId: string
  name: string
  description?: string
  startDate: string
  endDate?: string
  status: string
}
