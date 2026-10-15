/**
 * The voice phrase parser against real phrases, including near misses that
 * must come back as "not understood" instead of being guessed.
 */

import { describe, test, expect } from 'vitest'
import { parseUtterance, readLength, words, questionsFor, answerQuestion, applySideIntent, describeSide, spokenNumber, type VoiceIntent } from '../../web/src/voiceParser'
import { layoutForShape } from '../../web/src/yardLayout'

const BACKYARD = ['Left return', 'Left side', 'Back', 'Right side', 'Right return']
const FT = (n: number) => n * 12

type Case = [phrase: string, expected: Partial<VoiceIntent>[] | 'unknown', current?: string]
function run(cases: Case[], names = BACKYARD) {
  for (const [phrase, expected, current] of cases) {
    test(phrase, () => {
      const r = parseUtterance(phrase, { sideNames: names, currentSide: current })
      if (expected === 'unknown') {
        expect(r.unknown.length, JSON.stringify(r)).toBeGreaterThan(0)
      } else {
        expect(r.intents).toMatchObject(expected)
        expect(r.intents).toHaveLength(expected.length)
        expect(r.unknown, JSON.stringify(r)).toEqual([])
      }
    })
  }
}

describe('lengths', () => {
  const cases: Array<[string, number]> = [
    ['one twenty', FT(120)], ['120', FT(120)], ['one hundred twenty', FT(120)], ['a hundred and twenty', FT(120)],
    ['one fifty', FT(150)], ['eighty', FT(80)], ['eighty one', FT(81)], ['eighty one and a half', FT(81) + 6],
    ['eighty feet four inches', FT(80) + 4], ['80 4', FT(80) + 4], ["80' 4\"", FT(80) + 4], ['80 feet 4 inches', FT(80) + 4],
    ['eighty feet and four inches', FT(80) + 4], ['two oh five', FT(205)], ['two hundred', FT(200)], ['thirty', FT(30)],
    ['thirty and a half', FT(30) + 6], ['12', FT(12)], ['twelve feet six inches', FT(12) + 6], ['one twelve', FT(112)],
    ['a hundred and five', FT(105)], ['three hundred', FT(300)], ['nine', FT(9)], ['80.5', FT(80) + 6],
    ['sixty six feet', FT(66)], ['forty five', FT(45)], ['ninety nine', FT(99)], ['one oh one', FT(101)],
  ]
  for (const [t, inches] of cases) test(t, () => expect(readLength(words(t), 0)?.inches).toBe(inches))
})

describe('sides and lengths', () => run([
  ['left side one twenty', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }]],
  ['Left side 120', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }]],
  ['back one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['the back is one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['back fence one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['rear one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['right side one twenty', [{ kind: 'side', side: 'Right side', lengthIn: FT(120) }]],
  ['right return thirty', [{ kind: 'side', side: 'Right return', lengthIn: FT(30) }]],
  ['left return is thirty feet', [{ kind: 'side', side: 'Left return', lengthIn: FT(30) }]],
  ['left one twenty', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }]],
  ['right one twenty', [{ kind: 'side', side: 'Right side', lengthIn: FT(120) }]],
  ['left side eighty one and a half', [{ kind: 'side', side: 'Left side', lengthIn: FT(81) + 6 }]],
  ['back eighty feet four inches', [{ kind: 'side', side: 'Back', lengthIn: FT(80) + 4 }]],
  ['back 80 4', [{ kind: 'side', side: 'Back', lengthIn: FT(80) + 4 }]],
  ['left side one twenty, back one fifty', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }, { kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['left side one twenty back one fifty right side one twenty', [
    { kind: 'side', side: 'Left side', lengthIn: FT(120) }, { kind: 'side', side: 'Back', lengthIn: FT(150) }, { kind: 'side', side: 'Right side', lengthIn: FT(120) }]],
  ['left return thirty, left side one twenty, back one fifty, right side one twenty, right return thirty', [
    { side: 'Left return', lengthIn: FT(30) }, { side: 'Left side', lengthIn: FT(120) }, { side: 'Back', lengthIn: FT(150) }, { side: 'Right side', lengthIn: FT(120) }, { side: 'Right return', lengthIn: FT(30) }]],
  ['um the back is about one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['okay left side is 120 feet', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }]],
  ['back a hundred and fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['back two oh five', [{ kind: 'side', side: 'Back', lengthIn: FT(205) }]],
  ['Back: 150 ft', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['back 150ft', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }]],
  ['right return 30 feet 6 inches', [{ kind: 'side', side: 'Right return', lengthIn: FT(30) + 6 }]],
  ['back one fifty and a half', [{ kind: 'side', side: 'Back', lengthIn: FT(150) + 6 }]],
  // whisper.cpp's own output for a spoken test phrase on the Mac
  ['Left side 120, back 150, right return 30 with a 4-foot gate in the middle.', [
    { side: 'Left side', lengthIn: FT(120) }, { side: 'Back', lengthIn: FT(150) }, { side: 'Right return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48, place: { at: 'middle' } } }]],
  ['Right return, 30, with a 10-foot double gate by the house.', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double', widthIn: 120, place: { at: 'near', toward: 'house' } } }]],
]))

describe('the side being asked about', () => run([
  ['thirty', [{ kind: 'side', side: 'Left return', lengthIn: FT(30) }], 'Left return'],
  ['one twenty', [{ kind: 'side', side: 'Left side', lengthIn: FT(120) }], 'Left side'],
  ['thirty with a four foot gate in the middle', [{ kind: 'side', side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48, place: { at: 'middle' } } }], 'Left return'],
  ['eighty one and a half', [{ kind: 'side', side: 'Back', lengthIn: FT(81) + 6 }], 'Back'],
  ['it is one fifty', [{ kind: 'side', side: 'Back', lengthIn: FT(150) }], 'Back'],
  ['80 4', [{ kind: 'side', side: 'Back', lengthIn: FT(80) + 4 }], 'Back'],
  ['twelve feet six inches', [{ kind: 'side', side: 'Right return', lengthIn: FT(12) + 6 }], 'Right return'],
  ['about ninety', [{ kind: 'side', side: 'Back', lengthIn: FT(90) }], 'Back'],
  ['thirty meets the house', [{ kind: 'side', side: 'Left return', lengthIn: FT(30), finish: { finish: 'house' } }], 'Left return'],
  ['no gate', [{ kind: 'side', side: 'Left return', gate: null }], 'Left return'],
]))

describe('gates', () => run([
  ['right return thirty with a four foot gate', [{ kind: 'side', side: 'Right return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48 } }]],
  ['left return thirty four foot gate in the middle', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48, place: { at: 'middle' } } }]],
  ['right return thirty ten foot double by the house', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double', widthIn: 120, place: { at: 'near', toward: 'house' } } }]],
  ['right return thirty with a ten foot double gate', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double', widthIn: 120 } }]],
  ['left return thirty walk gate near the corner', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', place: { at: 'near', toward: 'corner' } } }]],
  ['back one fifty with a gate 10 feet from the corner', [{ side: 'Back', lengthIn: FT(150), gate: { type: 'walk', place: { at: 'distance', from: 'corner', distanceIn: FT(10) } } }]],
  ['left return thirty gate four feet from the house', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', place: { at: 'distance', from: 'house', distanceIn: FT(4) } } }]],
  ['left return thirty with a 5 foot gate', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 60 } }]],
  ['left return thirty and a walk gate', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk' } }]],
  ['left return thirty with a single gate', [{ side: 'Left return', lengthIn: FT(30), gate: { type: 'walk' } }]],
  ['right return thirty with a driveway gate', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double' } }]],
  ['right return thirty double gate in the center', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double', place: { at: 'middle' } } }]],
  ['right return thirty twelve foot double in the middle', [{ side: 'Right return', lengthIn: FT(30), gate: { type: 'double', widthIn: 144, place: { at: 'middle' } } }]],
  ['left return no gate', [{ side: 'Left return', gate: null }]],
  ['left return remove the gate', [{ side: 'Left return', gate: null }]],
  ['four foot gate in the middle', [{ kind: 'side', side: 'Left return', gate: { type: 'walk', widthIn: 48, place: { at: 'middle' } } }], 'Left return'],
  ['ten foot double by the house', [{ kind: 'side', side: 'Right return', gate: { type: 'double', widthIn: 120, place: { at: 'near', toward: 'house' } } }], 'Right return'],
  ['gate near the house', [{ kind: 'side', side: 'Left return', gate: { type: 'walk', place: { at: 'near', toward: 'house' } } }], 'Left return'],
  ['back one fifty gate next to the corner', [{ side: 'Back', lengthIn: FT(150), gate: { place: { at: 'near', toward: 'corner' } } }]],
  ['left side one twenty with a 4 foot gate by the house', [{ side: 'Left side', lengthIn: FT(120), gate: { type: 'walk', widthIn: 48, place: { at: 'near', toward: 'house' } } }]],
  ['right return thirty with a four foot gate, left return thirty with a ten foot double', [
    { side: 'Right return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48 } }, { side: 'Left return', lengthIn: FT(30), gate: { type: 'double', widthIn: 120 } }]],
]))

describe('finishes', () => run([
  ['left return meets the house', [{ side: 'Left return', finish: { finish: 'house' } }]],
  ['left return starts at the house', [{ side: 'Left return', finish: { finish: 'house', end: 'start' } }]],
  ['left side from the house', [{ side: 'Left side', finish: { finish: 'house', end: 'start' } }]],
  ['back ties into the neighbors fence', [{ side: 'Back', finish: { finish: 'existing' } }]],
  ["back ties into the neighbor's fence", [{ side: 'Back', finish: { finish: 'existing' } }]],
  ['back ends at the neighbors fence', [{ side: 'Back', finish: { finish: 'existing', end: 'end' } }]],
  ['right side ties into the existing fence', [{ side: 'Right side', finish: { finish: 'existing' } }]],
  ['back stops', [{ side: 'Back', finish: { finish: 'free' } }]],
  ['back just stops', [{ side: 'Back', finish: { finish: 'free' } }]],
  ['back dead ends', [{ side: 'Back', finish: { finish: 'free' } }]],
  ['right side ends here', [{ side: 'Right side', finish: { finish: 'free', end: 'end' } }]],
  ['back corner', [{ side: 'Back', finish: { finish: 'corner' } }]],
  ['left side one twenty from the house', [{ side: 'Left side', lengthIn: FT(120), finish: { finish: 'house', end: 'start' } }]],
  ['back one fifty ties into the neighbors fence', [{ side: 'Back', lengthIn: FT(150), finish: { finish: 'existing' } }]],
  ['right return thirty meets the house', [{ side: 'Right return', lengthIn: FT(30), finish: { finish: 'house' } }]],
  ['ties into the neighbors fence', [{ side: 'Back', finish: { finish: 'existing' } }], 'Back'],
  ['stops', [{ side: 'Back', finish: { finish: 'free' } }], 'Back'],
  ['no right return', [{ kind: 'side-off', side: 'Right return' }]],
  ['no left return', [{ kind: 'side-off', side: 'Left return' }]],
  ['right return off', [{ kind: 'side-off', side: 'Right return' }]],
  ['turn off the right side', [{ kind: 'side-off', side: 'Right side' }]],
  ['skip the right return', [{ kind: 'side-off', side: 'Right return' }]],
  ['no right return, no left return', [{ kind: 'side-off', side: 'Right return' }, { kind: 'side-off', side: 'Left return' }]],
  ['left side one twenty, no right side', [{ side: 'Left side', lengthIn: FT(120) }, { kind: 'side-off', side: 'Right side' }]],
]))

describe('skips', () => run([
  ['back one fifty skip forty for the neighbors fence', [{ side: 'Back', lengthIn: FT(150), skip: { kind: 'existing', lengthIn: FT(40) } }]],
  ["back one fifty, skip forty for the neighbor's fence", [{ side: 'Back', lengthIn: FT(150), skip: { kind: 'existing', lengthIn: FT(40) } }]],
  ['back skip twenty', [{ side: 'Back', skip: { kind: 'existing', lengthIn: FT(20) } }]],
  ['back one fifty skip twenty no fence', [{ side: 'Back', lengthIn: FT(150), skip: { kind: 'none', lengthIn: FT(20) } }]],
  ['back one fifty with a gap of twelve feet', [{ side: 'Back', lengthIn: FT(150), skip: { kind: 'none', lengthIn: FT(12) } }]],
  ['back one fifty existing fence forty feet', [{ side: 'Back', lengthIn: FT(150), skip: { kind: 'existing', lengthIn: FT(40) } }]],
  ['skip forty for the neighbors fence', [{ side: 'Back', skip: { kind: 'existing', lengthIn: FT(40) } }], 'Back'],
  ['skip 40 feet existing', [{ side: 'Back', skip: { kind: 'existing', lengthIn: FT(40) } }], 'Back'],
  ['left side one twenty skip ten for the old fence', [{ side: 'Left side', lengthIn: FT(120), skip: { kind: 'existing', lengthIn: FT(10) } }]],
]))

describe('style', () => run([
  ['white vinyl no dig', [{ kind: 'style', color: 'white', install: 'no-dig' }]],
  ['tan dig set', [{ kind: 'style', color: 'tan', install: 'dig-set' }]],
  ['tan vinyl', [{ kind: 'style', color: 'tan' }]],
  ['white vinyl privacy dig set', [{ kind: 'style', color: 'white', install: 'dig-set' }]],
  ['eight foot sections', [{ kind: 'style', widthFt: 8 }]],
  ['six foot sections', [{ kind: 'style', widthFt: 6 }]],
  ['8 foot panels', [{ kind: 'style', widthFt: 8 }]],
  ['six foot tall', [{ kind: 'style', heightFt: 6 }]],
  ['eight foot tall white vinyl', [{ kind: 'style', heightFt: 8, color: 'white' }]],
  ['white vinyl no dig eight foot sections', [{ kind: 'style', color: 'white', install: 'no-dig', widthFt: 8 }]],
  ['set in concrete', [{ kind: 'style', install: 'dig-set' }]],
  ['white vinyl no dig, left side one twenty', [{ kind: 'style', color: 'white', install: 'no-dig' }, { side: 'Left side', lengthIn: FT(120) }]],
]))

describe('commands', () => run([
  ['undo', [{ kind: 'undo' }]], ['undo that', [{ kind: 'undo' }]], ['scratch that', [{ kind: 'undo' }]], ['never mind', [{ kind: 'undo' }]],
  ['read it back', [{ kind: 'readback' }]], ['read back', [{ kind: 'readback' }]], ['what do you have', [{ kind: 'readback' }]], ['repeat that', [{ kind: 'readback' }]],
  ["what's the total", [{ kind: 'total' }]], ['what is the total', [{ kind: 'total' }]], ['how much', [{ kind: 'total' }]], ['total footage', [{ kind: 'total' }]],
  ['done', [{ kind: 'done' }]], ["that's it", [{ kind: 'done' }]], ['all done', [{ kind: 'done' }]], ['finished', [{ kind: 'done' }]],
  ['stop', [{ kind: 'stop' }]], ['stop listening', [{ kind: 'stop' }]], ['cancel', [{ kind: 'stop' }]],
  ['photo', [{ kind: 'photo' }]], ['take a photo', [{ kind: 'photo' }]], ['take a picture', [{ kind: 'photo' }]], ['camera', [{ kind: 'photo' }]],
  ['note gate code is 4512', [{ kind: 'note', text: 'gate code is 4512' }]],
  ['Note: dog in the yard, call before coming', [{ kind: 'note', text: 'dog in the yard, call before coming' }]],
  ['crew note sprinkler heads along the back', [{ kind: 'note', text: 'sprinkler heads along the back' }]],
  ['add a note HOA wants tan', [{ kind: 'note', text: 'HOA wants tan' }]],
  ['change the back to one sixty', [{ kind: 'side', side: 'Back', lengthIn: FT(160) }]],
  ['change back to 160', [{ kind: 'side', side: 'Back', lengthIn: FT(160) }]],
  ['make the left side one twenty five', [{ kind: 'side', side: 'Left side', lengthIn: FT(125) }]],
  ['change the right return to thirty two', [{ kind: 'side', side: 'Right return', lengthIn: FT(32) }]],
  ['fix the back to one fifty five', [{ kind: 'side', side: 'Back', lengthIn: FT(155) }]],
  ['yes', [{ kind: 'yes' }]], ['yeah', [{ kind: 'yes' }]], ['correct', [{ kind: 'yes' }]], ['keep it', [{ kind: 'yes' }]],
  ['no', [{ kind: 'no' }]], ['nope', [{ kind: 'no' }]],
  ['fifty', [{ kind: 'number', lengthIn: FT(50) }]], ['fifteen', [{ kind: 'number', lengthIn: FT(15) }]],
]))

describe('custom side names', () => run([
  ['side one sixty', [{ kind: 'side', side: 'Side 1', lengthIn: FT(60) }]],
  ['side 2 forty', [{ kind: 'side', side: 'Side 2', lengthIn: FT(40) }]],
  ['pool side eighty', [{ kind: 'side', side: 'Pool side', lengthIn: FT(80) }]],
  ['driveway run fifty with a ten foot double gate', [{ kind: 'side', side: 'Driveway run', lengthIn: FT(50), gate: { type: 'double', widthIn: 120 } }]],
], ['Side 1', 'Side 2', 'Pool side', 'Driveway run']))

describe('near misses come back as not understood, never guessed', () => run([
  ['banana', 'unknown'],
  ['the back is long', 'unknown'],
  ['left side', 'unknown'],
  ['back purple', 'unknown'],
  ['how are you', 'unknown'],
  ['left side one twenty please hurry up', 'unknown'],
  ['back one fifty with a trampoline', 'unknown'],
  ['the neighbor said hi', 'unknown'],
  ['front one twenty', 'unknown'],
  ['middle', 'unknown'],
  ['gate code is 1234', 'unknown'],
  ['call the customer', 'unknown'],
  ['left side to the shed', 'unknown'],
  ['back one fifty maybe', 'unknown'],
  ['fence', 'unknown'],
  ['seventeen bananas', 'unknown'],
]))

describe('ask instead of accepting something odd', () => {
  const layout = () => {
    const l = layoutForShape('backyard')
    l.sides[1].lengthIn = FT(120); l.sides[2].lengthIn = FT(150); l.sides[3].lengthIn = FT(120)
    return l
  }
  test('fifteen when the other sides are long: fifteen or fifty?', () => {
    const q = questionsFor({ kind: 'side', side: 'Left return', lengthIn: FT(15) }, layout(), 8)
    expect(q?.text).toBe('Left return: fifteen or fifty?')
    expect(answerQuestion(q!, 'fifty')).toEqual({ lengthIn: FT(50) })
    expect(answerQuestion(q!, 'fifteen')).toEqual({ lengthIn: FT(15) })
    expect(answerQuestion(q!, 'yes')).toEqual({ lengthIn: FT(15) })
  })
  test('eighteen when the others are about eighty: eighteen or eighty?', () => {
    const l = layout(); l.sides[1].lengthIn = FT(80); l.sides[3].lengthIn = FT(85); l.sides[2].lengthIn = FT(90)
    expect(questionsFor({ kind: 'side', side: 'Left return', lengthIn: FT(18) }, l, 8)?.text).toBe('Left return: eighteen or eighty?')
  })
  test('six fifty is not asked as six fifteen; it gets the over 600 ft question', () => {
    expect(questionsFor({ kind: 'side', side: 'Back', lengthIn: FT(650) }, layout(), 8)?.text).toMatch(/over 600 feet/)
  })
  test('a length that fits the other sides is not asked', () => {
    expect(questionsFor({ kind: 'side', side: 'Left return', lengthIn: FT(31) }, layout(), 8)).toBeNull()
    expect(questionsFor({ kind: 'side', side: 'Back', lengthIn: FT(150) + 3 * 12 }, layout(), 8)).toBeNull()
  })
  test('under 6 ft or over 600 ft', () => {
    expect(questionsFor({ kind: 'side', side: 'Left return', lengthIn: FT(4) }, layout(), 8)?.text).toMatch(/under 6 feet/)
    expect(questionsFor({ kind: 'side', side: 'Back', lengthIn: FT(650) }, layout(), 8)?.text).toMatch(/over 600 feet/)
  })
  test('a gate wider than its side', () => {
    expect(questionsFor({ kind: 'side', side: 'Left return', lengthIn: FT(9), gate: { type: 'double', widthIn: 120 } }, layout(), 8)?.text).toMatch(/gate \(10' 0"\) is as wide as the left return/)
  })
  test('the tape measure reminder', () => {
    expect(questionsFor({ kind: 'side', side: 'Back', lengthIn: FT(160) }, layout(), 8)?.text).toBe("Back 160' 0\" lands right on 20 sections. Check it with a tape measure. Say yes to keep it, or say the length again.")
    expect(answerQuestion(questionsFor({ kind: 'side', side: 'Back', lengthIn: FT(160) }, layout(), 8)!, 'one sixty two')).toEqual({ lengthIn: FT(162) })
  })
})

describe('applying and reading back', () => {
  test('a return with a gate in the middle, read back', () => {
    const l = applySideIntent(layoutForShape('backyard'), { kind: 'side', side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48, place: { at: 'middle' } } })
    expect(describeSide(l.sides[0])).toBe('Left return, 30 feet, 4 foot walk gate in the middle')
  })
  test('a double by the house goes to the house end', () => {
    const l = applySideIntent(layoutForShape('backyard'), { kind: 'side', side: 'Right return', lengthIn: FT(30), gate: { type: 'double', widthIn: 120, place: { at: 'near', toward: 'house' } } })
    expect(l.sides[4].gate?.position).toBe('end')
    expect(describeSide(l.sides[4])).toBe('Right return, 30 feet, 10 foot double gate near the house')
  })
  test('a gate measured from the far end', () => {
    const l = applySideIntent(layoutForShape('backyard'), { kind: 'side', side: 'Left return', lengthIn: FT(30), gate: { type: 'walk', widthIn: 48, place: { at: 'distance', from: 'corner', distanceIn: FT(6) } } })
    // Left return runs house → corner, so 6 ft from the corner is 20 ft from the start.
    expect(l.sides[0].gate).toMatchObject({ position: 'distance', distanceIn: FT(20) })
  })
  test('meets the house on a side that had a corner start', () => {
    const l0 = layoutForShape('backyard'); l0.sides[0].on = false
    const l = applySideIntent(l0, { kind: 'side', side: 'Left side', finish: { finish: 'house', end: 'start' } })
    expect(l.sides[1].startFinish).toBe('house')
  })
  test('spoken numbers', () => {
    expect([120, 150, 205, 30, 15, 100].map(spokenNumber)).toEqual(['one twenty', 'one fifty', 'two oh five', 'thirty', 'fifteen', 'one hundred'])
  })
})
