import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, generateTokens, verifyAccessToken } from '../src/server/lib/auth.js'
import type { TokenPayload } from '../src/types/index.js'

describe('Auth', () => {
  describe('Password hashing', () => {
    it('should hash and verify a password', async () => {
      const password = 'test-password-123'
      const hash = await hashPassword(password)
      expect(hash).not.toBe(password)
      expect(await verifyPassword(password, hash)).toBe(true)
    })

    it('should reject wrong password', async () => {
      const hash = await hashPassword('correct-password')
      expect(await verifyPassword('wrong-password', hash)).toBe(false)
    })
  })

  describe('JWT tokens', () => {
    const payload: TokenPayload = {
      sub: 'user-123',
      email: 'test@test.com',
      role: 'customer',
      accountId: 'account-456',
    }

    it('should generate and verify access token', () => {
      const tokens = generateTokens(payload)
      expect(tokens.accessToken).toBeTruthy()
      expect(tokens.refreshToken).toBeTruthy()

      const decoded = verifyAccessToken(tokens.accessToken)
      expect(decoded.sub).toBe(payload.sub)
      expect(decoded.email).toBe(payload.email)
      expect(decoded.role).toBe(payload.role)
      expect(decoded.accountId).toBe(payload.accountId)
    })

    it('should reject tampered token', () => {
      const tokens = generateTokens(payload)
      expect(() => verifyAccessToken(tokens.accessToken + 'x')).toThrow()
    })
  })
})

describe('Account Scoping', () => {
  it('should enforce that customer payload contains accountId', () => {
    const payload: TokenPayload = {
      sub: 'user-1',
      email: 'a@b.com',
      role: 'customer',
      accountId: 'acc-1',
    }
    const tokens = generateTokens(payload)
    const decoded = verifyAccessToken(tokens.accessToken)
    expect(decoded.accountId).toBe('acc-1')
  })
})

describe('File Validation', () => {
  it('should accept valid file types', async () => {
    const { validateFile } = await import('../src/server/lib/storage/index.js')

    expect(validateFile({ mimetype: 'application/pdf', size: 1000, originalname: 'test.pdf' })).toBeNull()
    expect(validateFile({ mimetype: 'image/png', size: 1000, originalname: 'photo.png' })).toBeNull()
    expect(validateFile({ mimetype: 'image/jpeg', size: 1000, originalname: 'photo.jpg' })).toBeNull()
  })

  it('should reject invalid file types', async () => {
    const { validateFile } = await import('../src/server/lib/storage/index.js')

    const result = validateFile({ mimetype: 'application/x-executable', size: 1000, originalname: 'virus.exe' })
    expect(result).toContain('not allowed')
  })

  it('should reject oversized files', async () => {
    const { validateFile } = await import('../src/server/lib/storage/index.js')

    const result = validateFile({ mimetype: 'application/pdf', size: 30 * 1024 * 1024, originalname: 'big.pdf' })
    expect(result).toContain('too large')
  })
})
