/** Simple table append primitives.
 * Current admission boundaries: overlapping validation/conditional rules reject
 * atomically (they are not extended); explicit print constraints are not enlarged.
 * Only explicitly unstyled native tables (style name="") are admitted until the
 * editor/display-list renderer projects Excel table styles. Cell styles still copy
 * and render normally; named native table styles fail admission, never flatten.
 * [COMP:office/spreadsheet-tables] */
import { z } from 'zod'
import { SpreadsheetCellValueSchema, type SpreadsheetSnapshot, type SpreadsheetTable } from './model.js'
import { columnIndexToName, parseCellAddress, recalculateSpreadsheet, translateSpreadsheetFormula } from './spreadsheet.js'

export const SpreadsheetRecordSchema = z.record(z.object({
  valueType: z.enum(['blank', 'string', 'number', 'boolean', 'date']),
  value: SpreadsheetCellValueSchema,
}).strict()).superRefine((record, ctx) => {
  for (const [key, cell] of Object.entries(record)) {
    const valid = cell.valueType === 'blank' ? cell.value === null : cell.valueType === 'date'
      ? typeof cell.value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(cell.value) && Number.isFinite(Date.parse(cell.value))
      : typeof cell.value === cell.valueType
    if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Scalar does not match valueType' })
  }
})

export function tableBounds(ref: string) {
  if (!/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/.test(ref)) throw new Error('Unsafe table reference')
  const [a, b] = ref.split(':').map(parseCellAddress)
  if (!a || !b || a.column > b.column || a.row > b.row || b.column > 16384 || b.row > 1048576) throw new Error('Unsafe table reference')
  return { left: a.column, right: b.column, top: a.row, bottom: b.row }
}
export function validateSpreadsheetTable(table: SpreadsheetTable): void {
  const b = tableBounds(table.ref)
  if (b.right - b.left + 1 !== table.columns.length || new Set(table.columns.map(c => c.id)).size !== table.columns.length || new Set(table.columns.map(c => c.name.toLowerCase())).size !== table.columns.length) throw new Error('Invalid table columns')
}

export { translateSpreadsheetFormula } from './spreadsheet.js'

export function appendSpreadsheetRecords(snapshot: SpreadsheetSnapshot, command: { commandId: string; sheetId: string; tableId: string; prototypeRow?: number; records: z.infer<typeof SpreadsheetRecordSchema>[] }): SpreadsheetSnapshot {
  const records = z.array(SpreadsheetRecordSchema).min(1).max(10000).parse(command.records)
  const next = structuredClone(snapshot)
  const sheet = next.worksheets.find(s => s.id === command.sheetId)
  const table = sheet?.tables?.find(t => t.id === command.tableId)
  if (!sheet || !table) throw new Error('Table not found')
  validateSpreadsheetTable(table)
  const bounds = tableBounds(table.ref)
  const prototypeRow = command.prototypeRow ?? bounds.bottom
  if (!Number.isInteger(prototypeRow) || prototypeRow <= bounds.top || prototypeRow > bounds.bottom) throw new Error('Append requires an existing data prototype row')
  const end = bounds.bottom + records.length
  if (end > 1048576 || sheet.cells.length + records.length * table.columns.length > 250000) throw new Error('Append exceeds worksheet limits')
  if (sheet.print.printArea) {
    const area = tableBounds(sheet.print.printArea)
    if (bounds.left < area.left || bounds.right > area.right || bounds.top < area.top || end > area.bottom) throw new Error('Append exceeds explicit print area; expand print constraints first')
  }
  if (sheet.rowDimensions.some(r => r.index > bounds.bottom && r.index <= end && r.hidden)) throw new Error('Append would hide records')
  const overlaps = (ref: string) => { const b = tableBounds(ref.includes(':') ? ref : `${ref}:${ref}`); return b.left <= bounds.right && b.right >= bounds.left && b.top <= end && b.bottom >= bounds.top }
  if (sheet.merges.some(overlaps) || sheet.tables!.some(t => t.id !== table.id && overlaps(t.ref)) || sheet.validations.some(v => overlaps(v.range)) || sheet.conditionalFormats.some(v => overlaps(v.range))) throw new Error('Unsafe overlapping table, merge or rule')
  // Existing header/historical record locks are not append targets. Only the
  // prototype and new range must be writable; never unlock or rewrite history.
  if (sheet.cells.some(c => {
    const address = parseCellAddress(c.address)!
    return c.locked && address.column >= bounds.left && address.column <= bounds.right
      && (address.row === prototypeRow || address.row > bounds.bottom && address.row <= end)
  }) || sheet.images.some(i => i.from.column < bounds.right && i.to.column >= bounds.left - 1 && i.from.row < end && i.to.row >= bounds.bottom)) throw new Error('Protected cells or overlapping image')
  const cells = new Map(sheet.cells.map(c => [c.address, c]))
  const ids = new Set([next.rootId, ...next.resources.map(r => r.id), ...next.worksheets.flatMap(s => [s.id, ...s.cells.map(c => c.id), ...s.images.map(i => i.id), ...(s.tables ?? []).map(t => t.id)])])
  let sequence = 0
  for (const [offset, record] of records.entries()) {
    if (Object.keys(record).some(key => !table.columns.some(c => String(c.id) === key))) throw new Error('Unknown table column')
    for (const [index, column] of table.columns.entries()) {
      const letter = columnIndexToName(bounds.left + index)
      const address = `${letter}${bounds.bottom + offset + 1}`
      const prototype = cells.get(`${letter}${prototypeRow}`)
      if (!prototype) throw new Error('Append requires an explicit cell in every prototype column')
      if (cells.has(address) || prototype.locked) throw new Error('Append collision or locked prototype')
      const value = record[String(column.id)]
      if (prototype?.formula ? value !== undefined : value === undefined) throw new Error('Supply every input column and omit formula columns')
      const suffix = (BigInt(`0x${command.commandId.slice(-12)}`) ^ BigInt(++sequence)).toString(16).padStart(12, '0')
      const id = command.commandId.slice(0, -12) + suffix
      if (ids.has(id)) throw new Error('Cell identity collision')
      ids.add(id)
      sheet.cells.push({ id, address, valueType: value?.valueType ?? 'number', value: value?.value ?? null, style: structuredClone(prototype?.style ?? {}), numberFormat: prototype?.numberFormat, locked: false, ...(prototype?.formula ? { formula: translateSpreadsheetFormula(prototype.formula, bounds.bottom + offset + 1 - prototypeRow) } : {}) })
    }
  }
  table.ref = `${columnIndexToName(bounds.left)}${bounds.top}:${columnIndexToName(bounds.right)}${end}`
  const calculated = recalculateSpreadsheet(next)
  if (calculated.issues.length) throw new Error('Append recalculation failed')
  return calculated.snapshot
}
