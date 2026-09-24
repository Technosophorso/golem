import { describe, it, expect } from 'vitest'
import { applyOfficeCommand } from '../commands.js'
import { translateSpreadsheetFormula } from '../spreadsheet-tables.js'
import { spreadsheetFixture, id } from './fixtures.js'

function fixture() {
  const s = spreadsheetFixture(), sheet = s.worksheets[0]
  sheet.cells = [
    { id: id(101), address: 'A2', valueType: 'number', value: 2, style: { fill: '#FF0000' }, numberFormat: '0.00', locked: false },
    { id: id(102), address: 'B2', valueType: 'number', value: null, formula: 'A2+$A$2', style: { fill: '#FF0000' }, locked: false },
  ]
  sheet.tables = [{ id: id(103), name: 'Records', ref: 'A1:B2', autoFilter: true, columns: [{ id: 1, name: 'Amount' }, { id: 2, name: 'Total' }], style: { name: '', showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false } }]
  return s
}
function command(s = fixture(), n = 200) { return { kind: 'appendSpreadsheetRecords' as const, commandId: id(n), artifactId: s.artifactId, baseVersion: 1, actor: { type: 'user' as const, id: id(201) }, origin: 'manual' as const, sheetId: s.worksheets[0].id, tableId: id(103), records: [{ '1': { valueType: 'number' as const, value: 5 } }] } }

describe('[COMP:office/spreadsheet-tables] canonical append', () => {
  it('appends twice preserving identities, styles, formulas and calculation', () => {
    const source = fixture()
    const first = applyOfficeCommand(source, command(source))
    if (first.family !== 'spreadsheet') throw Error()
    const second = applyOfficeCommand(first, command(first, 300))
    if (second.family !== 'spreadsheet') throw Error()
    expect(second.worksheets[0].tables![0].ref).toBe('A1:B4')
    expect(second.worksheets[0].cells.find(c => c.address === 'B4')).toMatchObject({ formula: 'A4+$A$2', calculatedValue: 7, style: { fill: '#FF0000' } })
    expect(second.worksheets[0].cells.find(c => c.address === 'A4')?.numberFormat).toBe('0.00')
    expect(source.worksheets[0].tables![0].ref).toBe('A1:B2')
    expect(() => applyOfficeCommand(second, command(source))).toThrow(/identity collision/)
    const explicit = applyOfficeCommand(second, { ...command(second, 400), prototypeRow: 2 })
    expect(explicit.family === 'spreadsheet' && explicit.worksheets[0].cells.find(c => c.address === 'B5')?.formula).toBe('A5+$A$2')
  })
  it('fails atomically on collisions, merges, locked prototypes and invalid scalars', () => {
    for (const mutate of [
      (s: ReturnType<typeof fixture>) => { s.worksheets[0].cells.push({ ...s.worksheets[0].cells[0], id: id(104), address: 'A3' }) },
      (s: ReturnType<typeof fixture>) => { s.worksheets[0].merges.push('A3:B3') },
      (s: ReturnType<typeof fixture>) => { s.worksheets[0].cells[0].locked = true },
      (s: ReturnType<typeof fixture>) => { s.worksheets[0].print.printArea = 'A1:B2' },
      (s: ReturnType<typeof fixture>) => { s.worksheets[0].rowDimensions = [{ index: 3, heightPt: 20, hidden: true }] },
    ]) { const s = fixture(); mutate(s); const before = structuredClone(s); expect(() => applyOfficeCommand(s, command(s))).toThrow(); expect(s).toEqual(before) }
    const c = command(); c.records[0]['1'].value = Infinity
    expect(() => applyOfficeCommand(fixture(), c)).toThrow()
  })
  it('preserves locked headers without blocking append to an unlocked prototype', () => {
    const source = fixture()
    source.worksheets[0].cells.push({ id: id(105), address: 'A1', valueType: 'string', value: 'Amount', style: {}, locked: true })
    const result = applyOfficeCommand(source, command(source))
    expect(result.family === 'spreadsheet' && result.worksheets[0].tables![0].ref).toBe('A1:B3')
    expect(result.family === 'spreadsheet' && result.worksheets[0].cells.find(c => c.address === 'A1')).toEqual(source.worksheets[0].cells[2])
  })
  it('bounds translation and preserves absolute references and string literals', () => {
    expect(translateSpreadsheetFormula('SUM(A2:$B$3)+$C2+D$4&"A2"', 2)).toBe('SUM(A4:$B$3)+$C4+D$4&"A2"')
    expect(translateSpreadsheetFormula(`'O''Brien A2'!$A2+Sheet1!B$3+"A2"`, 2)).toBe(`'O''Brien A2'!$A4+Sheet1!B$3+"A2"`)
    for (const f of ['Table1[Amount]', 'XFE1', 'A1048576', 'NamedRange', '"unterminated', "'[external]Sheet'!A2"]) expect(() => translateSpreadsheetFormula(f, 1)).toThrow()
  })
})

it('[COMP:office/spreadsheet-model] rejects cell ID/address aliases in the canonical executor', () => {
  const source = fixture()
  const base = command(source)
  for (const [cellId, address] of [[id(101), 'B2'], [id(101), 'C2'], [id(999), 'A2']]) {
    expect(() => applyOfficeCommand(source, { commandId: base.commandId, artifactId: base.artifactId, baseVersion: 1, actor: base.actor, origin: 'manual', kind: 'setSpreadsheetCell', sheetId: base.sheetId, cellId: cellId!, address: address!, valueType: 'number', value: 7 })).toThrow('identity/address mismatch')
  }
  expect(source.worksheets[0]!.cells[0]!.value).toBe(2)
})

it('deduplicates a retried append across two clients and supports Undo/Redo', async () => {
  const Y = await import('yjs')
  const { snapshotToYDoc, appendOfficeCommand, encodeOfficeState, applyOfficeUpdate, yDocToSnapshot, createOfficeUndoManager } = await import('../collab.js')
  const source = fixture(), first = snapshotToYDoc(source), second = new Y.Doc()
  applyOfficeUpdate(second, encodeOfficeState(first))
  const undo = createOfficeUndoManager(first)
  appendOfficeCommand(first, command(source))
  appendOfficeCommand(second, command(source))
  applyOfficeUpdate(second, encodeOfficeState(first))
  applyOfficeUpdate(first, encodeOfficeState(second))
  const result = yDocToSnapshot(first)
  expect(result).toEqual(yDocToSnapshot(second))
  expect(result.family === 'spreadsheet' && result.worksheets[0].tables![0].ref).toBe('A1:B3')
  // Test local undo independently of the duplicate remote ownership of the key.
  const local = snapshotToYDoc(source), history = createOfficeUndoManager(local)
  appendOfficeCommand(local, command(source))
  history.undo()
  expect(yDocToSnapshot(local)).toEqual(source)
  history.redo()
  expect(yDocToSnapshot(local)).toEqual(result)
  undo.destroy(); history.destroy(); first.destroy(); second.destroy(); local.destroy()
})

it('rejects overlapping rules atomically rather than silently dropping propagation', () => {
  const source = fixture()
  source.worksheets[0].validations = [{ id: id(910), range: 'A2', type: 'whole', operator: 'between', formulas: ['0', '10'], allowBlank: false }]
  const before = structuredClone(source)
  expect(() => applyOfficeCommand(source, command(source))).toThrow(/rule/)
  expect(source).toEqual(before)
})

it('copies quoted-sheet formulas and rejects a whole batch on calculation errors', () => {
  const source = fixture()
  source.worksheets[0].cells[1].formula = `'Invoice'!A2+$A$2`
  const result = applyOfficeCommand(source, command(source))
  expect(result.family === 'spreadsheet' && result.worksheets[0].cells.find(c => c.address === 'B3')).toMatchObject({ formula: `'Invoice'!A3+$A$2`, calculatedValue: 7 })
  source.worksheets[0].cells[1].formula = '1/A2'
  const batch = command(source)
  batch.records.push({ '1': { valueType: 'number', value: 0 } })
  const before = structuredClone(source)
  expect(() => applyOfficeCommand(source, batch)).toThrow(/recalculation/)
  expect(source).toEqual(before)
})

it('rejects merged/overlapping table regions at snapshot admission', async () => {
  const { SpreadsheetSnapshotSchema } = await import('../model.js')
  for (const merged of [true, false]) {
    const source = fixture(), sheet = source.worksheets[0]
    if (merged) sheet.merges.push('A1:B1')
    else sheet.tables!.push({ ...structuredClone(sheet.tables![0]), id: id(920), name: 'Other', ref: 'B2:C3' })
    expect(() => SpreadsheetSnapshotSchema.parse(source)).toThrow(/Overlapping/)
  }
})
