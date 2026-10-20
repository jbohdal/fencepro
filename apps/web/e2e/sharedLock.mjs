// Tests that change shared things on the dev copy (Inventory, material kits,
// fence styles, tiers, Settings lists) take turns. Two of them at once once
// wiped the dev kits: each saves "what was there" and puts it back, and one
// put back the other's half-finished state (Oct 20, 2026).
//
//   import './sharedLock.mjs'   // first line after devOnly.mjs
//
// The lock is a folder; it is held until this process ends, and a lock left
// by a run that died (no such process any more, or older than 30 minutes) is
// taken over.
import fs from 'fs'
import os from 'os'
import path from 'path'

const DIR = path.join(os.tmpdir(), 'ezbiz-e2e-shared-lock')
const OWNER = path.join(DIR, 'pid')
const STALE_MS = 30 * 60_000
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }

function stale() {
  try {
    const pid = Number(fs.readFileSync(OWNER, 'utf8'))
    const age = Date.now() - fs.statSync(DIR).mtimeMs
    return !pid || !alive(pid) || age > STALE_MS
  } catch { return true }
}

const started = Date.now()
let told = false
for (;;) {
  try {
    fs.mkdirSync(DIR)
    fs.writeFileSync(OWNER, String(process.pid))
    break
  } catch {
    if (stale()) { try { fs.rmSync(DIR, { recursive: true, force: true }) } catch { /* someone else took it */ } continue }
    if (!told) { console.log('(waiting for another test that changes shared dev data to finish)'); told = true }
    if (Date.now() - started > 40 * 60_000) { console.error('Gave up waiting for the shared test lock.'); process.exit(2) }
    wait(2000)
  }
}

const release = () => { try { if (Number(fs.readFileSync(OWNER, 'utf8')) === process.pid) fs.rmSync(DIR, { recursive: true, force: true }) } catch { /* already gone */ } }
process.on('exit', release)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { release(); process.exit(130) })
