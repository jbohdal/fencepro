/**
 * Only ~/ezbiz may use the live database.
 */
import { describe, test, expect } from 'vitest'
import { liveDatabaseMisuse } from '../src/server/lib/liveGuard'

const HOME = '/Users/someone'
const live = 'postgresql://ezbiz:secret@localhost:5432/ezbiz?schema=public'
const dev = 'postgresql://ezbiz_dev:secret@localhost:5432/ezbiz_dev?schema=public'

describe('liveDatabaseMisuse', () => {
  test('the live install may use the live database', () => {
    expect(liveDatabaseMisuse(live, `${HOME}/ezbiz/apps/portal`, HOME)).toBeNull()
    expect(liveDatabaseMisuse(live, `${HOME}/ezbiz`, HOME)).toBeNull()
  })

  test('any other folder is refused the live database', () => {
    const msg = liveDatabaseMisuse(live, `${HOME}/Downloads/project/ez-biz-final/apps/portal`, HOME)
    expect(msg).toContain('not the live install')
    expect(msg).toContain('ezbiz_dev')
    expect(liveDatabaseMisuse('postgresql://ezbiz@127.0.0.1/ezbiz', `${HOME}/Downloads/x`, HOME)).not.toBeNull()
  })

  test('a folder that only starts with the same letters is not the live install', () => {
    expect(liveDatabaseMisuse(live, `${HOME}/ezbiz-copy/apps/portal`, HOME)).not.toBeNull()
  })

  test('the dev database is fine from anywhere', () => {
    expect(liveDatabaseMisuse(dev, `${HOME}/Downloads/project/apps/portal`, HOME)).toBeNull()
    expect(liveDatabaseMisuse(dev, `${HOME}/ezbiz/apps/portal`, HOME)).toBeNull()
  })

  test('a database on another machine is not this guard\'s business', () => {
    expect(liveDatabaseMisuse('postgresql://u:p@db.example.com:5432/ezbiz', '/srv/app', HOME)).toBeNull()
  })

  test('no setting or an unreadable one is left to the other checks', () => {
    expect(liveDatabaseMisuse(undefined, '/x', HOME)).toBeNull()
    expect(liveDatabaseMisuse('file:./dev.db', '/x', HOME)).toBeNull()
  })
})
