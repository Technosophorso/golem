import type { OfficeArtifactSnapshot, OfficeRichTextRun } from '@use-brian/office-model'
import { fitOfficeArtifact, type OfficeFitBudget, type OfficeFitResult } from './layout.js'

export type OfficeFitRepairOptions = {
  /** Explicit policy-approved text owner or run IDs; never expands to whole sections/slides. */
  eligibleTargetIds: readonly string[]
  /** Template locks not represented on the snapshot itself. Ancestor locks apply. */
  lockedTargetIds?: readonly string[]
  budget?: OfficeFitBudget
  minimumFontSizePt?: number
  /** Total candidate evaluations, including initial; 1..3. Share with the caller's job budget. */
  maxAttempts?: number
  stepPt?: number
}
export type OfficeFitRepairChange = { attempt: number; targetId: string; runId: string; fromPt: number; toPt: number }
export type OfficeFitRepairResult<T extends OfficeArtifactSnapshot> = {
  candidate: T
  fit: OfficeFitResult
  changes: OfficeFitRepairChange[]
  diagnostics: OfficeFitResult['issues']
  history: Array<{ attempt: number; issues: OfficeFitResult['issues'] }>
}

/** Pure, content-preserving repair. No export, persistence, retries or head promotion.
 * Non-font defects remain terminal diagnostics; success still needs preflight,
 * native round-trip and actual rendered validation by the caller.
 */
export function repairOfficeArtifactFit<T extends OfficeArtifactSnapshot>(snapshot: T, options: OfficeFitRepairOptions): OfficeFitRepairResult<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const step = options.stepPt ?? 1
  const requestedFloor = options.minimumFontSizePt ?? 8
  const budgetFloor = options.budget?.minimumFontSizePt ?? 8
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new RangeError('maxAttempts must be 1..3')
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('stepPt must be positive and finite')
  if (![requestedFloor, budgetFloor].every(Number.isFinite)) throw new RangeError('Font floors must be finite')
  const floor = Math.max(8, requestedFloor, budgetFloor)
  const budget = { ...options.budget, minimumFontSizePt: floor }
  const candidate = structuredClone(snapshot)
  const eligible = new Set(options.eligibleTargetIds)
  const locked = new Set(options.lockedTargetIds ?? [])
  if (candidate.family === 'presentation') for (const master of candidate.masters) for (const id of master.lockedObjectIds) locked.add(id)
  const runs: Array<{ targetId: string; run: OfficeRichTextRun }> = []
  // Only a text owner's direct runs are authorized by its ID. A table, list,
  // section or slide ID never grants authority over descendant template text.
  const visit = (value: unknown, ancestorLocked = false): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const child of value) visit(child, ancestorLocked); return }
    const object = value as Record<string, unknown>
    const id = typeof object.id === 'string' ? object.id : ''
    const isLocked = ancestorLocked || object.locked === true || locked.has(id)
    for (const key of ['runs', 'header', 'footer', 'notes', ...(object.kind === 'shape' ? ['text'] : [])]) {
      if (!Array.isArray(object[key])) continue
      for (const run of object[key] as OfficeRichTextRun[]) {
        if (!isLocked && !locked.has(run.id) && ((key === 'runs' || key === 'text') && eligible.has(id) || eligible.has(run.id))) runs.push({ targetId: id, run })
      }
    }
    for (const child of Object.values(object)) visit(child, isLocked)
  }
  if (candidate.family === 'document') visit(candidate.sections)
  if (candidate.family === 'presentation') visit(candidate.slides)
  const changes: OfficeFitRepairChange[] = []
  let fit = fitOfficeArtifact(candidate, budget)
  const history = [{ attempt: 1, issues: fit.issues }]
  for (let attempt = 2; !fit.ok && attempt <= maxAttempts; attempt++) {
    let changed = false
    for (const { targetId, run } of runs) {
      const fromPt = run.style.fontSizePt
      // Existing undersized imported text is never enlarged (or shrunk).
      if (!Number.isFinite(fromPt) || fromPt <= floor) continue
      const toPt = Math.max(floor, fromPt - step)
      if (toPt === fromPt) continue
      run.style = { ...run.style, fontSizePt: toPt }
      changes.push({ attempt, targetId, runId: run.id, fromPt, toPt })
      changed = true
    }
    if (!changed) break
    fit = fitOfficeArtifact(candidate, budget)
    history.push({ attempt, issues: fit.issues })
  }
  fit = { ...fit, attempts: history.length }
  return { candidate, fit, changes, diagnostics: fit.issues, history }
}
