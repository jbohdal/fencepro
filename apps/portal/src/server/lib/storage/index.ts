import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB || '25') || 25) * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/jpg',
])

/** Ensure upload directory exists */
export function ensureUploadDir(): void {
  const dir = path.resolve(UPLOAD_DIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Validate file before storage */
export function validateFile(file: { mimetype: string; size: number; originalname: string }): string | null {
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    return `File type not allowed: ${file.mimetype}. Allowed: PDF, DOCX, XLSX, PNG, JPG`
  }
  if (file.size > MAX_SIZE) {
    return `File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB. Max: ${MAX_SIZE / (1024 * 1024)}MB`
  }
  return null
}

/** Store a file and return the storage path */
export function storeFile(buffer: Buffer, originalName: string, accountId: string): { storagePath: string; filename: string } {
  ensureUploadDir()

  const ext = path.extname(originalName)
  const filename = `${uuidv4()}${ext}`
  const accountDir = path.resolve(UPLOAD_DIR, accountId)

  if (!fs.existsSync(accountDir)) {
    fs.mkdirSync(accountDir, { recursive: true })
  }

  const storagePath = path.join(accountId, filename)
  const fullPath = path.resolve(UPLOAD_DIR, storagePath)
  fs.writeFileSync(fullPath, buffer)

  return { storagePath, filename }
}

/** Get the full filesystem path for a stored file */
export function getFilePath(storagePath: string): string {
  return path.resolve(UPLOAD_DIR, storagePath)
}

/** Delete a file from storage */
export function deleteFile(storagePath: string): boolean {
  try {
    const fullPath = path.resolve(UPLOAD_DIR, storagePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Placeholder virus scan hook — wire to ClamAV or cloud API in production */
export async function scanFile(_filePath: string): Promise<{ clean: boolean; threat?: string }> {
  // TODO: Integrate with ClamAV or virus scanning API
  // For now, always return clean
  return { clean: true }
}
