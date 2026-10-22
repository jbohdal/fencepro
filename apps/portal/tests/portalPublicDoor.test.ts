/**
 * The customer portal through the public door (/p/portal/, routes/portalPublic.ts):
 * only the routes a customer uses are reachable there, and file and media
 * links in its answers point under the same door.
 */
import { describe, test, expect } from 'vitest'
import { customerRoute, throughDoor } from '../src/server/routes/portalPublic.js'
import { portalCookiePath } from '../src/server/lib/portalSession.js'

describe('customer routes only', () => {
  test('what a customer uses is reachable', () => {
    for (const [m, p] of [
      ['POST', '/login'], ['POST', '/logout'], ['POST', '/activate'], ['POST', '/resend-invite'], ['GET', '/me'], ['POST', '/me/password'],
      ['GET', '/company'], ['GET', '/quotes'], ['GET', '/projects'], ['GET', '/invoices'], ['GET', '/change-orders'], ['POST', '/change-orders/abc/sign'],
      ['GET', '/photos'], ['POST', '/photos'], ['GET', '/documents'], ['POST', '/documents'], ['GET', '/media'], ['GET', '/messages'], ['POST', '/messages'],
      ['GET', '/files/portal/x.jpg'], ['HEAD', '/files/intake/y.png'],
    ]) expect(customerRoute(m, p), `${m} ${p}`).toBe(true)
  })

  test('every staff route is refused', () => {
    for (const [m, p] of [
      ['POST', '/invite'], ['GET', '/accounts'], ['POST', '/accounts/1/force-activate'], ['POST', '/accounts/1/revoke'], ['POST', '/migrate-invalidate-legacy'],
      ['GET', '/customer/c1/photos'], ['POST', '/customer/c1/photos'], ['GET', '/customer/c1/documents'], ['POST', '/customer/c1/documents'],
      ['GET', '/customer/c1/messages'], ['POST', '/customer/c1/messages'], ['GET', '/messages/inbox'],
      ['DELETE', '/photos/p1'], ['DELETE', '/documents/d1'], ['PUT', '/me'], ['GET', '/login'], ['POST', '/files/x'],
    ]) expect(customerRoute(m, p), `${m} ${p}`).toBe(false)
  })
})

test('file and media links in an answer point under the public door', () => {
  const out = throughDoor({ success: true, data: [{ fileUrl: '/api/portal/files/portal%2Fa.jpg?e=1&s=2', url: '/api/media/f/m1/original?e=1&s=2', name: '/api/other', at: new Date(0) }] }) as any
  expect(out.data[0].fileUrl).toBe('/p/portal/api/files/portal%2Fa.jpg?e=1&s=2')
  expect(out.data[0].url).toBe('/p/portal/api/media/f/m1/original?e=1&s=2')
  expect(out.data[0].name).toBe('/api/other')
  expect(out.data[0].at).toBeInstanceOf(Date)
})

test('the sign in cookie is sent only to the door it was made on', () => {
  expect(portalCookiePath({ baseUrl: '/p/portal/api' })).toBe('/p/portal/api')
  expect(portalCookiePath({ baseUrl: '/api/portal' })).toBe('/api/portal')
})
