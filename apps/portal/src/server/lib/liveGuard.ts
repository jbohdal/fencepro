/**
 * Only the live install may use the live database.
 *
 * On the Mac mini the live database is `ezbiz` on this machine and the live
 * install is ~/ezbiz. Any other copy of the code (the working folder in
 * Downloads, a test checkout) must use `ezbiz_dev`. A copied settings file
 * once pointed the working folder at live; this refuses to start in that case.
 * See GO_LIVE.md, "Live and dev are separate".
 */

import os from 'os'
import path from 'path'

export const LIVE_DATABASE_NAME = 'ezbiz'

/** A sentence saying what is wrong, or null when this copy may use this database. */
export function liveDatabaseMisuse(databaseUrl: string | undefined, cwd: string, home: string = os.homedir()): string | null {
  if (!databaseUrl) return null
  let url: URL
  try { url = new URL(databaseUrl) } catch { return null }
  const onThisMachine = ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(url.hostname)
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!onThisMachine || name !== LIVE_DATABASE_NAME) return null
  const liveRoot = path.join(home, 'ezbiz')
  const here = path.resolve(cwd)
  if (here === liveRoot || here.startsWith(liveRoot + path.sep)) return null
  return `This copy of EZ Biz (${here}) is not the live install (${liveRoot}), but its DATABASE_URL names the live database "${LIVE_DATABASE_NAME}". ` +
    'Only the live install may use it. Point DATABASE_URL at ezbiz_dev (see GO_LIVE.md, "Live and dev are separate").'
}
