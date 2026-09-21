import { describe, expect, it } from 'vitest'
import { OfficeNumberingSchema, OfficeTextStyleSchema } from '../model.js'
import { officeNumberLabel, officeNumberingCounter } from '../numbering.js'

const definition = { listId: '00000000-0000-4000-8000-000000000001', start: 1, pattern: '%1)', format: 'upperRoman' as const }
describe('[COMP:office/model] Bounded numbering and width scale', () => {
  it('keeps independent counters and supports Roman and letter transitions', () => {
    const next = officeNumberingCounter()
    const letters = { ...definition, listId: '00000000-0000-4000-8000-000000000002', format: 'upperLetter' as const, start: 26 }
    expect(next(definition)).toBe('I)')
    expect(next(letters)).toBe('Z)')
    expect(next(definition)).toBe('II)')
    expect(next(letters)).toBe('AA)')
    expect(next({ ...definition, listId: '00000000-0000-4000-8000-000000000003', format: 'lowerRoman', start: 49 })).toBe('xlix)')
  })
  it.each(['upperLetter', 'lowerLetter'] as const)('uses Word repeated letters beyond item 27 (%s)', format => {
    const values = [26, 27, 28, 29, 52, 53, 54, 78, 79]
    const expected = ['Z)', 'AA)', 'BB)', 'CC)', 'ZZ)', 'AAA)', 'BBB)', 'ZZZ)', 'AAAA)']
    expect(values.map(value => officeNumberLabel({ ...definition, format }, value))).toEqual(format === 'lowerLetter' ? expected.map(label => label.toLowerCase()) : expected)
    const next = officeNumberingCounter()
    expect(Array.from({ length: 4 }, () => next({ ...definition, format, start: 27 }))).toEqual((format === 'lowerLetter' ? ['aa)', 'bb)', 'cc)', 'dd)'] : ['AA)', 'BB)', 'CC)', 'DD)']))
  })
  it('rejects executable-looking/multilevel patterns, invalid starts and unbounded scale', () => {
    for (const pattern of ['%1.%2', '<script>%1', '%1\n', '%7']) expect(OfficeNumberingSchema.safeParse({ ...definition, pattern }).success).toBe(false)
    for (const start of [0, -1, Infinity, 4000]) expect(OfficeNumberingSchema.safeParse({ ...definition, start }).success).toBe(false)
    const style = { fontFamily: 'Arial', fontSizePt: 12, color: '#111111' }
    for (const widthScalePercent of [0, 9, 601, NaN, Infinity, 80.5]) expect(OfficeTextStyleSchema.safeParse({ ...style, widthScalePercent }).success).toBe(false)
    expect(OfficeTextStyleSchema.parse({ ...style, widthScalePercent: 80 }).widthScalePercent).toBe(80)
  })
})
