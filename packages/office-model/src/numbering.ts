import { OfficeParagraphFormatSchema, officeCellParagraphs, type DocumentSnapshot, type OfficeNumbering, type OfficeParagraphFormat } from './model.js'

/** Shared order for native export, layout and editor projections. */
export function documentNumberedParagraphs(snapshot: DocumentSnapshot): Array<{ id: string; format: OfficeParagraphFormat }> {
  return snapshot.sections.flatMap(section => section.nodes.flatMap(node => {
    if (node.kind === 'paragraph' || node.kind === 'heading') return [{ id: node.id, format: Object.fromEntries(Object.entries(node).filter(([key]) => key in OfficeParagraphFormatSchema.shape)) as OfficeParagraphFormat }]
    if (node.kind === 'table') return node.rows.flatMap(row => row.cells.flatMap(cell => officeCellParagraphs(cell).map(({ format, runs }) => ({ id: runs[0]?.paragraphStart?.id ?? cell.id, format }))))
    return []
  }))
}

export function officeNumberLabel(definition: OfficeNumbering, value: number): string {
  let label = String(value)
  if (/Letter$/.test(definition.format)) {
    // Word repeats each letter after Z: AA, BB, ... ZZ, AAA (not Excel AB).
    label = String.fromCharCode(65 + (value - 1) % 26).repeat(Math.floor((value - 1) / 26) + 1)
  } else if (/Roman$/.test(definition.format)) {
    label = ''
    let n = value
    for (const [amount, glyph] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
      const count = Math.floor(n / amount)
      label += glyph.repeat(count)
      n %= amount
    }
  }
  if (definition.format.startsWith('lower')) label = label.toLowerCase()
  return definition.pattern.replace('%1', label)
}

/** A new traversal gets new counters; interruptions do not reset a list. */
export function officeNumberingCounter(): (definition: OfficeNumbering) => string {
  const counters = new Map<string, number>()
  return definition => {
    const value = (counters.get(definition.listId) ?? definition.start - 1) + 1
    counters.set(definition.listId, value)
    return officeNumberLabel(definition, value)
  }
}
