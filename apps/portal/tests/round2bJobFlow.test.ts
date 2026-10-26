/**
 * Round 2b (Oct 26 2026), the job flow's words and rules without a database:
 *   - the Installer never reads a sentence about a price in a note, anywhere
 *     (the job page's notes too), and his note saves keep those sentences;
 *   - Start and Finish taps in words ("Finished the job" apart from "Finished
 *     day 1 of 2"); "Job finished" says what the close out still waits for;
 *   - a repair's packet has no "0 corner posts · 0 end posts · 0 gate posts",
 *     and its walkthrough photographs the gates it rehung;
 *   - a closed job moving back is a reopen.
 */

import { describe, test, expect } from 'vitest'
import { redactCosts, restoreCosts, forCrew, crewTextBack } from '../src/server/lib/costRedact'
import { postsLine } from '../src/server/routes/installPacket'
import { photoSlots, repairGateCount } from '../src/server/lib/walkthroughRules'
import { movesBack } from '../src/server/routes/saved-jobs'
import { START_OPS_STAGES } from '../src/server/lib/opsStageModel'
import { finishWords, jobDoneWords } from '../../web/src/crewWords'

const WEB = 'Website, drawn by customer. The customer drew the fence on the aerial photo of the property and saw an estimate of $4,321 (Better). Confirm every measurement on site.'

describe('the Installer reads no sentence about a price in a note', () => {
  test('a job\'s notes from any answer: the price sentence is dropped, the rest kept', () => {
    const out = redactCosts({ data: [{ id: 'j1', notes: `${WEB}\nCustomer was quoted $5,200.\nGate code 4411.`, customerName: 'Maria' }] }, { prices: true })
    const notes = (out as any).data[0].notes as string
    expect(notes).not.toMatch(/left out|estimate|quoted/)
    expect(notes).toContain('Confirm every measurement on site.')
    expect(notes).toContain('Gate code 4411.')
    expect(notes).toContain('Website, drawn by customer.')
  })
  test('a dollar amount that is not about a price is still left out, the sentence kept', () => {
    expect(forCrew('Lockbox $12 key under the mat.')).toBe('Lockbox $ (left out) key under the mat.')
    expect(redactCosts({ body: 'Have 2 dogs. Budget about $4000.' }, { prices: true })).toEqual({ body: 'Have 2 dogs.' })
  })
  test('the owner and the office read notes as saved', () => {
    const n = `${WEB}\nCustomer was quoted $5,200.`
    expect((redactCosts({ notes: n }) as any).notes).toBe(n)
  })
  test('his save keeps the price sentences he never saw: unchanged, added to, changed in the middle', () => {
    const saved = `${WEB}\nCustomer was quoted $5,200.\nGate code 4411.`
    const view = forCrew(saved)
    expect(crewTextBack(view, saved)).toBe(saved)
    expect(crewTextBack(`${view}\nDog is friendly.`, saved)).toBe(`${saved}\nDog is friendly.`)
    const edited = view.replace('Gate code 4411.', 'Gate code 9090.')
    const back = crewTextBack(edited, saved)
    expect(back).toContain('Gate code 9090.')
    expect(back).toContain('saw an estimate of $4,321 (Better).')
    expect(back).toContain('Customer was quoted $5,200.')
    // Through the generic write path (restoreCosts) too.
    expect((restoreCosts({ notes: `${view}\nDog is friendly.` }, { notes: saved }, { prices: true }) as any).notes).toBe(`${saved}\nDog is friendly.`)
  })
})

describe('Start and Finish in words', () => {
  const info = { lastDay: '2026-10-27', crewDays: ['2026-10-26', '2026-10-27'] }
  const t = (kind: 'start' | 'finish', day: string, jobDone = false) => ({ kind, day, at: `${day}T15:00:00Z`, by: 'Crew', ...(jobDone ? { jobDone } : {}) })
  test('a one day job\'s Finish is "Finished the job"', () => {
    expect(finishWords(t('finish', '2026-10-26'), { lastDay: '2026-10-26', crewDays: ['2026-10-26'] })).toBe('Finished the job')
  })
  test('day 1 of 2 is "Finished day 1 of 2"; the last day, or "We finished the whole job", is "Finished the job"', () => {
    expect(finishWords(t('finish', '2026-10-26'), info)).toBe('Finished day 1 of 2')
    expect(finishWords(t('finish', '2026-10-27'), info)).toBe('Finished the job')
    expect(finishWords(t('finish', '2026-10-26', true), info)).toBe('Finished the job')
    expect(finishWords(t('start', '2026-10-27'), info)).toBe('Started day 2 of 2')
  })
  test('"Job finished" says what is still waiting, from the real close out', () => {
    expect(jobDoneWords({ closed: true, walkthroughSigned: true, paidInFull: true })).toBe('Job finished and closed out.')
    expect(jobDoneWords({ closed: false, walkthroughSigned: true, paidInFull: false })).toBe('Job finished. Waiting for the final payment.')
    expect(jobDoneWords({ closed: false, walkthroughSigned: false, paidInFull: true })).toBe('Job finished. Waiting for the final walkthrough to be signed.')
    expect(jobDoneWords({ closed: false, walkthroughSigned: false, paidInFull: false })).toMatch(/final walkthrough and the final payment/)
  })
})

describe('a repair on the packet and the walkthrough', () => {
  test('no posts line for a repair, nor when every count is 0; a new fence keeps it', () => {
    expect(postsLine({ corners: 0, ends: 0, gatePosts: 0 }, 'repair')).toBe('')
    expect(postsLine({ corners: 2, ends: 2, gatePosts: 0 }, 'repair')).toBe('')
    expect(postsLine({ corners: 0, ends: 0, gatePosts: 0 }, null)).toBe('')
    expect(postsLine({ corners: 2, ends: 3, gatePosts: 1 }, null)).toBe('<p data-packet-posts>2 corner posts · 2 end posts · 1 gate post</p>')
  })
  test('a rehung gate is a gate to photograph', () => {
    const work = { type: 'repair', repair: { items: { rehangGate: 1, replacePost: 2 } } }
    expect(repairGateCount(work)).toBe(1)
    expect(repairGateCount({ type: 'move' })).toBe(0)
    expect(photoSlots({ sideCount: 1, gateCount: 0, repairGates: repairGateCount(work) }).filter(s => s.kind === 'gate')).toHaveLength(1)
    const layout = { sides: [{ id: 'a', name: 'Back', on: true, gate: null }] } as any
    expect(photoSlots({ layout, repairGates: 1 }).filter(s => s.kind === 'gate').map(s => s.label)).toEqual(['Gate 1 (repaired)'])
  })
})

describe('a closed job moving back is a reopen', () => {
  test('Paid to Punch List, Paid to Complete and a hold are back; Complete to Paid is not', () => {
    expect(movesBack(START_OPS_STAGES, 'paid', 'punch_list')).toBe(true)
    expect(movesBack(START_OPS_STAGES, 'paid', 'completed')).toBe(true)
    expect(movesBack(START_OPS_STAGES, 'paid', 'on_hold')).toBe(true)
    expect(movesBack(START_OPS_STAGES, 'completed', 'paid')).toBe(false)
    expect(movesBack(START_OPS_STAGES, 'completed', 'invoiced')).toBe(false)
  })
})
