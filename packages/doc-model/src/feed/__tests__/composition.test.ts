import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FeedComposition, FeedEdit, FeedInline, FeedNode } from '@use-brian/shared'
import { applyFeedEdits, createFeedAnchor, duplicateFeedNode, feedParagraph, feedSchema, feedTargetQuote, feedText, importLegacyFeed, projectFeed, sliceFeedInline, validateFeedComposition, walkFeed } from '../model.js'
const inline = (text: string): FeedInline[] => text ? [{ type: 'text', text }] : []
const imported = (text = 'A first paragraph.\n\nThe same phrase.\n\nThe same phrase.') => importLegacyFeed({ text, postFormat: 'post', threadSegments: [], media: [] })
function replace(composition: FeedComposition, block: number, from: number, to: number, text: string): FeedEdit {
  const segment = composition.segments[0]!; const node = segment.content[block]!
  if (node.type !== 'paragraph' && node.type !== 'heading') throw new Error('text node required')
  return { kind: 'replaceText', spans: [{ segmentId: segment.id, blockId: node.attrs.id, from, to }], preimage: [sliceFeedInline(node.content ?? [], from, to)], replacement: [inline(text)] }
}
describe('[COMP:feed/composition-model] canonical conversion and transaction operations', () => {
  it.each(['', '  ', '\n\n', '**Bold** and *italic*, [source](https://example.com/a).', '- one\n- two\n\n1. first\n2. second', '# Heading\n\n> Quote\n> More', 'Unicode 👩🏽‍💻 中文 日本語 café\n\n', '```unknown\n[ordinary notes]\n```\n| a | b |', 'line\r\n\r\nlast  '])('scenario 9: retains exact supported or literal legacy bytes: %j', text => {
    const composition = imported(text)
    expect(projectFeed(composition).text).toBe(text)
    expect(validateFeedComposition(JSON.parse(JSON.stringify(composition)))).toEqual(composition)
    expect(() => feedSchema.nodeFromJSON({ type: 'doc', content: composition.segments[0]!.content }).check()).not.toThrow()
  })
  it('scenario 9: preserves thread boundaries, article captions and existing ordered media', () => {
    const media = [{ fileId: randomUUID(), mimeType: 'image/png' as const, alt: 'Diagram' }, { fileId: randomUUID(), mimeType: 'image/jpeg' as const }]
    const composition = importLegacyFeed({ text: 'compatibility', postFormat: 'thread', threadSegments: ['one\n', '', '*three*'], media })
    expect(projectFeed(composition).threadSegments).toEqual(['one\n', '', '*three*'])
    expect(projectFeed(composition).media).toEqual(media)
    expect(projectFeed(importLegacyFeed({ text: 'article commentary', postFormat: 'article', threadSegments: [], media: [] })).text).toBe('article commentary')
  })
  it('scenarios 1 and 2: maps the second duplicate, preserves moves and detaches deletion without quote search', () => {
    const composition = imported(); const segment = composition.segments[0]!; const target = segment.content[2]!
    const anchor = createFeedAnchor(composition, { kind: 'range', spans: [{ segmentId: segment.id, blockId: target.attrs.id, from: 4, to: 15 }] }, 1)
    const edited = applyFeedEdits(composition, [replace(composition, 2, 0, 0, 'Now: ')], [anchor])
    expect(edited.anchors[0]!.target).toMatchObject({ spans: [{ blockId: target.attrs.id, from: 9, to: 20 }] })
    expect(edited.anchors[0]!.state).toBe('attached')
    const moved = applyFeedEdits(edited.composition, [{ kind: 'moveBlock', segmentId: segment.id, blockId: target.attrs.id, afterId: null }], edited.anchors)
    expect(moved.composition.segments[0]!.content[0]!.attrs.id).toBe(target.attrs.id)
    expect(moved.anchors).toEqual(edited.anchors)
    const removed = applyFeedEdits(moved.composition, [{ kind: 'replaceBlock', segmentId: segment.id, blockId: target.attrs.id, preimage: moved.composition.segments[0]!.content[0]!, replacement: [] }], moved.anchors)
    expect(removed.anchors[0]!.state).toBe('detached')
    expect(removed.anchors[0]!.quote).toBe('same phrase')
  })
  it('scenario 1: multi-paragraph accept and inverse preserve all unselected content and formatting', () => {
    const composition = imported('Keep **bold**.\n\nRewrite one.\n\nRewrite two.\n\nKeep ending.')
    const a = replace(composition, 1, 0, 12, 'First improvement.') as Extract<FeedEdit, { kind: 'replaceText' }>
    const b = replace(composition, 2, 0, 12, 'Second improvement.') as typeof a
    const edit = { ...a, spans: [...a.spans, ...b.spans], preimage: [...a.preimage, ...b.preimage], replacement: [...a.replacement, ...b.replacement] }
    const applied = applyFeedEdits(composition, [edit])
    expect(projectFeed(applied.composition).text).toBe('Keep **bold**.\n\nFirst improvement.\n\nSecond improvement.\n\nKeep ending.')
    expect(applyFeedEdits(applied.composition, applied.inverse).composition).toEqual(composition)
  })
  it('scenario 3: preimages reject a changed target and inverse cannot overwrite later edits', () => {
    const composition = imported('before'); const first = applyFeedEdits(composition, [replace(composition, 0, 0, 6, 'after')])
    expect(() => applyFeedEdits(first.composition, [replace(composition, 0, 0, 6, 'other')])).toThrow()
    const changed = applyFeedEdits(first.composition, [replace(first.composition, 0, 0, 5, 'later')])
    expect(() => applyFeedEdits(changed.composition, first.inverse)).toThrow('preimage_conflict')
  })
  it('scenario 2: deleting the complete selected text detaches its discussion even when the block remains', () => {
    const composition = imported('a target b'); const s = composition.segments[0]!
    const anchor = createFeedAnchor(composition, { kind: 'range', spans: [{ segmentId: s.id, blockId: s.content[0]!.attrs.id, from: 2, to: 8 }] }, 1)
    expect(applyFeedEdits(composition, [replace(composition, 0, 2, 8, '')], [anchor]).anchors[0]!.state).toBe('detached')
  })
  it('scenarios 5 and 8: duplicates slot identity without a job and projections omit every private brief', () => {
    const composition = imported('Accepted content'); const slot: FeedNode = { type: 'generationPlaceholder', attrs: { id: randomUUID(), kind: 'image', brief: 'Private image prompt', briefRevision: 3, references: [] } }
    const duplicate = duplicateFeedNode(slot)
    expect(duplicate.attrs.id).not.toBe(slot.attrs.id)
    const s = composition.segments[0]!
    const applied = applyFeedEdits(composition, [{ kind: 'insertBlock', segmentId: s.id, afterId: s.content[0]!.attrs.id, node: slot }, { kind: 'insertBlock', segmentId: s.id, afterId: slot.attrs.id, node: duplicate }])
    expect(projectFeed(applied.composition).text).toBe('Accepted content')
    expect(projectFeed(applied.composition).missingSlots).toEqual([slot.attrs.id, duplicate.attrs.id])
    expect(JSON.stringify(projectFeed(applied.composition))).not.toContain('Private image prompt')
  })
  it('scenario 7: rejects cross-segment targets, reversed spans, duplicate identities and unsupported versions', () => {
    const composition = imported(); const s = composition.segments[0]!
    expect(() => feedTargetQuote(composition, { kind: 'block', segmentId: randomUUID(), blockId: s.content[0]!.attrs.id })).toThrow()
    expect(() => feedTargetQuote(composition, { kind: 'range', spans: [2, 0].map(i => ({ segmentId: s.id, blockId: s.content[i]!.attrs.id, from: 0, to: 1 })) })).toThrow()
    expect(() => validateFeedComposition({ ...composition, version: 3 })).toThrow()
    expect(() => applyFeedEdits(composition, [{ kind: 'insertBlock', segmentId: s.id, afterId: null, node: s.content[0]! }])).toThrow()
    expect(() => validateFeedComposition({ version: 1, segments: [{ id: randomUUID(), content: [feedParagraph('a'.repeat(100_001))] }] })).toThrow()
  })
  it('preserves nested list anchors and Unicode offsets through a partial inverse edit', () => {
    const composition = imported('- 👩🏽‍💻 work\n- next'); const rows = walkFeed(composition); const row = rows.find(r => r.node.type === 'paragraph')!
    const node = row.node as Extract<FeedNode, { type: 'paragraph' }>; const from = feedText(node).indexOf('work')
    const edit: FeedEdit = { kind: 'replaceText', spans: [{ segmentId: row.segmentId, blockId: node.attrs.id, from, to: from + 4 }], preimage: [inline('work')], replacement: [inline('write')] }
    const result = applyFeedEdits(composition, [edit]); const restored = applyFeedEdits(result.composition, result.inverse)
    expect(restored.composition).toEqual(composition)
  })
})
