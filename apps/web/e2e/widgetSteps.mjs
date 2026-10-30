// The website instant quote (/p/quote) from the address to the name and phone, the way a customer does it:
// type the address, pick the suggestion, tap four corners of a fence on the photo, Done, Next, vinyl,
// 6 ft privacy, Next. Nothing about the customer is kept until the name and phone are typed (since Oct 29 2026
// there is no saved draft to start a test part way through), so a test that needs the contact step walks there.
//
//   import { toContactStep } from './widgetSteps.mjs'
//   await toContactStep(page, { tap: true })              // the widget is the page
//   await toContactStep(page, { w: page.frameLocator('#w') }) // the widget is in a frame
//
// `tap`: touch taps on the photo (a phone context with hasTouch); otherwise mouse clicks.
const pause = ms => new Promise(r => setTimeout(r, ms))
/** Four corners around the middle of the photo, in screen pixels from its center. */
const CORNERS = [[-90, 20], [-90, -110], [90, -110], [90, 20]]

export async function toContactStep(page, { w = page, tap = false, address = '110 SE Watula', material = 'vinyl', height = '6|privacy' } = {}) {
  const press = async loc => { await loc.waitFor({ state: 'visible', timeout: 20000 }); if (tap) await loc.tap(); else await loc.click(); await pause(350) }
  await w.locator('[data-w-address]').waitFor({ timeout: 30000 })
  await w.locator('[data-w-address]').pressSequentially(address, { delay: 40 })
  await press(w.locator('[data-w-suggestion]').first())
  const map = w.locator('[data-w-map] .leaflet-container')
  await map.waitFor({ timeout: 20000 })
  await pause(1200)
  const box = await map.boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  for (const [dx, dy] of CORNERS) {
    if (tap) await page.touchscreen.tap(cx + dx, cy + dy); else await page.mouse.click(cx + dx, cy + dy)
    await pause(450)
  }
  await press(w.locator('[data-w-done]'))
  await press(w.locator('[data-w-step="draw"] [data-w-next]'))
  await press(w.locator(`[data-w-material="${material}"]`))
  const h = w.locator(`[data-w-height="${height}"]`)
  if (await h.count()) await press(h)
  await press(w.locator('[data-w-step="fence"] [data-w-next]'))
  await w.locator('[data-w-name]').first().waitFor({ timeout: 20000 })
}
