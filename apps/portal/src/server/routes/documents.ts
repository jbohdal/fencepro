import { Router } from 'express'
import multer from 'multer'
import prisma from '../lib/prisma.js'
import { str } from '../lib/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'
import { validateFile, storeFile, getFilePath, deleteFile, scanFile } from '../lib/storage/index.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
const router = Router()

// ── List documents (account-scoped) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId
    const linkedEntity = req.query.linkedEntity ? String(req.query.linkedEntity) : undefined
    const linkedEntityId = req.query.linkedEntityId ? String(req.query.linkedEntityId) : undefined

    const where = {
      accountId,
      deletedAt: null,
      ...(linkedEntity ? { linkedEntity } : {}),
      ...(linkedEntityId ? { linkedEntityId } : {}),
    }

    const documents = await prisma.document.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
    })

    res.json({
      success: true,
      data: documents.map(d => ({
        id: d.id,
        filename: d.filename,
        originalName: d.originalName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        linkedEntity: d.linkedEntity,
        linkedEntityId: d.linkedEntityId,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load documents' })
  }
})

// ── Upload document ──
router.post('/', requireAuth, upload.single('file'), auditLog('document_upload'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' })
      return
    }

    // Validate
    const validationError = validateFile(req.file)
    if (validationError) {
      res.status(400).json({ success: false, error: validationError })
      return
    }

    // Store
    const { storagePath, filename } = storeFile(req.file.buffer, req.file.originalname, req.user!.accountId)

    // Virus scan
    const scanResult = await scanFile(getFilePath(storagePath))
    if (!scanResult.clean) {
      deleteFile(storagePath)
      res.status(400).json({ success: false, error: `File rejected: ${scanResult.threat}` })
      return
    }

    // Save metadata to DB
    const doc = await prisma.document.create({
      data: {
        customerId: req.user!.sub,
        accountId: req.user!.accountId,
        filename,
        originalName: req.file.originalname,
        storagePath,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        linkedEntity: req.body.linkedEntity ? String(req.body.linkedEntity) : null,
        linkedEntityId: req.body.linkedEntityId ? String(req.body.linkedEntityId) : null,
      },
    })

    res.status(201).json({
      success: true,
      data: {
        id: doc.id,
        filename: doc.filename,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        uploadedAt: doc.uploadedAt.toISOString(),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Upload failed' })
  }
})

// ── Download document ──
router.get('/:id/download', requireAuth, auditLog('document_download'), async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: str(req.params.id) } })

    if (!doc || doc.deletedAt || doc.accountId !== req.user!.accountId) {
      res.status(404).json({ success: false, error: 'Document not found' })
      return
    }

    const fullPath = getFilePath(doc.storagePath)
    res.download(fullPath, doc.originalName)
  } catch {
    res.status(500).json({ success: false, error: 'Download failed' })
  }
})

// ── Delete document (soft delete) ──
router.delete('/:id', requireAuth, auditLog('document_delete'), async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: str(req.params.id) } })

    if (!doc || doc.deletedAt) {
      res.status(404).json({ success: false, error: 'Document not found' })
      return
    }

    // Customers can only delete their own uploads
    if (req.user!.role === 'customer' && doc.customerId !== req.user!.sub) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }

    await prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } })

    res.json({ success: true, message: 'Document deleted' })
  } catch {
    res.status(500).json({ success: false, error: 'Delete failed' })
  }
})

export default router
