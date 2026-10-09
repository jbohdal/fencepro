/**
 * Version check for records that are saved whole.
 *
 * Each such record carries a `version`. A save must say which version it was
 * built on (`baseVersion` in the body); it is applied only if that is still
 * the current one, and the version then goes up by one. Otherwise the save is
 * refused with the current copy, so the browser can put its change on top of
 * that and try again. This is what stops a tab that has been open for a while
 * from writing its old copy over newer work from another tab or device.
 */

import type { Response } from 'express'

/** The version the save was built on, or null when the request did not send one. */
export function baseVersionOf(body: unknown): number | null {
  const v = (body as { baseVersion?: unknown } | null | undefined)?.baseVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

/** 409 with the current copy. `data` and `version` are what the browser merges onto. */
export function refuseStale(res: Response, data: unknown, version: number): void {
  res.status(409).json({
    success: false,
    code: 'STALE_VERSION',
    error: 'This was changed on another tab or device.',
    data,
    version,
  })
}

/** 409 for a save with no version at all: a tab still running the app from before version checks. */
export function refuseUnversioned(res: Response): void {
  res.status(409).json({
    success: false,
    code: 'VERSION_REQUIRED',
    error: 'This tab is out of date. Reload the page, then make the change again.',
  })
}
