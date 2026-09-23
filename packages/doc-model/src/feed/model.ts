/** Portable Feed conversion and operations. [COMP:feed/composition-model] */
import { Schema } from '@tiptap/pm/model'
import {
  feedCompositionSchema, type FeedComposition, type FeedNode, type FeedInline,
  type FeedEdit, type FeedTarget, type FeedAnchor, type FeedMedia, type FeedSpan,
  type FeedPlaceholderAttrs,
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
    bulletList: { group: 'block', content: 'listItem+', attrs: { id: { default: null } }, toDOM: n => ['ul', { 'data-block-id': n.attrs.id }, 0] },
    orderedList: { group: 'block', content: 'listItem+', attrs: { id: { default: null }, start: { default: 1 } }, toDOM: n => ['ol', { start: n.attrs.start, 'data-block-id': n.attrs.id }, 0] },
    listItem: { content: 'block+', attrs: { id: { default: null } }, toDOM: n => ['li', { 'data-block-id': n.attrs.id }, 0] },
    blockquote: { group: 'block', content: 'block+', attrs: { id: { default: null } }, toDOM: n => ['blockquote', { 'data-block-id': n.attrs.id }, 0] },
    text: { group: 'inline' }, hardBreak: { group: 'inline', inline: true, toDOM: () => ['br'] },
    image: { group: 'block', atom: true, attrs: { id: { default: null }, fileId: {}, mimeType: {}, alt: { default: '' }, placement: { default: 'inline' } }, toDOM: n => ['figure', { 'data-file-id': n.attrs.fileId, 'data-block-id': n.attrs.id }, ['figcaption', n.attrs.alt]] },
    generationPlaceholder: { group: 'block', atom: true, attrs: { id: { default: null }, kind: {}, brief: {}, briefRevision: { default: 0 }, references: { default: [] }, intent: { default: null }, length: { default: null }, aspectRatio: { default: null }, style: { default: null }, altIntent: { default: null } }, toDOM: n => ['aside', { 'data-placeholder-id': n.attrs.id, 'data-block-id': n.attrs.id }, n.attrs.brief] },
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
export function feedParagraph(text: string, blockId: string = id()): FeedNode { return { type: 'paragraph', attrs: { id: blockId }, content: text ? [{ type: 'text', text }] : [] } }
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
export function importFeedMarkdown(markdown: string, nextId: () => string = id): FeedNode[] {
  if (!markdown) return [feedParagraph('', nextId())]
  const lines = markdown.replace(/\r\n/g, '\n').split('\n'); const blocks: FeedNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!; const heading = /^(#{1,6}) (.*)$/.exec(line)
    if (heading) { blocks.push({ type: 'heading', attrs: { id: nextId(), level: heading[1]!.length }, content: parseFeedInline(heading[2]!) }); i++; continue }
    const list = /^([-*]) (.*)$|^(\d+)\. (.*)$/.exec(line)
    if (list) {
      const ordered = !!list[3]; const items: FeedNode[] = []; const pattern = ordered ? /^\d+\. (.*)$/ : /^[-*] (.*)$/
      while (i < lines.length) {
        const m = pattern.exec(lines[i]!); if (!m) break
        items.push({ type: 'listItem', attrs: { id: nextId() }, content: [{ type: 'paragraph', attrs: { id: nextId() }, content: parseFeedInline(m[1]!) }] }); i++
      }
      blocks.push(ordered ? { type: 'orderedList', attrs: { id: nextId(), start: Number(list[3]) }, content: items } : { type: 'bulletList', attrs: { id: nextId() }, content: items }); continue
    }
    if (/^> ?/.test(line)) {
      const quote: string[] = []; while (i < lines.length && /^> ?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^> ?/, ''))
      blocks.push({ type: 'blockquote', attrs: { id: nextId() }, content: importFeedMarkdown(quote.join('\n'), nextId) }); continue
    }
    const paragraph: string[] = [line]; i++
    while (i < lines.length && lines[i] !== '' && !/^(#{1,6} |[-*] |\d+\. |>)/.test(lines[i]!)) paragraph.push(lines[i++]!)
    blocks.push({ type: 'paragraph', attrs: { id: nextId() }, content: parseFeedInline(paragraph.join('\n')) })
    if (i < lines.length && lines[i] === '') i++
  }
  return blocks.length ? blocks : [feedParagraph('', nextId())]
}
export function importLegacyFeed(input: { text: string; postFormat: 'post' | 'thread' | 'article'; threadSegments: string[]; media: FeedMedia[] }, seed?: string): FeedComposition {
  let serial = 0
  const nextId = seed ? () => seed.slice(0, 24) + (++serial).toString(16).padStart(12, '0') : id
  const sources = input.postFormat === 'thread' && input.threadSegments.length ? input.threadSegments : [input.text]
  const segments = sources.map(markdown => { const content = importFeedMarkdown(markdown, nextId); return { id: nextId(), content, legacy: { markdown, canonical: canonicalFeedValue(content) } } })
  for (const media of input.media) segments[0]!.content.push({ type: 'image', attrs: { ...media, id: nextId(), placement: 'attachment' } })
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
  if (ids.some(blockId => !live.has(blockId) && !(edit.kind === 'joinBlocks' && blockId === edit.secondId))) { out.state = 'detached'; return out }
  if (edit.kind === 'splitBlock' && out.target.kind === 'block' && out.target.blockId === edit.blockId) out.target = { kind: 'range', spans: [{ segmentId: edit.segmentId, blockId: edit.blockId, from: 0, to: feedText(edit.preimage).length }] }
  if (edit.kind === 'splitBlock' && out.target.kind === 'range') {
    const cut = feedText(edit.first).length
    out.target.spans = out.target.spans.flatMap(span => {
      if (span.blockId !== edit.blockId) return [span]
      if (span.from >= cut) return [{ ...span, blockId: edit.second.attrs.id, from: span.from - cut, to: span.to - cut }]
      if (span.to > cut) return [{ ...span, to: cut }, { ...span, blockId: edit.second.attrs.id, from: 0, to: span.to - cut }]
      return [span]
    })
  } else if (edit.kind === 'joinBlocks') {
    const cut = feedText(edit.preimage[0]).length
    if (out.target.kind === 'block' && [edit.blockId, edit.secondId].includes(out.target.blockId)) out.target = { kind: 'range', spans: [{ segmentId: edit.segmentId, blockId: edit.blockId, from: out.target.blockId === edit.secondId ? cut : 0, to: out.target.blockId === edit.secondId ? cut + feedText(edit.preimage[1]).length : cut }] }
    if (out.target.kind === 'range') {
      for (const span of out.target.spans) if (span.blockId === edit.secondId) { span.blockId = edit.blockId; span.from += cut; span.to += cut }
      out.target.spans = out.target.spans.reduce<FeedSpan[]>((all, span) => { const previous = all.at(-1); if (previous?.blockId === span.blockId && previous.to === span.from) previous.to = span.to; else all.push(span); return all }, [])
    }
  } else if (edit.kind === 'replaceText') {
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
export function applyFeedEdits(input: FeedComposition, edits: FeedEdit[], anchors: FeedAnchor[] = [], validateTransition?: (before: FeedComposition, after: FeedComposition) => void): { composition: FeedComposition; inverse: FeedEdit[]; anchors: FeedAnchor[] } {
  let composition = structuredClone(validateFeedComposition(input)); let mapped = structuredClone(anchors); let inverse: FeedEdit[] = []
  for (const edit of edits) {
    const before = structuredClone(composition); const undo: FeedEdit[] = []
    if (edit.kind === 'reshapeSegment') {
      const segment = composition.segments.find(s => s.id === edit.segmentId)
      if (!segment || !equal(segment.content, edit.preimage) || !equal(feedLeaves(edit.preimage), feedLeaves(edit.replacement))) throw new FeedCompositionError('preimage_conflict')
      segment.content = structuredClone(edit.replacement)
      undo.push({ ...edit, preimage: edit.replacement, replacement: edit.preimage })
    } else if (edit.kind === 'splitBlock') {
      const { node, siblings, index } = locateFeedNode(composition, edit.segmentId, edit.blockId)
      if (!equal(node, edit.preimage) || edit.first.attrs.id !== edit.blockId || !isFeedTextBlock(node) || !isFeedTextBlock(edit.first) || !isFeedTextBlock(edit.second) || !equal(normalizeFeedInline([...(edit.first.content ?? []), ...(edit.second.content ?? [])]), node.content ?? [])) throw new FeedCompositionError('preimage_conflict')
      siblings.splice(index, 1, structuredClone(edit.first), structuredClone(edit.second))
      undo.push({ kind: 'joinBlocks', segmentId: edit.segmentId, blockId: edit.blockId, secondId: edit.second.attrs.id, preimage: [edit.first, edit.second], replacement: node })
    } else if (edit.kind === 'joinBlocks') {
      const { node, siblings, index } = locateFeedNode(composition, edit.segmentId, edit.blockId); const second = siblings[index + 1]
      if (!second || second.attrs.id !== edit.secondId || !equal([node, second], edit.preimage) || !isFeedTextBlock(node) || !isFeedTextBlock(second) || !isFeedTextBlock(edit.replacement) || edit.replacement.attrs.id !== edit.blockId || !equal(normalizeFeedInline([...(node.content ?? []), ...(second.content ?? [])]), edit.replacement.content ?? [])) throw new FeedCompositionError('preimage_conflict')
      siblings.splice(index, 2, structuredClone(edit.replacement))
      undo.push({ kind: 'splitBlock', segmentId: edit.segmentId, blockId: edit.blockId, preimage: edit.replacement, first: node, second })
    } else if (edit.kind === 'replaceText') {
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
    validateTransition?.(before, composition)
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

function feedLeaves(nodes: FeedNode[]): FeedNode[] { return nodes.flatMap(node => 'content' in node && node.type !== 'paragraph' && node.type !== 'heading' ? feedLeaves(node.content) : [node]) }

function isFeedTextBlock(node: FeedNode): node is Extract<FeedNode, { type: 'paragraph' | 'heading' }> { return node.type === 'paragraph' || node.type === 'heading' }

/** Minimal leaf edits before a container reshape keep existing ranges mappable. */
function diffFeedLeaf(segmentId: string, prior: FeedNode, node: FeedNode): FeedEdit {
  if ((node.type === 'paragraph' || node.type === 'heading') && node.type === prior.type && equal(node.attrs, prior.attrs) && (prior.type === 'paragraph' || prior.type === 'heading')) {
    const a = prior.content ?? []; const b = node.content ?? []; const at = inlineText(a); const bt = inlineText(b)
    let from = 0; let suffix = 0
    while (from < Math.min(at.length, bt.length) && at[from] === bt[from]) from++
    while (suffix < Math.min(at.length, bt.length) - from && at[at.length - suffix - 1] === bt[bt.length - suffix - 1]) suffix++
    if (!equal(sliceFeedInline(a, 0, from), sliceFeedInline(b, 0, from))) from = 0
    if (!equal(sliceFeedInline(a, at.length - suffix, at.length), sliceFeedInline(b, bt.length - suffix, bt.length))) suffix = 0
    return { kind: 'replaceText', spans: [{ segmentId, blockId: node.attrs.id, from, to: at.length - suffix }], preimage: [sliceFeedInline(a, from, at.length - suffix)], replacement: [sliceFeedInline(b, from, bt.length - suffix)] }
  }
  return { kind: 'replaceBlock', segmentId, blockId: node.attrs.id, preimage: prior, replacement: [node] }
}
/** Convert an editor snapshot into ordered, preimage-checked operations. */
export function diffFeedComposition(before: FeedComposition, after: FeedComposition): FeedEdit[] {
  validateFeedComposition(after); const edits: FeedEdit[] = []
  // Prove Enter/Backspace text relocation before falling back to replacements.
  // This preserves range identity through a paragraph split or join.
  for (const row of walkFeed(before)) {
    const node = row.node; if (!isFeedTextBlock(node)) continue
    const old = locateFeedNode(before, row.segmentId, node.attrs.id)
    let next: ReturnType<typeof locateFeedNode>
    try { next = locateFeedNode(after, row.segmentId, node.attrs.id) } catch { continue }
    const first = next.node; const second = next.siblings[next.index + 1]
    if (second && isFeedTextBlock(first) && isFeedTextBlock(second) && !walkFeed(before).some(r => r.node.attrs.id === second.attrs.id) && equal(normalizeFeedInline([...(first.content ?? []), ...(second.content ?? [])]), node.content ?? [])) {
      const split: FeedEdit = { kind: 'splitBlock', segmentId: row.segmentId, blockId: node.attrs.id, preimage: node, first, second }
      const changed = applyFeedEdits(before, [split]).composition; return [split, ...diffFeedComposition(changed, after)]
    }
    const oldSecond = old.siblings[old.index + 1]
    if (oldSecond && isFeedTextBlock(first) && isFeedTextBlock(oldSecond) && !walkFeed(after).some(r => r.node.attrs.id === oldSecond.attrs.id) && equal(normalizeFeedInline([...(node.content ?? []), ...(oldSecond.content ?? [])]), first.content ?? [])) {
      const join: FeedEdit = { kind: 'joinBlocks', segmentId: row.segmentId, blockId: node.attrs.id, secondId: oldSecond.attrs.id, preimage: [node, oldSecond], replacement: first }
      const changed = applyFeedEdits(before, [join]).composition; return [join, ...diffFeedComposition(changed, after)]
    }
  }
  for (const old of [...before.segments].reverse()) if (!after.segments.some(s => s.id === old.id)) edits.push({ kind: 'removeSegment', segmentId: old.id, preimage: old })
  for (let s = 0; s < after.segments.length; s++) {
    const next = after.segments[s]!; const old = before.segments.find(p => p.id === next.id)
    if (!old) { edits.push({ kind: 'insertSegment', afterId: s ? after.segments[s - 1]!.id : null, segment: { id: next.id, content: next.content } }); continue }
    const oldLeaves = feedLeaves(old.content); const nextLeaves = feedLeaves(next.content)
    if (!equal(old.content, next.content) && oldLeaves.length === nextLeaves.length && oldLeaves.every((node, index) => node.attrs.id === nextLeaves[index]!.attrs.id)) {
      const leafEdits = oldLeaves.flatMap((prior, index) => equal(prior, nextLeaves[index]) ? [] : [diffFeedLeaf(old.id, prior, nextLeaves[index]!)])
      const intermediate = applyFeedEdits({ version: 1, segments: [old] }, leafEdits).composition.segments[0]!
      edits.push(...leafEdits)
      if (!equal(intermediate.content, next.content)) edits.push({ kind: 'reshapeSegment', segmentId: old.id, preimage: intermediate.content, replacement: next.content })
      continue
    }
    const order = old.content.map(n => n.attrs.id)
    for (const node of [...old.content].reverse()) if (!next.content.some(n => n.attrs.id === node.attrs.id)) {
      edits.push({ kind: 'replaceBlock', segmentId: old.id, blockId: node.attrs.id, preimage: node, replacement: [] }); order.splice(order.indexOf(node.attrs.id), 1)
    }
    for (let i = 0; i < next.content.length; i++) {
      const node = next.content[i]!; const prior = old.content.find(n => n.attrs.id === node.attrs.id); const afterId = i ? next.content[i - 1]!.attrs.id : null
      if (!prior) { edits.push({ kind: 'insertBlock', segmentId: old.id, afterId, node }); order.splice(i, 0, node.attrs.id); continue }
      if (order[i] !== node.attrs.id) { edits.push({ kind: 'moveBlock', segmentId: old.id, blockId: node.attrs.id, afterId }); order.splice(order.indexOf(node.attrs.id), 1); order.splice(i, 0, node.attrs.id) }
      if (equal(prior, node)) continue
      edits.push(diffFeedLeaf(old.id, prior, node))
    }
  }
  return edits
}

/** Replacement UI and Brian share selection-preserving proposal construction. */
export function proposeFeedReplacement(composition: FeedComposition, target: FeedTarget, replacement: string): FeedEdit[] {
  if (target.kind === 'range') return [{ kind: 'replaceText', spans: target.spans,
    preimage: target.spans.map(span => { const node = locateFeedNode(composition, span.segmentId, span.blockId).node; if (!isFeedTextBlock(node)) throw new FeedCompositionError('invalid_target'); return sliceFeedInline(node.content ?? [], span.from, span.to) }),
    replacement: target.spans.map((_, index) => index === 0 ? parseFeedInline(replacement) : []),
  }]
  if (target.kind === 'block') {
    const node = locateFeedNode(composition, target.segmentId, target.blockId).node
    const content = importFeedMarkdown(replacement); content[0]!.attrs.id = node.attrs.id
    return [{ kind: 'replaceBlock', segmentId: target.segmentId, blockId: target.blockId, preimage: node, replacement: content }]
  }
  const clone = structuredClone(composition); const first = clone.segments[0]!; const moves: FeedEdit[] = []
  // Retain non-text intent before replacing a whole body, including objects
  // nested inside a quote/list. A move preserves their existing comment anchors.
  for (const row of walkFeed(clone).filter(row => row.segmentId === first.id && row.parentId && (row.node.type === 'image' || row.node.type === 'generationPlaceholder'))) {
    const found = locateFeedNode(clone, first.id, row.node.attrs.id)
    moves.push({ kind: 'moveBlock', segmentId: first.id, blockId: row.node.attrs.id, afterId: first.content.at(-1)!.attrs.id })
    found.siblings.splice(found.index, 1); first.content.push(found.node)
    if (!found.siblings.length && found.parentId) { const empty = feedParagraph(''); found.siblings.push(empty); moves.push({ kind: 'insertBlock', segmentId: first.id, parentId: found.parentId, afterId: null, node: empty }) }
  }
  const textNodes = first.content.filter(node => node.type !== 'image' && node.type !== 'generationPlaceholder')
  const content = importFeedMarkdown(replacement)
  if (!textNodes.length) return [...moves, ...content.map((node, index) => ({ kind: 'insertBlock' as const, segmentId: first.id, afterId: index ? content[index - 1]!.attrs.id : null, node }))]
  content[0]!.attrs.id = textNodes[0]!.attrs.id
  return [
    ...moves,
    ...textNodes.slice(1).reverse().map(node => ({ kind: 'replaceBlock' as const, segmentId: first.id, blockId: node.attrs.id, preimage: node, replacement: [] })),
    { kind: 'replaceBlock', segmentId: first.id, blockId: textNodes[0]!.attrs.id, preimage: textNodes[0]!, replacement: content },
  ]
}

/** Explicit slot insertion/conversion; ordinary bracketed text is untouched. */
export function insertFeedPlaceholder(composition: FeedComposition, selection: { target: FeedTarget; caret?: { segmentId: string; blockId: string; offset: number } }, kind: 'text' | 'image', convert = false, initial?: Partial<FeedPlaceholderAttrs>): FeedEdit[] {
  const brief = convert ? feedTargetQuote(composition, selection.target) : ''
  const node: Extract<FeedNode, { type: 'generationPlaceholder' }> = { type: 'generationPlaceholder', attrs: { brief, references: [], ...initial, id: id(), kind, briefRevision: 0 } }
  const edits: FeedEdit[] = []
  let current = composition
  let caret = selection.caret
  if (convert && selection.target.kind === 'range') {
    const spans = selection.target.spans
    edits.push({ kind: 'replaceText', spans, preimage: spans.map(span => { const found = locateFeedNode(composition, span.segmentId, span.blockId).node; if (!isFeedTextBlock(found)) throw new FeedCompositionError('invalid_target'); return sliceFeedInline(found.content ?? [], span.from, span.to) }), replacement: spans.map(() => []) })
    current = applyFeedEdits(composition, edits).composition
    caret = { segmentId: spans[0]!.segmentId, blockId: spans[0]!.blockId, offset: spans[0]!.from }
  } else if (convert && selection.target.kind === 'block') {
    const target = selection.target; const before = locateFeedNode(composition, target.segmentId, target.blockId).node
    if (before.type === 'image') {
      if (kind !== 'image') throw new FeedCompositionError('invalid_target')
      node.attrs.brief = initial?.brief ?? before.attrs.alt ?? ''
      if (node.attrs.altIntent === undefined && before.attrs.alt) node.attrs.altIntent = before.attrs.alt
    } else if (!isFeedTextBlock(before)) throw new FeedCompositionError('invalid_target')
    node.attrs.id = before.attrs.id
    return [{ kind: 'replaceBlock', segmentId: target.segmentId, blockId: target.blockId, preimage: before, replacement: [node] }]
  }
  if (caret) {
    const found = locateFeedNode(current, caret.segmentId, caret.blockId)
    if (!isFeedTextBlock(found.node)) throw new FeedCompositionError('invalid_target')
    const length = inlineText(found.node.content ?? []).length
    if (caret.offset < 0 || caret.offset > length) throw new FeedCompositionError('invalid_target')
    if (caret.offset === 0) edits.push({ kind: 'insertBlock', segmentId: caret.segmentId, parentId: found.parentId, afterId: found.siblings[found.index - 1]?.attrs.id ?? null, node })
    else {
      if (caret.offset < length) {
        const second = structuredClone(found.node); second.attrs.id = id(); second.content = sliceFeedInline(found.node.content ?? [], caret.offset, length)
        edits.push({ kind: 'splitBlock', segmentId: caret.segmentId, blockId: caret.blockId, preimage: found.node, first: { ...found.node, content: sliceFeedInline(found.node.content ?? [], 0, caret.offset) }, second })
      }
      edits.push({ kind: 'insertBlock', segmentId: caret.segmentId, parentId: found.parentId, afterId: caret.blockId, node })
    }
  } else {
    const target = selection.target
    const segmentId = target.kind === 'block' ? target.segmentId : composition.segments[0]!.id
    const found = target.kind === 'block' ? locateFeedNode(current, target.segmentId, target.blockId) : null
    edits.push({ kind: 'insertBlock', segmentId, afterId: found?.node.attrs.id ?? current.segments[0]!.content.at(-1)!.attrs.id, parentId: found?.parentId, node })
  }
  applyFeedEdits(composition, edits)
  return edits
}

/** Accepted content only. Callers explicitly provide any image URLs they own. */
export function feedCompositionHtml(composition: FeedComposition, imageSource?: (fileId: string, mime: string) => string): string {
  validateFeedComposition(composition)
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const inline = (content: FeedInline[] = []) => content.map(part => {
    if (part.type === 'hardBreak') return '<br>'
    let value = escape(part.text)
    for (const mark of part.marks ?? []) value = mark.type === 'bold' ? `<strong>${value}</strong>` : mark.type === 'italic' ? `<em>${value}</em>` : `<a href="${escape(mark.attrs.href)}" rel="noopener noreferrer">${value}</a>`
    return value
  }).join('')
  const node = (item: FeedNode): string => {
    if (item.type === 'generationPlaceholder') return ''
    if (item.type === 'image') return imageSource ? `<figure><img src="${escape(imageSource(item.attrs.fileId, item.attrs.mimeType))}" alt="${escape(item.attrs.alt ?? '')}"></figure>` : ''
    if (item.type === 'paragraph') return `<p>${inline(item.content)}</p>`
    if (item.type === 'heading') return `<h${item.attrs.level}>${inline(item.content)}</h${item.attrs.level}>`
    const tag = item.type === 'bulletList' ? 'ul' : item.type === 'orderedList' ? 'ol' : item.type === 'listItem' ? 'li' : 'blockquote'
    return `<${tag}${item.type === 'orderedList' ? ` start="${item.attrs.start}"` : ''}>${item.content.map(node).join('')}</${tag}>`
  }
  return composition.segments.map(segment => `<section>${segment.content.map(node).join('')}</section>`).join('\n')
}
