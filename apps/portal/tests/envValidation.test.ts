/**
 * Startup settings check: a database on this machine in production.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { validateProductionEnv } from '../src/server/lib/urls.js'

const saved = { ...process.env }

beforeEach(() => {
  process.env.NODE_ENV = 'production'
  process.env.APP_URL = 'https://example.com'
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db'
  process.env.JWT_SECRET = 'a'.repeat(96)
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(96)
  delete process.env.ALLOW_LOCAL_DATABASE
})
afterEach(() => { process.env = { ...saved } })

describe('validateProductionEnv, local database', () => {
  test('a localhost database blocks startup in production by default', () => {
    const { critical } = validateProductionEnv()
    expect(critical.some(m => m.includes('localhost'))).toBe(true)
  })
  test('ALLOW_LOCAL_DATABASE=true turns it into a warning', () => {
    process.env.ALLOW_LOCAL_DATABASE = 'true'
    const { critical, warnings } = validateProductionEnv()
    expect(critical).toEqual([])
    expect(warnings.some(m => m.includes('localhost'))).toBe(true)
  })
  test('it does not excuse the other checks', () => {
    process.env.ALLOW_LOCAL_DATABASE = 'true'
    process.env.JWT_SECRET = 'change-me'
    expect(validateProductionEnv().critical.length).toBe(1)
  })
})
