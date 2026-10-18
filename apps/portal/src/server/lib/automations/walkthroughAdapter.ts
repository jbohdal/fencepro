/**
 * Adapter to the Final walkthrough feature (built separately). Its library
 * exports isWalkthroughSigned(accountId, jobId) and startWalkthrough(accountId,
 * jobId, by). It is loaded by name at run time so automations work before and
 * after it is installed: until then, a requirement for a signed walkthrough is
 * "not met" with a plain reason, and starting one fails clearly.
 *
 * Tests replace it with setWalkthroughForTests.
 */

export interface WalkthroughApi {
  isWalkthroughSigned(accountId: string, jobId: string): Promise<boolean>
  startWalkthrough(accountId: string, jobId: string, by: string): Promise<unknown>
  /** The homeowner's signing link token for a walkthrough (/p/w/<token>), when the feature offers it. */
  issueLink?(accountId: string, walkthroughId: string): Promise<{ token: string }>
}

const CANDIDATES = ['../walkthrough.js', '../walkthroughs.js', '../walkthroughService.js', '../walkthroughFlow.js']
let override: WalkthroughApi | null = null
let cached: WalkthroughApi | null | undefined

export function setWalkthroughForTests(api: WalkthroughApi | null) { override = api; cached = undefined }

export async function walkthroughApi(): Promise<WalkthroughApi | null> {
  if (override) return override
  if (cached !== undefined) return cached
  for (const path of CANDIDATES) {
    try {
      const mod: any = await import(/* @vite-ignore */ path)
      if (typeof mod?.isWalkthroughSigned === 'function' && typeof mod?.startWalkthrough === 'function') {
        cached = { isWalkthroughSigned: mod.isWalkthroughSigned, startWalkthrough: mod.startWalkthrough, ...(typeof mod.issueLink === 'function' ? { issueLink: mod.issueLink } : {}) }
        return cached
      }
    } catch { /* not this one */ }
  }
  // Not installed yet: look again next time (it may arrive with an update) but not on every call.
  setTimeout(() => { if (cached === null) cached = undefined }, 60_000).unref?.()
  cached = null
  return null
}

export const WALKTHROUGH_MISSING = 'The Final walkthrough feature is not installed yet, so a walkthrough cannot be started or checked.'
