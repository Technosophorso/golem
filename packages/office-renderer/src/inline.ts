import type { OfficeRichTextRun } from '@use-brian/office-model'

/** Word/CJK boundaries preserve normal wrapping instead of boxing a whole run.
 * Newlines/tabs remain native text. Offsets are UTF-16, as in ProseMirror. */
export function officeScaleSegments(text: string): Array<{ text: string; offset: number }> {
  return [...text.matchAll(/[\r\n\t]| +|[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]|[^\s\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]+|\s/gu)].map(match => ({ text: match[0], offset: match.index! }))
}

/** Fallback for deterministic server layout. Browser projection supplies actual
 * local-font canvas advances. No network font acquisition is performed. */
export function officeTextAdvance(text: string, fontSize: number): number {
  return [...text].reduce((width, character) => width + fontSize * (/\s/.test(character) ? 0.28 : /[ilI1|.,'`:;]/.test(character) ? 0.28 : /[mwMW@%&]/.test(character) ? 0.82 : /[A-Z0-9]/.test(character) ? 0.6 : /[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(character) ? 1 : 0.5), 0)
}

export function officeScaledSegmentCss(width: number, percent: number, unit = 'px'): string {
  // Width participates in inline layout; transform affects ink only. Visible
  // overflow lets the unscaled text paint before the horizontal transform.
  return `display:inline-block;white-space:pre;width:${width * percent / 100}${unit};transform:scaleX(${percent / 100});transform-origin:left center;overflow:visible;text-indent:0`
}

export function officeRunFontCss(style: OfficeRichTextRun['style'], unit = 'px'): string {
  return `font-family:${JSON.stringify(style.fontFamily)}${style.eastAsianFontFamily ? `,${JSON.stringify(style.eastAsianFontFamily)}` : ''};font-size:${style.fontSizePt}${unit};font-weight:${style.bold ? 700 : 400};font-style:${style.italic ? 'italic' : 'normal'};color:${style.color}`
}
