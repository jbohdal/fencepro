/**
 * Integration Framework API Routes
 *
 * Admin: manage integrations, API keys, webhook logs
 * Public: inbound webhook receiver
 */

import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'
import { str } from '../lib/helpers.js'
import { getAllAdapters, getAdapter, COMING_SOON } from '../integrations/registry.js'

const router = Router()

// ════════════════════════════════════════
// PUBLIC — Inbound webhook receiver
// ════════════════════════════════════════

router.post('/webhooks/inbound/:source', async (req, res) => {
  const source = str(req.params.source)

  // Log the inbound webhook
  const logEntry = await prisma.webhookInboundLog.create({
    data: {
      source,
      endpoint: req.originalUrl,
      payload: JSON.parse(JSON.stringify(req.body || {})),
      headers: JSON.parse(JSON.stringify({
        'content-type': req.headers['content-type'],
        'x-webhook-signature': req.headers['x-webhook-signature'],
      })),
    },
  })

  try {
    // Find the adapter
    const adapter = getAdapter(source)
    if (!adapter) {
      await prisma.webhookInboundLog.update({
        where: { id: logEntry.id },
        data: { status: 'failed', errorMessage: `No adapter found for source: ${source}` },
      })
      res.status(404).json({ success: false, error: `Unknown integration: ${source}` })
      return
    }

    // Check if integration is active
    const integration = await prisma.integration.findUnique({ where: { slug: source } })
    if (!integration?.isActive) {
      await prisma.webhookInboundLog.update({
        where: { id: logEntry.id },
        data: { status: 'failed', errorMessage: 'Integration is not active' },
      })
      res.status(400).json({ success: false, error: 'Integration not active' })
      return
    }

    // Process through adapter
    const result = await adapter.handleInbound(req.body, req.headers as Record<string, string>)

    await prisma.webhookInboundLog.update({
      where: { id: logEntry.id },
      data: {
        status: result.processed ? 'processed' : 'failed',
        processedAt: result.processed ? new Date() : null,
        errorMessage: result.processed ? null : result.message,
      },
    })

    // Log to integration activity
    await prisma.integrationLog.create({
      data: {
        integrationId: integration.id,
        action: 'webhook_in',
        details: result.message,
        status: result.processed ? 'success' : 'error',
      },
    })

    res.json({ success: true, data: { processed: result.processed, message: result.message } })
  } catch (err) {
    await prisma.webhookInboundLog.update({
      where: { id: logEntry.id },
      data: { status: 'failed', errorMessage: err instanceof Error ? err.message : String(err) },
    }).catch(() => {})
    res.status(500).json({ success: false, error: 'Webhook processing failed' })
  }
})

// ════════════════════════════════════════
// ADMIN — Integration management
// ════════════════════════════════════════

// List all integrations (available + connected)
router.get('/', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const adapters = getAllAdapters()
    const dbIntegrations = await prisma.integration.findMany()
    const dbMap = new Map(dbIntegrations.map(i => [i.slug, i]))

    // Merge adapters with DB state
    const available = adapters.map(a => {
      const db = dbMap.get(a.slug)
      return {
        slug: a.slug,
        name: a.name,
        category: a.category,
        description: a.description,
        logoUrl: a.logoUrl,
        capabilities: a.capabilities,
        configFields: a.configFields,
        isActive: db?.isActive || false,
        status: db?.status || 'disconnected',
        connectedAt: db?.connectedAt,
        lastSyncedAt: db?.lastSyncedAt,
        errorLog: db?.errorLog,
        comingSoon: false,
      }
    })

    // Add coming-soon stubs
    const comingSoon = COMING_SOON.filter(c => !adapters.some(a => a.slug === c.slug)).map(c => ({
      ...c, configFields: [], isActive: false, status: 'disconnected', comingSoon: true,
    }))

    res.json({ success: true, data: [...available, ...comingSoon] })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load integrations' })
  }
})

// Connect an integration
const connectSchema = z.object({ config: z.record(z.unknown()) })

router.post('/:slug/connect', requireAuth, auditLog('integration_connected'), async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  const slug = str(req.params.slug)
  const adapter = getAdapter(slug)
  if (!adapter) { res.status(404).json({ success: false, error: 'Integration not found' }); return }

  try {
    const { config } = connectSchema.parse(req.body)
    const result = await adapter.connect(config)

    if (!result.success) {
      res.json({ success: false, error: result.message })
      return
    }

    // Upsert the integration record
    await prisma.integration.upsert({
      where: { slug },
      update: {
        isActive: true,
        config: JSON.parse(JSON.stringify(config)),
        capabilities: adapter.capabilities,
        connectedBy: req.user!.email,
        connectedAt: new Date(),
        status: 'connected',
        errorLog: null,
      },
      create: {
        name: adapter.name,
        slug,
        category: adapter.category,
        description: adapter.description,
        logoUrl: adapter.logoUrl,
        isActive: true,
        config: JSON.parse(JSON.stringify(config)),
        capabilities: adapter.capabilities,
        connectedBy: req.user!.email,
        connectedAt: new Date(),
        status: 'connected',
      },
    })

    res.json({ success: true, data: { message: result.message } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to connect integration' })
  }
})

// Test an integration
router.post('/:slug/test', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  const slug = str(req.params.slug)
  const adapter = getAdapter(slug)
  if (!adapter) { res.status(404).json({ success: false, error: 'Integration not found' }); return }

  try {
    const integration = await prisma.integration.findUnique({ where: { slug } })
    const config = (integration?.config as Record<string, unknown>) || req.body.config || {}
    const result = await adapter.test(config)
    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'Test failed' })
  }
})

// Disconnect
router.post('/:slug/disconnect', requireAuth, auditLog('integration_disconnected'), async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  const slug = str(req.params.slug)
  try {
    await prisma.integration.update({
      where: { slug },
      data: { isActive: false, status: 'disconnected', config: { _cleared: true } },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to disconnect' })
  }
})

// Sync
router.post('/:slug/sync', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  const slug = str(req.params.slug)
  const adapter = getAdapter(slug)
  if (!adapter) { res.status(404).json({ success: false, error: 'Integration not found' }); return }

  try {
    const integration = await prisma.integration.findUnique({ where: { slug } })
    if (!integration?.isActive) { res.status(400).json({ success: false, error: 'Not connected' }); return }

    const config = (integration.config as Record<string, unknown>) || {}
    const result = await adapter.sync(config)

    await prisma.integration.update({
      where: { slug },
      data: { lastSyncedAt: new Date() },
    })

    await prisma.integrationLog.create({
      data: {
        integrationId: integration.id,
        action: 'sync',
        details: result.message,
        status: result.errors > 0 ? 'error' : 'success',
      },
    })

    res.json({ success: true, data: result })
  } catch {
    res.status(500).json({ success: false, error: 'Sync failed' })
  }
})

// Activity log for an integration
router.get('/:slug/logs', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const integration = await prisma.integration.findUnique({ where: { slug: str(req.params.slug) } })
    if (!integration) { res.status(404).json({ success: false, error: 'Not found' }); return }

    const logs = await prisma.integrationLog.findMany({
      where: { integrationId: integration.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ success: true, data: logs })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load logs' })
  }
})

// ════════════════════════════════════════
// API KEYS — Admin only
// ════════════════════════════════════════

// List API keys
router.get('/api-keys', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, keyPrefix: true, scope: true,
        createdBy: true, lastUsedAt: true, requestCount: true,
        isActive: true, revokedAt: true, createdAt: true,
      },
    })
    res.json({ success: true, data: keys })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load API keys' })
  }
})

// Generate new API key
const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['read', 'read_write', 'admin']),
})

router.post('/api-keys', requireAuth, auditLog('api_key_created'), async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const { name, scope } = createKeySchema.parse(req.body)

    // Generate a secure random key
    const rawKey = `fp_${scope === 'admin' ? 'admin' : scope === 'read_write' ? 'rw' : 'ro'}_${crypto.randomBytes(24).toString('hex')}`
    const keyHash = await bcrypt.hash(rawKey, 10)
    const keyPrefix = rawKey.slice(0, 12) + '...'

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash,
        keyPrefix,
        scope,
        createdBy: req.user!.email,
      },
    })

    // Return the full key ONCE — it will never be shown again
    res.status(201).json({
      success: true,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey, // ONLY TIME this is returned
        keyPrefix: apiKey.keyPrefix,
        scope: apiKey.scope,
        createdAt: apiKey.createdAt,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to create API key' })
  }
})

// Revoke API key
router.delete('/api-keys/:id', requireAuth, auditLog('api_key_revoked'), async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    await prisma.apiKey.update({
      where: { id: str(req.params.id) },
      data: { isActive: false, revokedAt: new Date(), revokedBy: req.user!.email },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to revoke key' })
  }
})

// API key usage logs
router.get('/api-keys/:id/usage', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const logs = await prisma.apiKeyUsageLog.findMany({
      where: { apiKeyId: str(req.params.id) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ success: true, data: logs })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load usage logs' })
  }
})

// ════════════════════════════════════════
// WEBHOOK LOGS — Admin review
// ════════════════════════════════════════

router.get('/webhook-logs', requireAuth, async (req, res) => {
  if (req.user!.role !== 'admin') { res.status(403).json({ success: false, error: 'Admin required' }); return }

  try {
    const logs = await prisma.webhookInboundLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ success: true, data: logs })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load webhook logs' })
  }
})

export default router
