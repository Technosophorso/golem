import { describe, expect, it } from 'vitest'
import { documentFixture, spreadsheetFixture } from '../../../../../office-model/src/__tests__/fixtures.js'
import { inferOfficeTemplateRouting, officeTemplateRoutingDiagnostics } from '../routing.js'

describe('[COMP:office/template-routing] literal template routing', () => {
  it('discovers split uppercase tokens, deduplicates targets and validates exact bindings', () => {
    const snapshot = documentFixture()
    const section = snapshot.sections[0]!
    const node = section.nodes[0]!
    if (node.kind !== 'paragraph') throw new Error('fixture')
    const run = node.runs[0]!
    node.runs = [{ ...run, text: '{{CU' }, { ...run, text: 'STOM}} {{CUSTOM}}' }]
    section.header = [{ ...run, text: '{{CUSTOM}} {{X}}' }]
    const routing = inferOfficeTemplateRouting(snapshot)
    expect(routing.fields.map((f) => f.name)).toEqual(['CUSTOM', 'X'])
    expect(routing.fields[0]).toMatchObject({ required: false, type: 'plainText', maxLength: 100_000, targetIds: [section.id, node.id] })
    expect(routing.fields[0]!.aiInstruction).toBeTruthy()
    expect(officeTemplateRoutingDiagnostics(snapshot, routing)).toEqual([])
    routing.fields[0]!.targetIds = [section.id]
    expect(officeTemplateRoutingDiagnostics(snapshot, routing).join()).toContain('exactly')
  })
  it('rejects empty inventories, missing metadata, duplicate names and unsupported repetition', () => {
    const snapshot = documentFixture()
    expect(officeTemplateRoutingDiagnostics(snapshot, inferOfficeTemplateRouting(snapshot)).join()).toContain('no fillable')
    snapshot.sections[0]!.header = [{ id: snapshot.rootId, text: '{{X}}', style: { fontFamily: 'Arial', fontSizePt: 11, bold: false, italic: false, underline: false, strike: false, color: '#111111' } }]
    const routing = inferOfficeTemplateRouting(snapshot)
    expect(officeTemplateRoutingDiagnostics(snapshot, { ...routing, fields: [] }).join()).toContain('Missing configuration')
    expect(officeTemplateRoutingDiagnostics(snapshot, { ...routing, fields: [...routing.fields, ...routing.fields] }).join()).toContain('Duplicate')
    routing.fields[0]!.repeating = true
    expect(officeTemplateRoutingDiagnostics(snapshot, routing).join()).toContain('cannot repeat')
  })
  it('binds spreadsheet literal cells, never formulas or arbitrary expressions', () => {
    const snapshot = spreadsheetFixture()
    const sheet = snapshot.worksheets[0]!
    const cell = sheet.cells[0]!
    sheet.cells = [{ ...cell, valueType: 'string', value: '{{AMOUNT}}', formula: undefined }, { ...cell, id: sheet.id, valueType: 'string', value: '{{FORMULA}}', formula: '1+1' }]
    const routing = inferOfficeTemplateRouting(snapshot)
    expect(routing.fields.map((f) => [f.name, f.targetIds])).toEqual([['AMOUNT', [cell.id]]])
    expect(officeTemplateRoutingDiagnostics(snapshot, routing)).toEqual([])
    sheet.cells[0]!.value = '{{#each ROWS}}'
    expect(inferOfficeTemplateRouting(snapshot).fields).toEqual([])
  })
  it('rejects locked cells and whitespace-only instructions at admission', () => {
    const snapshot = spreadsheetFixture()
    const cell = snapshot.worksheets[0]!.cells[0]!
    snapshot.worksheets[0]!.cells = [{ ...cell, valueType: 'string', value: '{{X}}', formula: undefined, locked: true }]
    const routing = inferOfficeTemplateRouting(snapshot)
    expect(officeTemplateRoutingDiagnostics(snapshot, routing).join()).toContain('locked')
    snapshot.worksheets[0]!.cells[0]!.locked = false
    routing.fields[0]!.aiInstruction = '   '
    expect(officeTemplateRoutingDiagnostics(snapshot, routing).join()).toContain('nonblank')
  })

})
