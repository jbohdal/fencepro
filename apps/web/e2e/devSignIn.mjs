// A dev sign in made by the test itself (apps/portal/scripts/dev-session-token.ts, which refuses anything but
// ezbiz_dev), for suites that need a second person (the Salesman) when the run gives none: the nightly and
// run-heavy.sh give the owner's sign in only. A one day session; nothing about it is kept on disk.
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const PORTAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal')

/** The dev Salesman (scrubbed dev logins are <login>@example.invalid). */
export const DEV_SALES_EMAIL = process.env.E2E_SALES_EMAIL || 'christa@example.invalid'
/** The dev owner. */
export const DEV_OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'jbohdal@example.invalid'

/** An access token (cookie: false) or an `ezbiz_staff` cookie value (cookie: true) for that login on the dev copy. */
export function devSignIn(email, { cookie = false } = {}) {
  const out = path.join(os.tmpdir(), `e2e-signin-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  try {
    execFileSync(path.join(PORTAL_DIR, 'node_modules/.bin/tsx'), ['scripts/dev-session-token.ts', '--email', email, '--days', '1', ...(cookie ? ['--cookie'] : []), '--out', out], { cwd: PORTAL_DIR, stdio: 'ignore' })
    return fs.readFileSync(out, 'utf8').trim()
  } catch (e) {
    console.error(`Could not make a dev sign in for ${email} (scripts/dev-session-token.ts): ${String(e?.message || e).slice(0, 200)}`)
    return ''
  } finally {
    fs.rmSync(out, { force: true })
  }
}
