/**
 * Watches the website instant quote (/p/quote) the way a customer reaches it:
 * through the public door, by its public address. If it does not answer for
 * more than 10 minutes, Jonathan gets a notification in the app (and a text,
 * once texting is set up and ALERT_PHONE is set); when it answers again, a
 * second one says so and for how long it was down.
 *
 * It runs on the Mac mini, so it cannot warn while the Mac itself or the
 * internet is down: those alerts arrive when it is back. An outside monitor
 * covers that case (see FEATURES.md, "instant quote watch").
 */

import https from 'https'
import { Resolver } from 'dns/promises'
import prisma from './prisma.js'
import { sendSms, isSmsServiceConfigured } from './sms.js'

const DEFAULT_URL = 'https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/api/config'
const THRESHOLD_MS = 10 * 60_000

export interface DoorWatchDeps {
  check: () => Promise<boolean>
  alert: (title: string, body: string) => Promise<void>
  now?: () => number
  thresholdMs?: number
}

/** The timing: one alert after the threshold, one when it is back. Returns tick(). */
export function createDoorWatch({ check, alert, now = Date.now, thresholdMs = THRESHOLD_MS }: DoorWatchDeps) {
  let downSince: number | null = null
  let alerted = false
  const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  return async function tick(): Promise<'up' | 'down' | 'alerted' | 'recovered'> {
    const ok = await check().catch(() => false)
    const t = now()
    if (ok) {
      if (alerted && downSince !== null) {
        const mins = Math.round((t - downSince) / 60_000)
        await alert('Instant quote is answering again', `The website instant quote was down from ${clock(downSince)} to ${clock(t)} (about ${mins} minutes).`)
        downSince = null; alerted = false
        return 'recovered'
      }
      downSince = null; alerted = false
      return 'up'
    }
    if (downSince === null) downSince = t
    if (!alerted && t - downSince > thresholdMs) {
      alerted = true
      await alert('Instant quote is not answering', `Customers on the website cannot get a price. Not answering since ${clock(downSince)}. Check that the Mac mini is on and the internet is up.`)
      return 'alerted'
    }
    return 'down'
  }
}

/** One request to the public door at its public address (not the Mac's private Tailscale one). */
export async function checkPublicDoor(url: string): Promise<boolean> {
  const u = new URL(url)
  const resolver = new Resolver()
  resolver.setServers(['1.1.1.1', '8.8.8.8'])
  const [ip] = await resolver.resolve4(u.hostname)
  if (!ip) return false
  return new Promise(resolve => {
    const req = https.request({
      host: ip, servername: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      headers: { Host: u.host, 'User-Agent': 'EZBiz door watch' }, timeout: 20_000,
    }, res => {
      let body = ''
      res.on('data', c => { body += c; if (body.length > 200_000) req.destroy() })
      res.on('end', () => resolve(res.statusCode === 200 && /"success":true/.test(body)))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

async function alertJonathan(title: string, body: string) {
  await prisma.notification.create({ data: { title, body, type: title.includes('not answering') ? 'error' : 'success', link: '/settings' } })
    .catch(err => console.error('[door-watch] notification failed:', err))
  const to = process.env.ALERT_PHONE
  if (to && isSmsServiceConfigured()) await sendSms(to, `EZ Biz: ${title}. ${body}`).catch(err => console.error('[door-watch] text failed:', err))
  console.log(`[door-watch] ${title}: ${body}`)
}

/** Live only (the dev copy is not behind the public door). Every minute. */
export function startDoorWatch(): void {
  if (process.env.NODE_ENV !== 'production' || process.env.DISABLE_CRON === '1' || process.env.DOOR_WATCH === 'off') return
  const url = process.env.PUBLIC_QUOTE_CHECK_URL || DEFAULT_URL
  const tick = createDoorWatch({ check: () => checkPublicDoor(url), alert: alertJonathan })
  setInterval(() => { tick().catch(err => console.error('[door-watch]', err)) }, 60_000).unref()
  console.log(`[door-watch] watching ${url}`)
}
