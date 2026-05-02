/**
 * Stripe Adapter
 *
 * Capabilities:
 *  - create_payment_link  — generate a Stripe Checkout Session URL for an invoice
 *  - receive_payment      — process Stripe webhook events to mark invoices paid
 *  - refund               — issue refunds via the Stripe API
 *
 * Config fields:
 *  - secretKey        Stripe secret key  (sk_live_... / sk_test_...)
 *  - webhookSecret    Stripe webhook signing secret (whsec_...)
 *
 * Webhook events handled:
 *  - checkout.session.completed  → mark invoice paid (metadata.invoice_id)
 *  - payment_intent.succeeded    → fallback path for direct PaymentIntent flows
 *  - charge.refunded             → mark invoice refunded
 *
 * Security:
 *  - When webhookSecret is configured, the Stripe-Signature header is verified
 *    against the raw request bytes (passed via x-raw-body internal header).
 *  - When webhookSecret is NOT configured the endpoint rejects all inbound
 *    webhook events to prevent forged payment notifications.
 */

import type { IntegrationAdapter } from '../../types.js'
import prisma from '../../../lib/prisma.js'
import crypto from 'crypto'

/** Thin Stripe REST helper — avoids pulling in the heavy stripe npm package */
async function stripeRequest(
  path: string,
  secretKey: string,
  options: { method?: string; body?: Record<string, string | undefined> } = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const method = options.method || 'GET'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  const encodedBody = options.body
    ? Object.entries(options.body)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
        .join('&')
    : undefined

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers,
    body: encodedBody,
  })

  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

/** Maximum age (seconds) of a Stripe webhook before it is rejected as a potential replay */
const STRIPE_TOLERANCE_SECONDS = 300 // 5 minutes (Stripe's own SDK default)

/**
 * Verify a Stripe webhook signature using the raw request bytes.
 * Stripe signs: "<timestamp>.<rawBody>" with HMAC-SHA256.
 * The raw body MUST be the exact bytes before JSON.parse.
 *
 * Also applies a timestamp tolerance window to reject replayed events.
 */
function verifyStripeSignature(rawBody: string, sigHeader: string, secret: string): boolean {
  try {
    const pairs = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
    const timestamp = pairs['t']
    const sig = pairs['v1']
    if (!timestamp || !sig) return false

    // Reject if event is older than the tolerance window (replay protection)
    const eventAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10)
    if (eventAge > STRIPE_TOLERANCE_SECONDS) {
      console.warn(`[Stripe] Webhook rejected: event is ${eventAge}s old (tolerance: ${STRIPE_TOLERANCE_SECONDS}s)`)
      return false
    }

    const signed = `${timestamp}.${rawBody}`
    const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex')

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expected, 'hex')
    const sigBuf = Buffer.from(sig, 'hex')
    if (expectedBuf.length !== sigBuf.length) return false
    return crypto.timingSafeEqual(expectedBuf, sigBuf)
  } catch {
    return false
  }
}

const adapter: IntegrationAdapter = {
  slug: 'stripe',
  name: 'Stripe',
  category: 'Payments',
  description: 'Accept payments and send payment links from jobs.',
  capabilities: ['create_payment_link', 'receive_payment', 'refund'],
  configFields: [
    {
      key: 'secretKey',
      label: 'Secret Key',
      type: 'password',
      required: true,
      placeholder: 'sk_live_... or sk_test_...',
      helpText: 'Your Stripe secret API key from the Stripe Dashboard',
    },
    {
      key: 'webhookSecret',
      label: 'Webhook Signing Secret',
      type: 'password',
      required: true,
      placeholder: 'whsec_...',
      helpText: 'From Stripe Dashboard → Webhooks → your endpoint → Signing secret. Required to verify payment events.',
    },
  ],

  async connect(config) {
    return this.test(config)
  },

  async disconnect() {},

  async test(config) {
    const { secretKey } = config as { secretKey: string }
    if (!secretKey) return { success: false, message: 'Secret key is required' }

    try {
      const result = await stripeRequest('/account', secretKey)
      if (result.ok) {
        const account = result.data as { business_profile?: { name?: string }; email?: string }
        const name = account.business_profile?.name || account.email || 'your account'
        return { success: true, message: `Connected to Stripe: ${name}` }
      }
      const err = result.data as { error?: { message?: string } }
      return { success: false, message: err?.error?.message || `Stripe returned ${result.status}` }
    } catch (err) {
      return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async sync(config) {
    const { secretKey } = config as { secretKey: string }
    if (!secretKey) return { synced: 0, errors: 0, message: 'Not configured' }

    try {
      // Pull completed checkout sessions and update invoice status
      const result = await stripeRequest(
        '/checkout/sessions?limit=100&status=complete',
        secretKey,
      )

      if (!result.ok) return { synced: 0, errors: 1, message: 'Failed to fetch checkout sessions' }

      const list = result.data as {
        data?: Array<{ id: string; metadata?: { invoice_id?: string }; payment_status?: string }>
      }
      const items = list.data || []

      let synced = 0
      let errors = 0

      for (const session of items) {
        const invoiceId = session.metadata?.invoice_id
        if (!invoiceId || session.payment_status !== 'paid') continue

        try {
          await prisma.invoice.updateMany({
            where: { id: invoiceId, status: { not: 'paid' } },
            data: { status: 'paid', paidAt: new Date() },
          })
          synced++
        } catch {
          errors++
        }
      }

      return {
        synced,
        errors,
        message: synced > 0
          ? `Synced ${synced} payment(s) from Stripe`
          : 'No new payments to sync',
      }
    } catch (err) {
      return { synced: 0, errors: 1, message: `Sync failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  async handleInbound(payload, headers) {
    const sigHeader = headers['stripe-signature'] || ''
    // Raw body is injected by the inbound webhook route via x-raw-body header
    const rawBody = headers['x-raw-body'] || JSON.stringify(payload)

    // Load the webhook secret from the stored integration config
    const config = await prisma.integration.findUnique({ where: { slug: 'stripe' } })
    const webhookSecret = (config?.config as Record<string, string> | null)?.webhookSecret

    // Reject if no webhook secret is configured — we cannot safely process payment events
    if (!webhookSecret) {
      return {
        processed: false,
        message: 'Stripe webhookSecret is not configured. Configure it to accept payment events.',
      }
    }

    if (!sigHeader) {
      return { processed: false, message: 'Missing Stripe-Signature header' }
    }

    const valid = verifyStripeSignature(rawBody, sigHeader, webhookSecret)
    if (!valid) {
      return { processed: false, message: 'Invalid Stripe webhook signature' }
    }

    const event = payload as { type?: string; data?: { object?: Record<string, unknown> } }
    const eventType = event.type || ''
    const obj = event.data?.object || {}

    console.log(`[Stripe] Inbound event: ${eventType}`)

    // checkout.session.completed — primary path for Checkout-Session-based payments
    if (eventType === 'checkout.session.completed') {
      const session = obj as {
        payment_status?: string
        metadata?: { invoice_id?: string }
        payment_intent?: string
      }

      if (session.payment_status !== 'paid') {
        return { processed: true, message: `Session not yet paid (status: ${session.payment_status})` }
      }

      const invoiceId = session.metadata?.invoice_id
      if (invoiceId) {
        try {
          await prisma.invoice.updateMany({
            where: { id: invoiceId },
            data: { status: 'paid', paidAt: new Date() },
          })
          console.log(`[Stripe] Invoice ${invoiceId} marked paid via checkout.session.completed`)
          return { processed: true, message: `Invoice ${invoiceId} marked paid` }
        } catch (err) {
          return { processed: false, message: `Failed to update invoice: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      return { processed: true, message: 'checkout.session.completed — no invoice_id in metadata' }
    }

    // payment_intent.succeeded — fallback for direct PaymentIntent flows
    if (eventType === 'payment_intent.succeeded') {
      const pi = obj as { metadata?: { invoice_id?: string } }
      const invoiceId = pi.metadata?.invoice_id

      if (invoiceId) {
        try {
          await prisma.invoice.updateMany({
            where: { id: invoiceId },
            data: { status: 'paid', paidAt: new Date() },
          })
          console.log(`[Stripe] Invoice ${invoiceId} marked paid via payment_intent.succeeded`)
          return { processed: true, message: `Invoice ${invoiceId} marked paid` }
        } catch (err) {
          return { processed: false, message: `Failed to update invoice: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      return { processed: true, message: 'payment_intent.succeeded — no invoice_id in metadata' }
    }

    // charge.refunded
    if (eventType === 'charge.refunded') {
      const charge = obj as { metadata?: { invoice_id?: string } }
      const invoiceId = charge.metadata?.invoice_id
      if (invoiceId) {
        await prisma.invoice.updateMany({
          where: { id: invoiceId },
          data: { status: 'refunded' },
        })
        return { processed: true, message: `Invoice ${invoiceId} marked refunded` }
      }
      return { processed: true, message: 'charge.refunded — no invoice_id in metadata' }
    }

    return { processed: true, message: `Event ${eventType} received (no action taken)` }
  },
}

/**
 * Create a Stripe Checkout Session for a given invoice.
 * Returns a hosted payment URL the customer can open to pay.
 *
 * The invoice_id is stored in payment_intent_data[metadata] so that when
 * the checkout.session.completed webhook fires, the payment can be matched
 * back to the portal invoice.
 *
 * Call this from the invoice API or automation engine.
 */
export async function createStripeCheckoutSession(params: {
  secretKey: string
  amountCents: number
  currency?: string
  invoiceId: string
  invoiceNumber: string
  customerEmail?: string
  description?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<{ url: string; sessionId: string } | null> {
  try {
    const body: Record<string, string | undefined> = {
      'mode': 'payment',
      'line_items[0][price_data][currency]': params.currency || 'usd',
      'line_items[0][price_data][unit_amount]': String(params.amountCents),
      'line_items[0][price_data][product_data][name]': `Invoice ${params.invoiceNumber}`,
      'line_items[0][price_data][product_data][description]': params.description || `Payment for invoice ${params.invoiceNumber}`,
      'line_items[0][quantity]': '1',
      // Explicitly propagate invoice_id to the PaymentIntent metadata
      'payment_intent_data[metadata][invoice_id]': params.invoiceId,
      'payment_intent_data[metadata][invoice_number]': params.invoiceNumber,
      // Also set it on the session metadata for session-level webhook handling
      'metadata[invoice_id]': params.invoiceId,
      'metadata[invoice_number]': params.invoiceNumber,
      'success_url': params.successUrl || 'https://example.com/payment/success',
      'cancel_url': params.cancelUrl || 'https://example.com/payment/cancel',
    }

    if (params.customerEmail) {
      body['customer_email'] = params.customerEmail
    }

    const result = await stripeRequest('/checkout/sessions', params.secretKey, {
      method: 'POST',
      body,
    })

    if (!result.ok) {
      console.error('[Stripe] Failed to create checkout session:', result.data)
      return null
    }

    const session = result.data as { id: string; url: string }
    console.log(`[Stripe] Checkout session created: ${session.id} for invoice ${params.invoiceNumber}`)
    return { url: session.url, sessionId: session.id }
  } catch (err) {
    console.error('[Stripe] createStripeCheckoutSession error:', err)
    return null
  }
}

export default adapter
