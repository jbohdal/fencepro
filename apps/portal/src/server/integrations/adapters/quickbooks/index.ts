/**
 * QuickBooks Online Adapter
 *
 * Capabilities:
 *  - push_invoice    — create invoices in QBO when created in CRM
 *  - sync_payments   — mark invoices paid when QBO payment received
 *  - pull_expenses   — fetch expenses/purchases for P&L reporting
 *
 * Config fields:
 *  - clientId        QBO OAuth 2.0 client ID
 *  - clientSecret    QBO OAuth 2.0 client secret
 *  - realmId         QuickBooks company (realm) ID
 *  - accessToken     OAuth access token (short-lived)
 *  - refreshToken    OAuth refresh token (long-lived)
 */

import type { IntegrationAdapter } from '../../types.js'
import prisma from '../../../lib/prisma.js'

const QBO_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

export type QboConfig = {
  clientId: string
  clientSecret: string
  realmId: string
  accessToken: string
  refreshToken: string
  sandbox?: boolean | string
}

type QboFetchResult = { ok: boolean; status: number; data: unknown }

async function qboFetch(
  path: string,
  config: QboConfig,
  options: { method?: string; body?: unknown } = {},
): Promise<QboFetchResult> {
  const isSandbox = config.sandbox === true || config.sandbox === 'true'
  const base = isSandbox ? QBO_SANDBOX_BASE : QBO_BASE
  const url = `${base}/${config.realmId}${path}`

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

/** Refresh QBO access token and persist updated tokens to DB. Returns new access token or null. */
async function refreshAccessToken(config: QboConfig): Promise<string | null> {
  try {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(config.refreshToken)}`,
    })

    if (!res.ok) return null

    const tokens = await res.json() as { access_token: string; refresh_token?: string }

    // Persist refreshed tokens back to integration config
    const integration = await prisma.integration.findUnique({ where: { slug: 'quickbooks' } })
    if (integration) {
      const existing = integration.config as Record<string, unknown>
      await prisma.integration.update({
        where: { slug: 'quickbooks' },
        data: {
          config: {
            ...existing,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || config.refreshToken,
          },
        },
      })
    }

    return tokens.access_token
  } catch {
    return null
  }
}

/**
 * Execute a QBO fetch with automatic token-refresh retry on 401.
 * Returns the result of the (possibly retried) request.
 */
async function qboFetchWithRetry(
  path: string,
  config: QboConfig,
  options?: { method?: string; body?: unknown },
): Promise<QboFetchResult> {
  const result = await qboFetch(path, config, options)

  if (result.status === 401 && config.clientId && config.refreshToken) {
    const newToken = await refreshAccessToken(config)
    if (newToken) {
      // Retry with fresh token
      return qboFetch(path, { ...config, accessToken: newToken }, options)
    }
  }

  return result
}

const adapter: IntegrationAdapter = {
  slug: 'quickbooks',
  name: 'QuickBooks Online',
  category: 'Accounting',
  description: 'Sync invoices, payments, and expenses with QuickBooks.',
  capabilities: ['push_invoice', 'sync_payments', 'pull_expenses'],
  configFields: [
    {
      key: 'clientId',
      label: 'Client ID',
      type: 'text',
      required: true,
      helpText: 'From the Intuit Developer Portal → your app → Keys & OAuth',
    },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'password',
      required: true,
    },
    {
      key: 'realmId',
      label: 'Company (Realm) ID',
      type: 'text',
      required: true,
      helpText: 'Your QuickBooks company ID — visible in the QBO URL after connecting',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'password',
      required: true,
      helpText: 'OAuth 2.0 access token (expires in 1 hour)',
    },
    {
      key: 'refreshToken',
      label: 'Refresh Token',
      type: 'password',
      required: true,
      helpText: 'OAuth 2.0 refresh token (lasts 100 days)',
    },
    {
      key: 'sandbox',
      label: 'Use Sandbox',
      type: 'toggle',
      helpText: 'Enable for QBO sandbox/development environment',
    },
  ],

  async connect(config) {
    return this.test(config)
  },

  async disconnect() {},

  async test(config) {
    const cfg = config as QboConfig
    if (!cfg.realmId || !cfg.accessToken) {
      return { success: false, message: 'Realm ID and Access Token are required' }
    }

    try {
      const result = await qboFetchWithRetry('/companyinfo/' + cfg.realmId, cfg)

      if (result.ok) {
        const data = result.data as { CompanyInfo?: { CompanyName?: string } }
        const name = data.CompanyInfo?.CompanyName || 'QuickBooks company'
        return { success: true, message: `Connected to ${name}` }
      }

      return { success: false, message: `QuickBooks returned ${result.status} — check your credentials` }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync(config) {
    const cfg = config as QboConfig
    if (!cfg.realmId || !cfg.accessToken) {
      return { synced: 0, errors: 0, message: 'Not configured' }
    }

    let synced = 0
    let errors = 0

    try {
      // Pull ALL invoices from QBO (not filtered by Balance) so we can reconcile
      // both paid (Balance = 0) and outstanding (Balance > 0) invoices.
      const query = encodeURIComponent('SELECT * FROM Invoice MAXRESULTS 200')
      const result = await qboFetchWithRetry(`/query?query=${query}`, cfg)

      if (!result.ok) {
        return { synced: 0, errors: 1, message: `QBO query failed (${result.status}) — token may be expired` }
      }

      const data = result.data as {
        QueryResponse?: {
          Invoice?: Array<{
            Id: string
            DocNumber: string
            TotalAmt: number
            Balance: number
            DueDate?: string
          }>
        }
      }

      const qboInvoices = data.QueryResponse?.Invoice || []

      for (const qboInv of qboInvoices) {
        try {
          // Reconcile status: Balance === 0 means fully paid
          const newStatus = qboInv.Balance === 0 ? 'paid' : 'pending'
          await prisma.invoice.updateMany({
            where: {
              invoiceNumber: qboInv.DocNumber,
              // Skip invoices that are already in the correct state or in a terminal state
              status: { notIn: ['cancelled', 'refunded', newStatus] },
            },
            data: {
              status: newStatus,
              ...(newStatus === 'paid' ? { paidAt: new Date() } : {}),
            },
          })
          synced++
        } catch {
          errors++
        }
      }

      // Pull expenses (purchases) for P&L and persist each one to ActivityLog
      const expQuery = encodeURIComponent('SELECT * FROM Purchase MAXRESULTS 200')
      const expResult = await qboFetchWithRetry(`/query?query=${expQuery}`, cfg)
      const expData = expResult.data as {
        QueryResponse?: {
          Purchase?: Array<{
            Id: string
            TxnDate?: string
            TotalAmt?: number
            EntityRef?: { name?: string }
            AccountRef?: { name?: string }
            PrivateNote?: string
          }>
        }
      }
      const purchases = expData.QueryResponse?.Purchase || []

      let expensesSynced = 0
      for (const purchase of purchases) {
        try {
          // Upsert into ActivityLog: entityType = 'quickbooks_expense', entityId = QB Purchase ID
          // Avoid duplicates by checking if a log with this QB ID already exists
          const existingLog = await prisma.activityLog.findFirst({
            where: { entityType: 'quickbooks_expense', entityId: purchase.Id },
          })

          if (!existingLog) {
            await prisma.activityLog.create({
              data: {
                entityType: 'quickbooks_expense',
                entityId: purchase.Id,
                actor: 'quickbooks',
                body: `QB Expense: ${purchase.AccountRef?.name || 'Uncategorized'} — $${((purchase.TotalAmt ?? 0)).toFixed(2)}`,
                metadata: {
                  amountCents: Math.round((purchase.TotalAmt ?? 0) * 100),
                  date: purchase.TxnDate || null,
                  vendor: purchase.EntityRef?.name || null,
                  category: purchase.AccountRef?.name || null,
                  description: purchase.PrivateNote || null,
                  source: 'quickbooks',
                },
              },
            })
            expensesSynced++
          }
        } catch {
          errors++
        }
      }

      return {
        synced,
        errors,
        message: `Reconciled ${synced} invoice(s) and synced ${expensesSynced} new expense(s) from QuickBooks.`,
      }
    } catch (err) {
      return { synced: 0, errors: 1, message: `Sync failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async handleInbound(payload, _headers) {
    const body = payload as {
      eventNotifications?: Array<{
        realmId: string
        dataChangeEvent: {
          entities: Array<{ name: string; id: string; operation: string; lastUpdated: string }>
        }
      }>
    }

    let processed = 0

    for (const notification of body.eventNotifications || []) {
      for (const entity of notification.dataChangeEvent?.entities || []) {
        console.log(`[QuickBooks] Entity changed: ${entity.name} ${entity.id} (${entity.operation})`)

        if (entity.name === 'Payment' || entity.name === 'Invoice') {
          console.log(`[QuickBooks] ${entity.name} change event — run sync to reconcile`)
          processed++
        }
      }
    }

    return {
      processed: true,
      message: `Processed ${processed} QBO change event(s)`,
    }
  },
}

/**
 * Push a portal invoice to QuickBooks as a QBO Invoice.
 * Exported so it can be called from invoice creation flows.
 */
export async function pushInvoiceToQBO(params: {
  config: QboConfig
  invoiceNumber: string
  amountCents: number
  dueDate: Date
  customerName: string
  description?: string
}): Promise<{ qboId: string } | null> {
  try {
    // Find or auto-create the customer in QBO
    const safeName = params.customerName.replace(/'/g, "\\'")
    const custQuery = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}' MAXRESULTS 1`)
    const custResult = await qboFetchWithRetry(`/query?query=${custQuery}`, params.config)
    const custData = custResult.data as { QueryResponse?: { Customer?: Array<{ Id: string }> } }
    let customerId = custData.QueryResponse?.Customer?.[0]?.Id

    if (!customerId) {
      // Customer not found — create them in QBO so the invoice has a valid CustomerRef
      const createResult = await qboFetchWithRetry('/customer', params.config, {
        method: 'POST',
        body: { DisplayName: params.customerName },
      })

      if (createResult.ok) {
        const created = createResult.data as { Customer?: { Id: string } }
        customerId = created.Customer?.Id
        if (customerId) {
          console.log(`[QuickBooks] Auto-created customer "${params.customerName}" (ID: ${customerId})`)
        }
      } else {
        console.warn(`[QuickBooks] Could not create customer "${params.customerName}"; invoice will be created without CustomerRef`)
      }
    }

    const invoiceBody: Record<string, unknown> = {
      DocNumber: params.invoiceNumber,
      DueDate: params.dueDate.toISOString().split('T')[0],
      Line: [
        {
          Amount: params.amountCents / 100,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: {
            ItemRef: { value: '1', name: 'Services' },
          },
          Description: params.description || `Invoice ${params.invoiceNumber}`,
        },
      ],
    }

    if (customerId) {
      invoiceBody.CustomerRef = { value: customerId }
    }

    const result = await qboFetchWithRetry('/invoice', params.config, {
      method: 'POST',
      body: invoiceBody,
    })

    if (!result.ok) {
      console.error('[QuickBooks] Failed to create invoice:', result.data)
      return null
    }

    const responseData = result.data as { Invoice?: { Id: string } }
    const qboId = responseData.Invoice?.Id
    if (!qboId) return null

    console.log(`[QuickBooks] Invoice ${params.invoiceNumber} created in QBO (ID: ${qboId})`)
    return { qboId }
  } catch (err) {
    console.error('[QuickBooks] pushInvoiceToQBO error:', err)
    return null
  }
}

export default adapter
