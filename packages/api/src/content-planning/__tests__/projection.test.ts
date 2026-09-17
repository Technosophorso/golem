import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { feedParagraph, feedCompositionHtml } from '@use-brian/doc-model'
import { feedOutputProjection, feedXLength } from '../projection.js'
import type { StructuredFeedContent } from '../../db/feed-collaboration-store.js'
const slot = { type: 'generationPlaceholder' as const, attrs: { id: randomUUID(), kind: 'text' as const, brief: 'PRIVATE SLOT BRIEF', briefRevision: 0, references: [] } }
function content(): StructuredFeedContent { return { schemaVersion: 2, title: 'Article', privateBrief: 'PRIVATE DIRECTION', postFormat: 'article', article: { sourceUrl: '', title: '', description: '' }, text: '', media: [], threadSegments: [], composition: { version: 1, segments: [{ id: randomUUID(), content: [feedParagraph('Opening <script> & text.'), { type: 'image', attrs: { id: randomUUID(), fileId: randomUUID(), mimeType: 'image/png', alt: 'Orchard "map"', placement: 'inline' } }, slot, feedParagraph('Closing paragraph.')] }] } } }
describe('[COMP:feed/draft-projection] accepted output boundary', () => {
  it('scenarios 8-9: omits private slots, preserves image order and escapes exported text and alt text', () => {
    const input = content(); const output = feedOutputProjection(input, 'linkedin')
    expect(output.missing).toEqual([{ kind: 'block', segmentId: input.composition.segments[0]!.id, blockId: slot.attrs.id }])
    expect(output.issues.map(issue => issue.code)).toEqual(['unfinished_slot'])
    expect(output.manualArticle).toBe(true)
    const html = feedCompositionHtml(input.composition, id => `assets/${id}.png`)
    expect(html.indexOf('Opening')).toBeLessThan(html.indexOf('<img')); expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Closing'))
    expect(html).toContain('&lt;script&gt; &amp;'); expect(html).toContain('Orchard &quot;map&quot;')
    expect(JSON.stringify(output)).not.toContain('PRIVATE'); expect(html).not.toContain('PRIVATE'); expect(output.html).not.toContain('<img')
  })
  it('scenario 8: enforces destination media counts, duplicate images and weighted X thread limits', () => {
    const input = content(); input.postFormat = 'thread'; input.composition.segments[0]!.content = [feedParagraph('界'.repeat(141))]
    expect(feedOutputProjection(input, 'twitter').issues.map(issue => issue.code)).toEqual(['invalid_thread', 'text_limit'])
    expect(feedXLength('https://example.com/a-very-long-path')).toBe(23)
    input.postFormat = 'post'; const image = { type: 'image' as const, attrs: { id: randomUUID(), fileId: randomUUID(), mimeType: 'image/png' as const, placement: 'attachment' as const } }
    input.composition.segments[0]!.content = Array.from({ length: 5 }, () => ({ ...image, attrs: { ...image.attrs, id: randomUUID() } }))
    expect(feedOutputProjection(input, 'twitter').issues.map(issue => issue.code)).toEqual(['media_limit', 'duplicate_media'])
  })
  it('scenario 9: keeps the existing article-link validation and marks unsupported destinations honestly', () => {
    const input = content(); input.composition.segments[0]!.content = [feedParagraph('Caption.')]
    expect(feedOutputProjection(input, 'linkedin').issues[0]?.code).toBe('article_fields')
    input.article = { sourceUrl: 'https://example.com/article', title: 'Article', description: '' }
    expect(feedOutputProjection(input, 'linkedin').issues).toHaveLength(0)
    expect(feedOutputProjection(input, 'twitter').issues[0]?.code).toBe('unsupported_format')
  })
})
