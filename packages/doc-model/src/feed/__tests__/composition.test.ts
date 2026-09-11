import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { FeedComposition, FeedEdit, FeedInline, FeedNode } from '@use-brian/shared'
import { applyFeedEdits, insertFeedPlaceholder, diffFeedComposition, proposeFeedReplacement, createFeedAnchor, duplicateFeedNode, feedParagraph, feedSchema, feedTargetQuote, feedText, importLegacyFeed, projectFeed, sliceFeedInline, validateFeedComposition, walkFeed } from '../model.js'
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

describe('[COMP:feed/composition-model] editor identity and proposal mapping', () => {
  it('maps comments through simultaneous prefix removal, wrapping, nested typing and inverse reshaping', () => {
    const before = imported(); const segment = before.segments[0]!;
    segment.content = [feedParagraph('- Target phrase.'), feedParagraph('Untouched.')];
    const leaf = segment.content[0]!;
    const anchor = createFeedAnchor(before, { kind: 'range', spans: [{ segmentId: segment.id, blockId: leaf.attrs.id, from: 2, to: 8 }] }, 1);
    const after = structuredClone(before);
    after.segments[0]!.content[0] = { type: 'bulletList', attrs: { id: randomUUID() }, content: [{ type: 'listItem', attrs: { id: randomUUID() }, content: [feedParagraph('Target phrase.', leaf.attrs.id)] }] };
    const edits = diffFeedComposition(before, after);
    expect(edits.map(edit => edit.kind)).toEqual(['replaceText', 'reshapeSegment']);
    const result = applyFeedEdits(before, edits, [anchor]);
    expect(result.composition).toEqual(after);
    expect(result.anchors[0]).toMatchObject({ state: 'attached', target: { spans: [{ blockId: leaf.attrs.id, from: 0, to: 6 }] } });
    const typed = structuredClone(after);
    const nested = walkFeed(typed).find(row => row.node.attrs.id === leaf.attrs.id)!.node as Extract<FeedNode, { type: 'paragraph' }>;
    nested.content = inline('Now: Target phrase.');
    const typedResult = applyFeedEdits(after, diffFeedComposition(after, typed), result.anchors);
    expect(typedResult.anchors[0]).toMatchObject({ state: 'attached', target: { spans: [{ from: 5, to: 11 }] } });
    const restored = applyFeedEdits(after, diffFeedComposition(after, before), result.anchors);
    expect(restored.composition).toEqual(before);
    expect(restored.anchors).toEqual([anchor]);
    expect(applyFeedEdits(result.composition, result.inverse).composition).toEqual(before);
  });
  it('scenario 2: splits and rejoins a highlighted passage without changing its quote or target identity', () => {
    const composition = imported('Before selected passage after.'); const segment = composition.segments[0]!; const block = segment.content[0]!;
    const anchor = createFeedAnchor(composition, { kind: 'range', spans: [{ segmentId: segment.id, blockId: block.attrs.id, from: 7, to: 23 }] }, 2)
    const after = structuredClone(composition); after.segments[0]!.content = [feedParagraph('Before selected ', block.attrs.id), feedParagraph('passage after.')]
    const edits = diffFeedComposition(composition, after)
    expect(edits[0]!.kind).toBe('splitBlock')
    const split = applyFeedEdits(composition, edits, [anchor])
    expect(split.anchors[0]!.target).toMatchObject({ kind: 'range', spans: [{ from: 7, to: 16 }, { from: 0, to: 7 }] })
    expect(split.anchors[0]!.state).toBe('attached')
    const joined = applyFeedEdits(split.composition, diffFeedComposition(split.composition, composition), split.anchors)
    expect(joined.anchors).toEqual([anchor]); expect(joined.composition).toEqual(composition)
  })
  it('scenario 2: whole-block comments retain the original text through a split and join', () => {
    const composition = imported('one two'); const segment = composition.segments[0]!; const node = segment.content[0]!
    const anchor = createFeedAnchor(composition, { kind: 'block', segmentId: segment.id, blockId: node.attrs.id }, 2)
    const after = structuredClone(composition); after.segments[0]!.content = [feedParagraph('one ', node.attrs.id), feedParagraph('two')]
    const split = applyFeedEdits(composition, diffFeedComposition(composition, after), [anchor])
    expect(split.anchors[0]!.target).toMatchObject({ kind: 'range', spans: [{ from: 0, to: 4 }, { from: 0, to: 3 }] })
    expect(feedTargetQuote(split.composition, split.anchors[0]!.target)).toBe('one \ntwo')
  })
  it('scenario 1: proposal construction changes a multi-block selection and retains unselected formatting', () => {
    const composition = imported('First **bold** ending.\n\nSecond start and ending.'); const segment = composition.segments[0]!
    const target = { kind: 'range' as const, spans: [{ segmentId: segment.id, blockId: segment.content[0]!.attrs.id, from: 11, to: 18 }, { segmentId: segment.id, blockId: segment.content[1]!.attrs.id, from: 0, to: 12 }] }
    const edits = proposeFeedReplacement(composition, target, 'revised')
    const applied = applyFeedEdits(composition, edits)
    expect(projectFeed(applied.composition).text).toBe('First **bold** revised\n\n and ending.')
    expect(applyFeedEdits(applied.composition, applied.inverse).composition).toEqual(composition)
  })
  it('scenario 11: a whole-body alternative preserves image and intentional placeholder objects', () => {
    const composition = imported('Original body.'); const segment = composition.segments[0]!
    const image: FeedNode = { type: 'image', attrs: { id: randomUUID(), fileId: randomUUID(), mimeType: 'image/png', placement: 'inline', alt: 'Existing diagram' } }
    const slot: FeedNode = { type: 'generationPlaceholder', attrs: { id: randomUUID(), kind: 'text', brief: 'A missing example', briefRevision: 0, references: [] } }
    segment.content.push(image, slot)
    const applied = applyFeedEdits(composition, proposeFeedReplacement(composition, { kind: 'post' }, 'New body.'))
    expect(applied.composition.segments[0]!.content.slice(1)).toEqual([image, slot])
    expect(projectFeed(applied.composition).text).toBe('New body.')
  })
  it('scenario 9: the explicit import seed gives both sides the same IDs without changing legacy bytes', () => {
    const source = { text: '**Legacy** 中文\n\n', postFormat: 'post' as const, threadSegments: [], media: [] }; const seed = randomUUID()
    expect(importLegacyFeed(source, seed)).toEqual(importLegacyFeed(source, seed))
    expect(importLegacyFeed(source, randomUUID()).segments[0]!.id).not.toBe(importLegacyFeed(source, seed).segments[0]!.id)
    expect(projectFeed(importLegacyFeed(source, seed)).text).toBe(source.text)
  })
})

describe('[COMP:feed/composition-model] retained object identity in alternatives', () => {
  it('scenario 11: a whole-body rewrite moves nested media without detaching its discussion', () => {
    const image: FeedNode = { type: 'image', attrs: { id: randomUUID(), fileId: randomUUID(), mimeType: 'image/png', placement: 'inline' } }
    const composition: FeedComposition = { version: 1, segments: [{ id: randomUUID(), content: [{ type: 'blockquote', attrs: { id: randomUUID() }, content: [image] }, feedParagraph('Previous body')] }] }
    const anchor = createFeedAnchor(composition, { kind: 'block', segmentId: composition.segments[0]!.id, blockId: image.attrs.id }, 2)
    const applied = applyFeedEdits(composition, proposeFeedReplacement(composition, { kind: 'post' }, 'Replacement body'), [anchor])
    expect(applied.anchors).toEqual([anchor]); expect(projectFeed(applied.composition).media).toHaveLength(1)
    expect(projectFeed(applied.composition).text).toBe('Replacement body')
    expect(applyFeedEdits(applied.composition, applied.inverse).composition).toEqual(composition)
  })
})


describe('[COMP:feed/composition-model] typed placeholder authoring', () => {
  it('scenario 4: caret insertion splits formatted text and Undo restores exact source', () => {
    const composition = imported('Before **after**.'); const segment = composition.segments[0]!; const blockId = segment.content[0]!.attrs.id
    const edits = insertFeedPlaceholder(composition, { target: { kind: 'block', segmentId: segment.id, blockId }, caret: { segmentId: segment.id, blockId, offset: 7 } }, 'text')
    const changed = applyFeedEdits(composition, edits)
    expect(changed.composition.segments[0]!.content.map(n => n.type)).toEqual(['paragraph', 'generationPlaceholder', 'paragraph'])
    expect(projectFeed(changed.composition).text).toContain('**after**')
    expect(applyFeedEdits(changed.composition, changed.inverse).composition).toEqual(composition)
  })
  it('scenarios 4 and 6: converts only the selected duplicate notes and duplicates get new slot IDs', () => {
    const composition = imported('[notes] then [notes].'); const segment = composition.segments[0]!; const blockId = segment.content[0]!.attrs.id
    const changed = applyFeedEdits(composition, insertFeedPlaceholder(composition, { target: { kind: 'range', spans: [{ segmentId: segment.id, blockId, from: 13, to: 20 }] } }, 'image', true))
    const placeholder = walkFeed(changed.composition).find(n => n.node.type === 'generationPlaceholder')!.node
    expect(placeholder).toMatchObject({ type: 'generationPlaceholder', attrs: { kind: 'image', brief: '[notes]', briefRevision: 0 } })
    expect(feedText(changed.composition.segments[0]!.content[0]!)).toBe('[notes] then ')
    expect(duplicateFeedNode(placeholder).attrs.id).not.toBe(placeholder.attrs.id)
    expect(projectFeed(composition).text).toBe('[notes] then [notes].')
  })
})
