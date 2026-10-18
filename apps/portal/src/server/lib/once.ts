/**
 * Made once. Everything the server makes by itself (a company's pipeline,
 * inventory, settings records, starter rules, a job's checklist) has a fixed
 * key that the database keeps unique, so a second copy cannot be saved. When
 * two requests make the same thing at the same moment, the second insert is
 * refused (Prisma P2002) and the first one's row is the answer.
 */

/** True for a unique constraint refusal (the row was made at the same moment elsewhere). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'P2002'
}

/**
 * The row `find` returns, made with `create` when there is none. A create
 * that loses a race to an identical one returns the winner's row.
 */
export async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const have = await find()
  if (have) return have
  try {
    return await create()
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const won = await find()
    if (!won) throw err
    return won
  }
}

/**
 * A list held in a JSON column, with one entry per id: a later entry with an
 * id already seen replaces the earlier one in its place. Entries with no id
 * are kept as they are. Returns the same array when nothing was repeated.
 */
export function oneById<T>(list: T[]): T[] {
  const at = new Map<string, number>()
  const out: T[] = []
  let repeated = false
  for (const item of list) {
    const id = (item as { id?: unknown } | null)?.id
    if (typeof id !== 'string' && typeof id !== 'number') { out.push(item); continue }
    const key = String(id)
    const i = at.get(key)
    if (i === undefined) { at.set(key, out.length); out.push(item) } else { out[i] = item; repeated = true }
  }
  return repeated ? out : list
}

/**
 * Run `fn` in a transaction that holds a lock named `key`, for the "if none,
 * make it" steps whose rows have no unique key of their own: a second caller
 * with the same key waits, then finds what the first made.
 */
export async function withLock<T>(key: string, fn: (tx: any) => Promise<T>): Promise<T> {
  const { default: prisma } = await import('./prisma.js')
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
    return fn(tx)
  }, { timeout: 15_000 })
}

/** The id the screen chose for a new record (body `clientId` or `id`), if it is a usable one. */
export function requestIdOf(req: { body?: any }): string | undefined {
  const v = req.body?.clientId ?? req.body?.id
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined
}

/**
 * Make a record with the id the screen chose, once. The same request sent
 * again (a double tap, or a resend after the answer was lost) returns the
 * record already made, also when both arrive at the same moment. A row with
 * that id that is not this caller's (`mine` false) is never returned: the new
 * record then gets an id of the database's own.
 */
export async function createOnce<T>(
  id: string | undefined,
  find: (id: string) => Promise<T | null>,
  mine: (row: T) => boolean,
  create: (id: string | undefined) => Promise<T>,
): Promise<{ row: T; created: boolean }> {
  if (id) {
    const have = await find(id)
    if (have) {
      if (mine(have)) return { row: have, created: false }
      id = undefined
    }
  }
  try {
    return { row: await create(id), created: true }
  } catch (err) {
    if (!id || !isUniqueViolation(err)) throw err
    const won = await find(id)
    if (won && mine(won)) return { row: won, created: false }
    throw err
  }
}
