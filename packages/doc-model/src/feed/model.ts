/** Portable Feed conversion and operations. [COMP:feed/composition-model] */
import { Schema } from '@tiptap/pm/model'
import {
  feedCompositionSchema, type FeedComposition, type FeedNode, type FeedInline,
  type FeedEdit, type FeedTarget, type FeedAnchor, type FeedMedia, type FeedSpan,
} from '@use-brian/shared'

export class FeedCompositionError extends Error {
  constructor(public code: 'invalid_target' | 'preimage_conflict' | 'invalid_composition', message = code) { super(message) }
}
const id = () => crypto.randomUUID()
export const feedSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', attrs: { id: { default: null } }, toDOM: n => ['p', { 'data-block-id': n.attrs.id }, 0] },
    heading: { group: 'block', content: 'inline*', attrs: { id: { default: null }, level: { default: 2 } }, toDOM: n => [`h${n.attrs.level}`, { 'data-block-id': n.attrs.id }, 0] },
    bulletList: { group: 'block', content: 'listItem+', attrs: { id: { default: null } }, toDOM: () => ['ul', 0] },
    orderedList: { group: 'block', content: 'listItem+', attrs: { id: { default: null }, start: { default: 1 } }, toDOM: n => ['ol', { start: n.attrs.start }, 0] },
    listItem: { content: 'block+', attrs: { id: { default: null } }, toDOM: () => ['li', 0] },
    blockquote: { group: 'block', content: 'block+', attrs: { id: { default: null } }, toDOM: () => ['blockquote', 0] },
    text: { group: 'inline' }, hardBreak: { group: 'inline', inline: true, toDOM: () => ['br'] },
    image: { group: 'block', atom: true, attrs: { id: { default: null }, fileId: {}, mimeType: {}, alt: { default: '' }, placement: { default: 'inline' } }, toDOM: n => ['figure', { 'data-file-id': n.attrs.fileId }, ['figcaption', n.attrs.alt]] },
    generationPlaceholder: { group: 'block', atom: true, attrs: { id: { default: null }, kind: {}, brief: {}, briefRevision: { default: 0 }, references: { default: [] }, intent: { default: null }, length: { default: null }, aspectRatio: { default: null }, style: { default: null }, altIntent: { default: null } }, toDOM: n => ['aside', { 'data-placeholder-id': n.attrs.id }, n.attrs.brief] },
  },
  marks: { bold: { toDOM: () => ['strong', 0] }, italic: { toDOM: () => ['em', 0] }, link: { attrs: { href: {} }, toDOM: m => ['a', { href: m.attrs.href, rel: 'noopener noreferrer' }, 0] } },
})
export function canonicalFeedValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalFeedValue).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonicalFeedValue(v)).join(',') + '}'
  return JSON.stringify(value)
}
const equal = (a: unknown, b: unknown) => canonicalFeedValue(a) === canonicalFeedValue(b)
export function validateFeedComposition(input: unknown): FeedComposition {
  // Bound the raw object before Zod's recursive traversal, including hostile JSON.
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }]; let visits = 0
  while (stack.length) {
    const { value, depth } = stack.pop()!
    if (++visits > 200_000 || depth > 50) throw new FeedCompositionError('invalid_composition')
    if (value && typeof value === 'object') for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 })
  }
  const parsed = feedCompositionSchema.parse(input)
  for (const segment of parsed.segments) feedSchema.nodeFromJSON({ type: 'doc', content: segment.content }).check()
  return parsed
}
export function feedText(node: FeedNode): string {
  if (node.type === 'paragraph' || node.type === 'heading') return inlineText(node.content ?? [])
  if ('content' in node) return node.content.map(feedText).join('\n')
  return ''
}
export function inlineText(content: FeedInline[]): string { return content.map(n => n.type === 'text' ? n.text : '\n').join('') }
export function feedParagraph(text: string, blockId = id()): FeedNode { return { type: 'paragraph', attrs: { id: blockId }, content: text ? [{ type: 'text', text }] : [] } }
export function parseFeedInline(text: string): FeedInline[] {
  // Parse only known syntax; unmatched/unsupported syntax remains literal text.
  const result: FeedInline[] = []; const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\n/g
  let pos = 0
  for (const match of text.matchAll(re)) {
    if (match.index! > pos) result.push({ type: 'text', text: text.slice(pos, match.index) })
    if (match[0] === '\n') result.push({ type: 'hardBreak' })
    else result.push({ type: 'text', text: match[1] ?? match[2] ?? match[3]!, marks: match[1] ? [{ type: 'bold' }] : match[2] ? [{ type: 'italic' }] : [{ type: 'link', attrs: { href: match[4]! } }] })
    pos = match.index! + match[0].length
  }
  if (pos < text.length) result.push({ type: 'text', text: text.slice(pos) })
  return result
}
export function importFeedMarkdown(markdown: string): FeedNode[] {
  if (!markdown) return [feedParagraph('')]
  const lines = markdown.replace(/\r\n/g, '\n').split('\n'); const blocks: FeedNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!; const heading = /^(#{1,6}) (.*)$/.exec(line)
    if (heading) { blocks.push({ type: 'heading', attrs: { id: id(), level: heading[1]!.length }, content: parseFeedInline(heading[2]!) }); i++; continue }
    const list = /^([-*]) (.*)$|^(\d+)\. (.*)$/.exec(line)
    if (list) {
      const ordered = !!list[3]; const items: FeedNode[] = []; const pattern = ordered ? /^\d+\. (.*)$/ : /^[-*] (.*)$/
      while (i < lines.length) {
        const m = pattern.exec(lines[i]!); if (!m) break
        items.push({ type: 'listItem', attrs: { id: id() }, content: [{ type: 'paragraph', attrs: { id: id() }, content: parseFeedInline(m[1]!) }] }); i++
      }
      blocks.push(ordered ? { type: 'orderedList', attrs: { id: id(), start: Number(list[3]) }, content: items } : { type: 'bulletList', attrs: { id: id() }, content: items }); continue
    }
    if (/^> ?/.test(line)) {
      const quote: string[] = []; while (i < lines.length && /^> ?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^> ?/, ''))
      blocks.push({ type: 'blockquote', attrs: { id: id() }, content: importFeedMarkdown(quote.join('\n')) }); continue
    }
    const paragraph: string[] = [line]; i++
    while (i < lines.length && lines[i] !== '' && !/^(#{1,6} |[-*] |\d+\. |>)/.test(lines[i]!)) paragraph.push(lines[i++]!)
    blocks.push({ type: 'paragraph', attrs: { id: id() }, content: parseFeedInline(paragraph.join('\n')) })
    if (i < lines.length && lines[i] === '') i++
  }
  return blocks.length ? blocks : [feedParagraph('')]
}
export function importLegacyFeed(input: { text: string; postFormat: 'post' | 'thread' | 'article'; threadSegments: string[]; media: FeedMedia[] }): FeedComposition {
  const sources = input.postFormat === 'thread' && input.threadSegments.length ? input.threadSegments : [input.text]
  const segments = sources.map(markdown => { const content = importFeedMarkdown(markdown); return { id: id(), content, legacy: { markdown, canonical: canonicalFeedValue(content) } } })
  for (const media of input.media) segments[0]!.content.push({ type: 'image', attrs: { ...media, id: id(), placement: 'attachment' } })
  // Attachment media did not belong to the caption. Include it in the baseline
  // so untouched legacy captions retain their original exact bytes.
  segments[0]!.legacy.canonical = canonicalFeedValue(segments[0]!.content)
  return validateFeedComposition({ version: 1, segments })
}
const escapeInline = (text: string) => text.replace(/([\\*\[\]])/g, '\\$1')
export function serializeFeedInline(content: FeedInline[]): string {
  return content.map(n => {
    if (n.type === 'hardBreak') return '\n'
    let text = escapeInline(n.text)
    for (const mark of n.marks ?? []) text = mark.type === 'bold' ? `**${text}**` : mark.type === 'italic' ? `*${text}*` : `[${text}](${mark.attrs.href})`
    return text
  }).join('')
}
function markdownNode(node: FeedNode): string {
  if (node.type === 'paragraph' || node.type === 'heading') return (node.type === 'heading' ? '#'.repeat(node.attrs.level) + ' ' : '') + serializeFeedInline(node.content ?? [])
  if (node.type === 'image' || node.type === 'generationPlaceholder') return ''
  if (node.type === 'blockquote') return node.content.map(markdownNode).join('\n\n').split('\n').map(line => '> ' + line).join('\n')
  if (node.type === 'listItem') return node.content.map(markdownNode).join('\n')
  return node.content.map((child, i) => (node.type === 'orderedList' ? `${node.attrs.start + i}. ` : '- ') + markdownNode(child)).join('\n')
}
export function walkFeed(composition: FeedComposition): { segmentId: string; node: FeedNode; parentId?: string }[] {
  const rows: { segmentId: string; node: FeedNode; parentId?: string }[] = []
  const visit = (segmentId: string, nodes: FeedNode[], parentId?: string) => {
    for (const node of nodes) { rows.push({ segmentId, node, parentId }); if ('content' in node && node.type !== 'paragraph' && node.type !== 'heading') visit(segmentId, node.content, node.attrs.id) }
  }
  for (const s of composition.segments) visit(s.id, s.content)
  return rows
}
export function projectFeed(composition: FeedComposition): { text: string; threadSegments: string[]; media: FeedMedia[]; missingSlots: string[]; inlineImages: string[] } {
  validateFeedComposition(composition)
  const threadSegments = composition.segments.map(s => s.legacy && s.legacy.canonical === canonicalFeedValue(s.content) ? s.legacy.markdown : s.content.filter(n => n.type !== 'generationPlaceholder' && n.type !== 'image').map(markdownNode).join('\n\n'))
  const rows = walkFeed(composition)
  return { text: threadSegments.join('\n\n'), threadSegments,
    media: rows.flatMap(({ node }) => node.type === 'image' ? [{ fileId: node.attrs.fileId, mimeType: node.attrs.mimeType, ...(node.attrs.alt ? { alt: node.attrs.alt } : {}) }] : []),
    missingSlots: rows.filter(({ node }) => node.type === 'generationPlaceholder').map(({ node }) => node.attrs.id),
    inlineImages: rows.filter(({ node }) => node.type === 'image' && node.attrs.placement === 'inline').map(({ node }) => node.attrs.id),
  }
}
export function normalizeFeedInline(content: FeedInline[]): FeedInline[] {
  const result: FeedInline[] = []
  for (const inline of content) {
    const previous = result.at(-1)
    if (inline.type === 'text' && previous?.type === 'text' && equal(inline.marks ?? [], previous.marks ?? [])) previous.text += inline.text
    else result.push(structuredClone(inline))
  }
  return result
}
export function sliceFeedInline(content: FeedInline[], from: number, to: number): FeedInline[] {
  let offset = 0; const out: FeedInline[] = []
  for (const node of content) {
    const length = node.type === 'text' ? node.text.length : 1; const start = Math.max(0, from - offset); const end = Math.min(length, to - offset)
    if (end > start) out.push(node.type === 'text' ? { ...node, text: node.text.slice(start, end) } : node)
    offset += length
  }
  return out
}
export function locateFeedNode(composition: FeedComposition, segmentId: string, blockId: string): { node: FeedNode; siblings: FeedNode[]; index: number; parentId?: string } {
  const segment = composition.segments.find(s => s.id === segmentId)
  const find = (nodes: FeedNode[], parentId?: string): ReturnType<typeof locateFeedNode> | undefined => {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!
      if (node.attrs.id === blockId) return { node, siblings: nodes, index, parentId }
      if ('content' in node && node.type !== 'paragraph' && node.type !== 'heading') { const found = find(node.content, node.attrs.id); if (found) return found }
    }
  }
  const found = segment && find(segment.content); if (!found) throw new FeedCompositionError('invalid_target')
  return found
}
function validateSpans(composition: FeedComposition, spans: FeedSpan[]): void {
  const rows = walkFeed(composition); let previous = -1
  for (const span of spans) {
    const index = rows.findIndex(r => r.segmentId === span.segmentId && r.node.attrs.id === span.blockId)
    const node = rows[index]?.node
    if (index <= previous || !node || (node.type !== 'paragraph' && node.type !== 'heading') || span.to < span.from || span.to > feedText(node).length) throw new FeedCompositionError('invalid_target')
    previous = index
  }
}
export function feedTargetQuote(composition: FeedComposition, target: FeedTarget): string {
  if (target.kind === 'post') return ''
  if (target.kind === 'block') { const { node } = locateFeedNode(composition, target.segmentId, target.blockId); return node.type === 'generationPlaceholder' ? node.attrs.brief : node.type === 'image' ? node.attrs.alt ?? '' : feedText(node) }
  validateSpans(composition, target.spans)
  return target.spans.map(s => feedText(locateFeedNode(composition, s.segmentId, s.blockId).node).slice(s.from, s.to)).join('\n')
}
export function createFeedAnchor(composition: FeedComposition, target: FeedTarget, revision: number): FeedAnchor {
  return { target, quote: feedTargetQuote(composition, target), sourceRevision: revision, state: 'attached' }
}
function targetIds(target: FeedTarget): string[] { return target.kind === 'post' ? [] : target.kind === 'block' ? [target.blockId] : target.spans.map(s => s.blockId) }
function mapAnchor(anchor: FeedAnchor, edit: FeedEdit, before: FeedComposition, after: FeedComposition): FeedAnchor {
  if (anchor.state === 'detached' || anchor.target.kind === 'post') return anchor
  const out = structuredClone(anchor); const ids = targetIds(anchor.target)
  const live = new Set(walkFeed(after).map(r => r.node.attrs.id))
  if (ids.some(blockId => !live.has(blockId))) { out.state = 'detached'; return out }
  if (edit.kind === 'replaceText') {
    for (let i = 0; i < edit.spans.length; i++) {
      const edited = edit.spans[i]!; const length = inlineText(edit.replacement[i]!).length; const delta = length - (edited.to - edited.from)
      if (out.target.kind === 'range') for (const span of out.target.spans) {
        if (span.blockId !== edited.blockId) continue
        if (length === 0 && edited.from <= span.from && edited.to >= span.to && span.to > span.from) { out.state = 'detached' }
        else if (edited.to <= span.from) { span.from += delta; span.to += delta }
        else if (edited.from < span.to) { out.state = 'stale'; span.to = Math.max(span.from, span.to + delta); span.from = Math.min(span.from, edited.from) }
      }
      else if (out.target.kind === 'block' && out.target.blockId === edited.blockId) out.state = 'stale'
    }
  } else if (edit.kind === 'replaceBlock') {
    for (const blockId of ids) {
      const prev = walkFeed(before).find(r => r.node.attrs.id === blockId)?.node
      const next = walkFeed(after).find(r => r.node.attrs.id === blockId)?.node
      if (!equal(prev, next)) out.state = 'stale'
    }
  }
  // Stale ranges still point to their blocks, but must remain displayable.
  if (out.target.kind === 'range') for (const span of out.target.spans) {
    const len = feedText(locateFeedNode(after, span.segmentId, span.blockId).node).length
    span.from = Math.min(span.from, len); span.to = Math.min(Math.max(span.from, span.to), len)
  }
  return out
}
function targetSiblings(composition: FeedComposition, segmentId: string, parentId?: string): FeedNode[] {
  if (parentId) { const { node } = locateFeedNode(composition, segmentId, parentId); if ('content' in node && node.type !== 'paragraph' && node.type !== 'heading') return node.content; throw new FeedCompositionError('invalid_target') }
  const segment = composition.segments.find(s => s.id === segmentId); if (!segment) throw new FeedCompositionError('invalid_target'); return segment.content
}
export function applyFeedEdits(input: FeedComposition, edits: FeedEdit[], anchors: FeedAnchor[] = []): { composition: FeedComposition; inverse: FeedEdit[]; anchors: FeedAnchor[] } {
  let composition = structuredClone(validateFeedComposition(input)); let mapped = structuredClone(anchors); let inverse: FeedEdit[] = []
  for (const edit of edits) {
    const before = structuredClone(composition); const undo: FeedEdit[] = []
    if (edit.kind === 'replaceText') {
      validateSpans(composition, edit.spans)
      if (edit.preimage.length !== edit.spans.length || edit.replacement.length !== edit.spans.length) throw new FeedCompositionError('invalid_target')
      const backSpans: FeedSpan[] = []
      edit.spans.forEach((span, i) => {
        const { node } = locateFeedNode(composition, span.segmentId, span.blockId)
        if (node.type !== 'paragraph' && node.type !== 'heading') throw new FeedCompositionError('invalid_target')
        const content = node.content ?? []; const selected = sliceFeedInline(content, span.from, span.to)
        if (!equal(selected, edit.preimage[i])) throw new FeedCompositionError('preimage_conflict')
        node.content = normalizeFeedInline([...sliceFeedInline(content, 0, span.from), ...edit.replacement[i]!, ...sliceFeedInline(content, span.to, inlineText(content).length)])
        backSpans.push({ ...span, to: span.from + inlineText(edit.replacement[i]!).length })
      })
      undo.push({ kind: 'replaceText', spans: backSpans, preimage: edit.replacement, replacement: edit.preimage })
    } else if (edit.kind === 'replaceBlock') {
      const { node, siblings, index, parentId } = locateFeedNode(composition, edit.segmentId, edit.blockId)
      if (!equal(node, edit.preimage)) throw new FeedCompositionError('preimage_conflict')
      if (edit.replacement.length && edit.replacement[0]!.attrs.id !== edit.blockId) throw new FeedCompositionError('invalid_target')
      siblings.splice(index, 1, ...structuredClone(edit.replacement))
      if (!edit.replacement.length) undo.push({ kind: 'insertBlock', segmentId: edit.segmentId, parentId, afterId: index ? siblings[index - 1]!.attrs.id : null, node })
      else {
        for (const extra of edit.replacement.slice(1).reverse()) undo.push({ kind: 'replaceBlock', segmentId: edit.segmentId, blockId: extra.attrs.id, preimage: extra, replacement: [] })
        undo.push({ kind: 'replaceBlock', segmentId: edit.segmentId, blockId: edit.blockId, preimage: edit.replacement[0]!, replacement: [node] })
      }
    } else if (edit.kind === 'insertBlock') {
      const siblings = targetSiblings(composition, edit.segmentId, edit.parentId); const index = edit.afterId === null ? -1 : siblings.findIndex(n => n.attrs.id === edit.afterId)
      if (edit.afterId !== null && index === -1) throw new FeedCompositionError('invalid_target')
      siblings.splice(index + 1, 0, structuredClone(edit.node))
      undo.push({ kind: 'replaceBlock', segmentId: edit.segmentId, blockId: edit.node.attrs.id, preimage: edit.node, replacement: [] })
    } else if (edit.kind === 'moveBlock') {
      const { node, siblings, index, parentId } = locateFeedNode(composition, edit.segmentId, edit.blockId)
      const destination = targetSiblings(composition, edit.segmentId, edit.parentId)
      if (edit.blockId === edit.afterId || walkFeed({ version: 1, segments: [{ id: id(), content: [node] }] }).some(r => r.node.attrs.id === edit.parentId)) throw new FeedCompositionError('invalid_target')
      const oldAfter = index ? siblings[index - 1]!.attrs.id : null; siblings.splice(index, 1)
      const at = edit.afterId === null ? -1 : destination.findIndex(n => n.attrs.id === edit.afterId)
      if (edit.afterId !== null && at === -1) throw new FeedCompositionError('invalid_target')
      destination.splice(at + 1, 0, node); undo.push({ ...edit, afterId: oldAfter, parentId })
    } else if (edit.kind === 'insertSegment') {
      const at = edit.afterId === null ? -1 : composition.segments.findIndex(s => s.id === edit.afterId)
      if (edit.afterId !== null && at === -1) throw new FeedCompositionError('invalid_target')
      composition.segments.splice(at + 1, 0, structuredClone(edit.segment)); undo.push({ kind: 'removeSegment', segmentId: edit.segment.id, preimage: edit.segment })
    } else {
      const at = composition.segments.findIndex(s => s.id === edit.segmentId)
      if (at === -1 || !equal(composition.segments[at], edit.preimage)) throw new FeedCompositionError('preimage_conflict')
      const [segment] = composition.segments.splice(at, 1)
      undo.push({ kind: 'insertSegment', afterId: at ? composition.segments[at - 1]!.id : null, segment: segment! })
    }
    mapped = mapped.map(anchor => mapAnchor(anchor, edit, before, composition)); inverse = [...undo, ...inverse]
  }
  composition = validateFeedComposition(composition)
  return { composition, inverse, anchors: mapped }
}
export function duplicateFeedNode(node: FeedNode): FeedNode {
  const cloned = structuredClone(node)
  const fresh = (n: FeedNode) => { n.attrs.id = id(); if ('content' in n && n.type !== 'paragraph' && n.type !== 'heading') n.content.forEach(fresh) }
  fresh(cloned); return cloned
}
