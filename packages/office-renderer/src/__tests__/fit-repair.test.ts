import { describe, expect, it } from 'vitest'
import type { DocumentSnapshot, PresentationSnapshot } from '@use-brian/office-model'
import { repairOfficeArtifactFit } from '../fit-repair.js'

const style = { fontFamily: 'Arial', fontSizePt: 12, bold: true, italic: false, underline: false, strike: false, color: '#111111' }
function document(): DocumentSnapshot {
  return { schemaVersion: 1, capabilityVersion: 1, artifactId: 'artifact', workspaceId: 'workspace', family: 'document', locale: 'en-US', defaultLanguage: 'en-US', templateVersionId: null, rootId: 'root', title: 'Doc', resources: [], accessibility: { title: 'Doc' }, sections: [{ id: 'section', page: { widthPt: 200, heightPt: 100, marginTopPt: 20, marginRightPt: 20, marginBottomPt: 20, marginLeftPt: 20, orientation: 'portrait' }, header: [], footer: [], showPageNumber: false, nodes: [{ id: 'target', kind: 'paragraph', styleName: 'Body', alignment: 'start', runs: [{ id: 'run', text: 'Preserve these facts', style }] }] }] }
}
function presentation(): PresentationSnapshot {
  const { sections: _, ...base } = document()
  return { ...base, family: 'presentation', themeId: 'theme', slideSize: { widthPt: 300, heightPt: 200 }, masters: [{ id: 'master', name: 'Master', lockedObjectIds: [] }], layouts: [{ id: 'layout', masterId: 'master', name: 'Layout', placeholderIds: [] }], slides: [{ id: 'slide', title: 'Slide', masterId: 'master', layoutId: 'layout', notes: [], readingOrder: ['target'], objects: [{ id: 'target', kind: 'text', locked: false, geometry: { xPt: 10, yPt: 10, widthPt: 200, heightPt: 13, rotationDeg: 0 }, alignment: 'start', verticalAlignment: 'top', runs: [{ id: 'run', text: 'Facts', style }] }] }] }
}
const forceFailure = { maxPages: 0, maxSlides: 0 }
describe('[COMP:office/fit-repair] controlled fit repair', () => {
  it('progressively repairs PPTX with at most three candidates, retaining text/style/IDs', () => {
    const source = presentation()
    const original = structuredClone(source)
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['target'] })
    expect(result.fit.ok).toBe(true)
    expect(result.fit.attempts).toBeGreaterThan(1)
    expect(result.fit.attempts).toBeLessThanOrEqual(3)
    expect(result.changes[0]).toMatchObject({ attempt: 2, fromPt: 12, toPt: 11, runId: 'run' })
    expect(source).toEqual(original)
    const repaired = structuredClone(result.candidate)
    if (repaired.slides[0].objects[0].kind === 'text') repaired.slides[0].objects[0].runs[0].style.fontSizePt = 12
    expect(repaired).toEqual(source)
  })
  it('shrinks DOCX only within explicit run scope and leaves unrelated template text', () => {
    const source = document()
    const node = source.sections[0].nodes[0]
    if (node.kind !== 'paragraph') throw new Error('fixture')
    node.runs.push({ id: 'untouched', text: 'Source text', style: { ...style } })
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['run'], budget: forceFailure })
    const output = result.candidate.sections[0].nodes[0]
    expect(output).toMatchObject({ runs: [{ id: 'run', text: 'Preserve these facts', style: { fontSizePt: 10 } }, { id: 'untouched', style: { fontSizePt: 12 } }] })
    expect(result.fit.ok).toBe(false)
    expect(result.diagnostics).toEqual(result.history.at(-1)?.issues)
    expect(result.fit.attempts).toBe(3)
  })
  it.each(['section', 'root', 'missing'])('does not authorize descendants of %s', id => {
    const result = repairOfficeArtifactFit(document(), { eligibleTargetIds: [id], budget: forceFailure })
    expect(result.changes).toEqual([])
    expect(result.fit.attempts).toBe(1)
  })
  it.each(['object', 'master', 'external'])('honors %s locks even when a run is eligible', lock => {
    const source = presentation()
    if (lock === 'object') source.slides[0].objects[0].locked = true
    if (lock === 'master') source.masters[0].lockedObjectIds = ['target']
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['run'], lockedTargetIds: lock === 'external' ? ['slide'] : [], budget: forceFailure })
    expect(result.changes).toEqual([])
    expect(result.fit.ok).toBe(false)
  })
  it('clamps to the stricter floor, never enlarges undersized imported runs', () => {
    const source = presentation()
    const object = source.slides[0].objects[0]
    if (object.kind !== 'text') throw new Error('fixture')
    object.runs.push({ id: 'tiny', text: 'tiny', style: { ...style, fontSizePt: 6 } })
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['target'], minimumFontSizePt: 2, stepPt: 100, budget: { ...forceFailure, minimumFontSizePt: 9 } })
    expect(result.changes.map(c => c.toPt)).toEqual([9])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'readability', objectId: 'tiny' }))
    expect(result.candidate.slides[0].objects[0]).toMatchObject({ runs: [{ style: { fontSizePt: 9 } }, { style: { fontSizePt: 6 } }] })
  })
  it('does not repair already-fitting candidates or exceed remaining budget', () => {
    expect(repairOfficeArtifactFit(document(), { eligibleTargetIds: ['target'] }).changes).toEqual([])
    expect(repairOfficeArtifactFit(presentation(), { eligibleTargetIds: ['target'], maxAttempts: 1 }).changes).toEqual([])
  })
  it('supports table-cell and header run IDs without authorizing whole tables or headers', () => {
    const source = document()
    source.sections[0].header = [{ id: 'header-run', text: 'Header', style }]
    source.sections[0].nodes = [{ id: 'table', kind: 'table', headerRows: 0, rows: [{ id: 'row', cells: [{ id: 'cell', rowSpan: 1, colSpan: 1, runs: [{ id: 'cell-run', text: 'Value', style }] }] }] }]
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['cell', 'header-run'], budget: forceFailure })
    expect(result.changes.map(change => change.runId)).toEqual(['header-run', 'cell-run', 'header-run', 'cell-run'])
    expect(repairOfficeArtifactFit(source, { eligibleTargetIds: ['table', 'section'], budget: forceFailure }).changes).toEqual([])
  })
  it('supports shape text without changing shape geometry', () => {
    const source = presentation()
    const geometry = source.slides[0].objects[0].geometry
    source.slides[0].objects = [{ id: 'shape', kind: 'shape', shape: 'rectangle', locked: false, geometry, strokeWidthPt: 1, text: [{ id: 'shape-run', text: 'Fact', style }] }]
    const result = repairOfficeArtifactFit(source, { eligibleTargetIds: ['shape'], budget: forceFailure })
    expect(result.candidate.slides[0].objects[0]).toMatchObject({ geometry, text: [{ id: 'shape-run', text: 'Fact', style: { fontSizePt: 10 } }] })
  })
  it.each([{ maxAttempts: 4 }, { maxAttempts: NaN }, { stepPt: 0 }, { stepPt: Infinity }, { minimumFontSizePt: NaN }])('rejects invalid policy %j', options => {
    expect(() => repairOfficeArtifactFit(document(), { eligibleTargetIds: ['target'], ...options })).toThrow(RangeError)
  })
})
