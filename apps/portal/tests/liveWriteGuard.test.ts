/**
 * Scripts that change data refuse the live database unless EZBIZ_LIVE_WRITE_OK=1
 * and a backup from the last 30 minutes exist (lib/liveWriteGuard.ts); the
 * change log says what changed without ever writing a secret (lib/settingsAudit.ts).
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { liveWriteRefusal, isLiveTarget, BACKUP_MAX_AGE_MS } from '../src/server/lib/liveWriteGuard.js'
import { describeChange, shortHash } from '../src/server/lib/settingsAudit.js'

const LIVE = 'postgresql://ezbiz:x@localhost:5432/ezbiz'
const DEV = 'postgresql://ezbiz_dev:x@localhost:5432/ezbiz_dev'

describe('live write guard for scripts', () => {
  let dir = ''
  const now = Date.now()
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-guard-')) })
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })
  const backup = (name: string, ageMs: number) => {
    const f = path.join(dir, name)
    fs.writeFileSync(f, 'dump')
    const t = (now - ageMs) / 1000
    fs.utimesSync(f, t, t)
  }

  test('the practice database is never stopped', () => {
    expect(isLiveTarget(DEV, {})).toBe(false)
    expect(liveWriteRefusal('x.ts', { databaseUrl: DEV, env: {}, backupDir: dir, now })).toBeNull()
  })

  test('live without the flag is refused, whatever the backups', () => {
    backup('ezbiz-db_fresh.dump', 60_000)
    expect(liveWriteRefusal('x.ts', { databaseUrl: LIVE, env: {}, backupDir: dir, now })).toMatch(/EZBIZ_LIVE_WRITE_OK=1/)
    expect(liveWriteRefusal('x.ts', { databaseUrl: LIVE, env: { EZBIZ_LIVE_WRITE_OK: 'yes' }, backupDir: dir, now })).toMatch(/did not run/)
  })

  test('live with the flag needs a backup under 30 minutes old', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-guard-empty-'))
    expect(liveWriteRefusal('x.ts', { databaseUrl: LIVE, env: { EZBIZ_LIVE_WRITE_OK: '1' }, backupDir: empty, now })).toMatch(/no database backup/)
    fs.rmSync(empty, { recursive: true, force: true })
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-guard-old-'))
    fs.writeFileSync(path.join(old, 'ezbiz-db_old.dump'), 'dump')
    const t = (now - BACKUP_MAX_AGE_MS - 60_000) / 1000
    fs.utimesSync(path.join(old, 'ezbiz-db_old.dump'), t, t)
    expect(liveWriteRefusal('x.ts', { databaseUrl: LIVE, env: { EZBIZ_LIVE_WRITE_OK: '1' }, backupDir: old, now })).toMatch(/minutes old/)
    fs.rmSync(old, { recursive: true, force: true })
    expect(liveWriteRefusal('x.ts', { databaseUrl: LIVE, env: { EZBIZ_LIVE_WRITE_OK: '1' }, backupDir: dir, now })).toBeNull()
  })

  test('production counts as live whatever the database is called', () => {
    expect(isLiveTarget(DEV, { NODE_ENV: 'production' })).toBe(true)
  })
})

describe('settings change summary', () => {
  test('a stage list reads stage by stage, by name', () => {
    const before = [{ id: 'a', name: 'Permit Pending', isComplete: false }, { id: 'b', name: 'Complete', isComplete: true }]
    const after = [{ id: 'a', name: 'Permit Pending', isComplete: true }, { id: 'b', name: 'Complete', isComplete: true }, { id: 'c', name: 'Paid', isComplete: false }]
    expect(describeChange(before, after)).toEqual(['added Paid', 'Permit Pending.isComplete: false → true'])
    expect(describeChange(after, [...after].reverse())).toEqual(['list: order changed'])
    expect(describeChange(before, before)).toEqual([])
  })

  test('secrets are never written, only that they changed', () => {
    const lines = describeChange({ twilio: { authToken: 'old-secret', from: '+1' }, smtpPassword: 'a' }, { twilio: { authToken: 'new-secret', from: '+2' }, smtpPassword: 'b' })
    expect(lines).toContain('twilio.authToken changed (value hidden)')
    expect(lines).toContain('smtpPassword changed (value hidden)')
    expect(lines).toContain('twilio.from: "+1" → "+2"')
    expect(lines.join(' ')).not.toMatch(/old-secret|new-secret/)
  })

  test('the hash does not depend on key order', () => {
    expect(shortHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(shortHash({ b: [1, { d: 3, c: 2 }], a: 1 }))
    expect(shortHash({ a: 1 })).not.toBe(shortHash({ a: 2 }))
  })
})
