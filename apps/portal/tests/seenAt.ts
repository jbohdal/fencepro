/** What the customer's page sends with a signing: the option's fence and price as saved now (routes/proposal.ts). For tests that sign the way the page does. */
import { optionSeen } from '../src/server/lib/optionSeen.js'

export async function seenAt(token: string, option: number): Promise<string> {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const q = await prisma.savedQuote.findUnique({ where: { shareToken: token }, select: { proposal: true } })
  return optionSeen((q?.proposal as any)?.options?.[option])
}
