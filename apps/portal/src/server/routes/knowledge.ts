/**
 * Knowledge Base API
 *
 * Admin CRUD for chatbot knowledge entries.
 * The lead-chat route reads these to build the AI's context.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { str } from '../lib/helpers.js'

const router = Router()

// All routes require admin auth
router.use(requireAuth)
router.use((req, res, next) => {
  if (req.user!.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' })
    return
  }
  next()
})

// ── List all entries ──
router.get('/', async (req, res) => {
  try {
    const category = req.query.category ? str(req.query.category as string) : undefined
    const where: any = {}
    if (category) where.category = category

    const entries = await prisma.knowledgeEntry.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
    })

    // Get unique categories for filter dropdown
    const categories = await prisma.knowledgeEntry.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    })

    res.json({
      success: true,
      data: { entries, categories: categories.map(c => c.category) },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load knowledge base' })
  }
})

// ── Get single entry ──
router.get('/:id', async (req, res) => {
  try {
    const entry = await prisma.knowledgeEntry.findUnique({
      where: { id: str(req.params.id) },
    })
    if (!entry) {
      res.status(404).json({ success: false, error: 'Entry not found' })
      return
    }
    res.json({ success: true, data: entry })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load entry' })
  }
})

// ── Create entry ──
const createSchema = z.object({
  category: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

router.post('/', async (req, res) => {
  try {
    const data = createSchema.parse(req.body)
    const entry = await prisma.knowledgeEntry.create({ data })
    res.status(201).json({ success: true, data: entry })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to create entry' })
  }
})

// ── Update entry ──
const updateSchema = z.object({
  category: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  keywords: z.array(z.string()).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})

router.patch('/:id', async (req, res) => {
  try {
    const data = updateSchema.parse(req.body)
    const entry = await prisma.knowledgeEntry.update({
      where: { id: str(req.params.id) },
      data,
    })
    res.json({ success: true, data: entry })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Failed to update entry' })
  }
})

// ── Delete entry ──
router.delete('/:id', async (req, res) => {
  try {
    await prisma.knowledgeEntry.delete({ where: { id: str(req.params.id) } })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete entry' })
  }
})

export default router
