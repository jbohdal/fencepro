// The owner changes a team member's login email on the Team page (Jonathan, Oct 30 2026).
//
//   APP_URL=http://localhost:<worktree server> API_URL=<same> E2E_ACCESS_TOKEN_FILE=<dev owner token> \
//     E2E_STAFF_COOKIE=<dev owner cookie> [SHOTS=<folder>] node e2e/team-email.mjs
//
// Makes a Salesman, an office login and an admin (invite + accept, as the
// Team page does; the invite emails land in the dev outbox), then:
//   1. The Salesman is signed in on an iPhone (WebKit) before anything changes.
//   2. The owner, on a computer: Team > Edit on the Salesman. The email box is
//      editable; the office login's address is refused in words that name
//      nobody ("Another team member already uses that email."), the window
//      stays open and nothing is saved; " Mixed.Case@... " saves, and the row
//      shows it trimmed and lower case.
//   3. The Salesman's iPhone, reloaded: still signed in, My profile email is
//      the new one. A fresh browser signs in with the new email and the same
//      password; the old email is refused.
//   4. The owner on an iPhone: More > Team > Edit, the email box and Save on
//      screen.
//   5. The office login: no Team in the menu; the API refuses the change (403).
//   6. An admin (the owner exists): Team > Edit shows the email read only.
// Its three logins are removed at the end (the owner's Team delete).
import './devOnly.mjs'
import { chromium, webkit } from 'playwright'
import fs from 'fs'
import { APP, API, sleep, signInByCookie, makeTestLogin, removeTestLogin, reporter } from './lib.mjs'

const TOKEN = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN or E2E_ACCESS_TOKEN_FILE (a dev owner token).'); process.exit(2) }
const SHOTS = process.env.SHOTS || ''
const { check, finish } = reporter()
const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }

const code = Math.random().toString(36).slice(2, 7)
const made = []
const browsers = []
try {
  const sales = await makeTestLogin({ role: 'sales_rep', firstName: 'Emailchange', lastName: `Salesman ${code}`, ownerToken: TOKEN, api: API }); made.push(sales)
  const office = await makeTestLogin({ role: 'office_staff', firstName: 'Emailchange', lastName: `Office ${code}`, ownerToken: TOKEN, api: API }); made.push(office)
  const admin = await makeTestLogin({ role: 'admin', firstName: 'Emailchange', lastName: `Admin ${code}`, ownerToken: TOKEN, api: API }); made.push(admin)
  const newEmail = `e2e-moved-${code}@example.invalid`

  const chrome = await chromium.launch(); browsers.push(chrome)
  const wk = await webkit.launch(); browsers.push(wk)

  // 1. The Salesman's iPhone, signed in before the change.
  const phoneCtx = await wk.newContext(IPHONE)
  await signInByCookie(phoneCtx, { cookie: '', email: sales.email, password: sales.password, api: API })
  const phone = await phoneCtx.newPage()
  await phone.goto(APP)
  await phone.waitForSelector('[data-tabbar]', { timeout: 30000 })
  check('the Salesman is signed in on his iPhone', true)

  // 2. The owner on a computer.
  const ownerCtx = await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(ownerCtx, { api: API })
  const owner = await ownerCtx.newPage()
  await owner.goto(APP)
  await owner.waitForSelector('[data-global-appointment]', { timeout: 30000 })
  await owner.locator('span:text-is("Team"):visible').first().click()
  await owner.waitForSelector(`[data-edit-user="${sales.id}"]`, { timeout: 15000 })
  await owner.locator(`[data-edit-user="${sales.id}"]`).click()
  const box = owner.locator('[data-edit-email]')
  check('the owner gets an editable Email box', await box.isVisible() && await box.isEditable())
  await box.fill(office.email.toUpperCase())
  check('a changed email says what happens (same password, stays signed in, nothing emailed)', /same password/.test(await owner.locator('[data-email-change-note]').innerText()))
  await owner.locator('[data-save-user]').click()
  await owner.getByText('Another team member already uses that email.').waitFor({ timeout: 10000 }).then(() => check('an email another login uses is refused in plain words', true), () => check('an email another login uses is refused in plain words', false))
  check('the window stays open after the refusal', await box.isVisible())
  const still = await (await fetch(`${API}/api/crm-auth/users`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  check('nothing was saved on the refusal', still.data.find(u => u.id === sales.id)?.email === sales.email)
  await shot(owner, '1-owner-refused')
  await box.fill(`  ${newEmail.replace('e2e-moved', 'E2E-Moved')} `)
  await owner.locator('[data-save-user]').click()
  await box.waitFor({ state: 'detached', timeout: 10000 })
  await owner.getByText(newEmail, { exact: true }).waitFor({ timeout: 10000 }).then(() => check('the Team list shows the new email, trimmed and lower case', true), () => check('the Team list shows the new email, trimmed and lower case', false))
  await shot(owner, '2-owner-saved')

  // 3. The Salesman keeps going; the next sign in is with the new email.
  await phone.reload()
  await phone.waitForSelector('[data-tabbar]', { timeout: 30000 }).then(() => check('the Salesman is still signed in on his iPhone after a reload', true), () => check('the Salesman is still signed in on his iPhone after a reload', false))
  await shot(phone, '2b-salesman-phone-after-change')
  const me = await phone.evaluate(async api => (await (await fetch(`${api}/api/crm-auth/me`, { credentials: 'include', headers: { 'X-Staff-Request': '1' } })).json()).data, API)
  check('his phone now knows him by the new email', me?.email === newEmail, me?.email)
  const signIn = async (email) => {
    const ctx = await wk.newContext(IPHONE)
    const p = await ctx.newPage()
    await p.goto(APP)
    await p.waitForSelector('input[type="email"]', { timeout: 20000 })
    await p.fill('input[type="email"]', email)
    await p.fill('input[type="password"]', sales.password)
    await p.click('button[type="submit"]')
    const ok = await p.waitForSelector('[data-tabbar]', { timeout: 12000 }).then(() => true, () => false)
    await shot(p, ok ? '3-new-email-signed-in' : '4-old-email-refused')
    await ctx.close()
    return ok
  }
  check('a fresh iPhone signs in with the new email and the same password', await signIn(newEmail))
  check('the old email no longer signs in', !(await signIn(sales.email)))

  // 4. The owner on an iPhone: More > Team > Edit.
  const ownerPhoneCtx = await wk.newContext(IPHONE)
  await signInByCookie(ownerPhoneCtx, { api: API })
  const op = await ownerPhoneCtx.newPage()
  await op.goto(APP)
  await op.waitForSelector('[data-tabbar]', { timeout: 30000 })
  await op.locator('[data-tabbar] >> text=More').click()
  await op.locator('span:text-is("Team"):visible').first().click()
  await op.locator(`[data-edit-user="${sales.id}"]`).click()
  const pbox = op.locator('[data-edit-email]')
  await pbox.waitFor({ timeout: 10000 })
  check('on the owner\'s iPhone the Email box shows the new email', (await pbox.inputValue()) === newEmail)
  await op.locator('[data-save-user]').scrollIntoViewIfNeeded()
  check('on the owner\'s iPhone Save is on screen', await op.locator('[data-save-user]').isVisible())
  await shot(op, '5-owner-iphone-edit')

  // 5. The office: no Team page, and the API says no.
  const officeCtx = await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(officeCtx, { cookie: '', email: office.email, password: office.password, api: API })
  const of = await officeCtx.newPage()
  await of.goto(APP)
  await of.waitForSelector('[data-global-appointment]', { timeout: 30000 })
  check('the office has no Team in the menu', (await of.locator('span:text-is("Team"):visible').count()) === 0)
  const r = await officeCtx.request.patch(`${API}/api/crm-auth/users/${sales.id}/email`, { headers: H, data: { email: `e2e-office-try-${code}@example.invalid` } })
  check('the office cannot change an email through the API (403)', r.status() === 403, String(r.status()))

  // 6. An admin while there is an owner: read only.
  const adminCtx = await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  await signInByCookie(adminCtx, { cookie: '', email: admin.email, password: admin.password, api: API })
  const ad = await adminCtx.newPage()
  await ad.goto(APP)
  await ad.waitForSelector('[data-global-appointment]', { timeout: 30000 })
  await ad.locator('span:text-is("Team"):visible').first().click()
  await ad.locator(`[data-edit-user="${sales.id}"]`).click()
  await ad.getByText('Only the owner can change a login\'s email.').waitFor({ timeout: 10000 }).then(() => check('an admin sees the email read only, saying only the owner can change it', true), () => check('an admin sees the email read only, saying only the owner can change it', false))
  check('an admin gets no editable Email box', (await ad.locator('[data-edit-email]').count()) === 0)
  const ra = await adminCtx.request.patch(`${API}/api/crm-auth/users/${sales.id}/email`, { headers: H, data: { email: `e2e-admin-try-${code}@example.invalid` } })
  check('the admin cannot change an email through the API (403)', ra.status() === 403, String(ra.status()))
  await shot(ad, '6-admin-read-only')
} catch (err) {
  check(`ran to the end (${String(err?.message || err).slice(0, 200)})`, false)
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  for (const l of made) await removeTestLogin(l, { ownerToken: TOKEN, api: API })
}
process.exit(finish())
