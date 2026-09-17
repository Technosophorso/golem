import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FEED_REVIEW_DIMENSIONS, FEED_EDITORIAL_LIMITS, type FeedReviewContext, type FeedReviewFinding } from '@use-brian/shared'
import { importLegacyFeed } from '@use-brian/doc-model'
import { validateFeedReviewOutput, mergeFeedReviewFindings } from '../review.js'
import { boundFeedReviewSources } from '../review-context.js'
function context(): FeedReviewContext {
  const coverage = { state: 'checked' as const, eligible: 1, retrieved: 1, reviewed: 0, limits: [] }
  const sources = [{ id: 'fixture', kind: 'memory' as const, title: 'Approved preference', hash: 'fixture-hash', body: 'Use specific examples.' }]
  return { version: 1, revision: 2, month: '2026-09', platform: 'threads', goalId: null, brandId: null, historyAssistantIds: [randomUUID()], contextHash: 'fixture', composition: importLegacyFeed({ text: 'A vague example.', postFormat: 'post', threadSegments: [], media: [] }), dimensions: { monthly_plan: { sources, coverage }, post_history: { sources, coverage }, post_goal: { sources, coverage }, memory: { sources, coverage }, content: { sources, coverage } } }
}
const finding: FeedReviewFinding = { issueKey: 'specific_examples', dimensions: ['memory'], priority: 'medium', target: { kind: 'post' }, issue: 'The example is too broad.', nextStep: 'Name a concrete outcome.', evidence: [{ sourceId: 'fixture', quote: 'specific examples' }] }
describe('[COMP:feed/draft-review] five-dimension evidence contract', () => {
  it('scenario 16: validates all five independent checks without changing composition or authorizing edits', () => {
    const input = context(); const before = structuredClone(input.composition)
    for (const dimension of FEED_REVIEW_DIMENSIONS) expect(validateFeedReviewOutput(JSON.stringify({ findings: [{ ...finding, dimensions: [dimension] }] }), dimension, input)).toHaveLength(1)
    expect(input.composition).toEqual(before)
  })
  it('scenario 19: refuses invented sources, fabricated quotes, and invalid anchors', () => {
    for (const patch of [{ dimensions: ['memory', 'post_history'] }, { evidence: [{ sourceId: 'invented' }] }, { evidence: [{ sourceId: 'fixture', quote: 'Fabricated claim' }] }, { target: { kind: 'block', segmentId: randomUUID(), blockId: randomUUID() } }]) {
      expect(() => validateFeedReviewOutput(JSON.stringify({ findings: [{ ...finding, ...patch }] }), 'memory', context())).toThrow()
    }
  })
  it('scenario 20: one issue across checks merges dimensions and evidence without duplicate comments', () => {
    const merged = mergeFeedReviewFindings([finding, { ...finding, dimensions: ['content'], priority: 'high' }])
    expect(merged).toHaveLength(1); expect(merged[0]).toMatchObject({ dimensions: ['memory', 'content'], priority: 'high', evidence: finding.evidence })
  })
  it('scenario 19: oversized sources are omitted whole and never counted as checked', () => {
    const source = context().dimensions.memory.sources[0]!
    const result = boundFeedReviewSources([{ ...source, body: 'a'.repeat(FEED_EDITORIAL_LIMITS.sourceCharacters + 1) }, { ...source, id: 'small' }], { state: 'checked', eligible: 2, retrieved: 2, reviewed: 0, limits: [] })
    expect(result.sources.map(item => item.id)).toEqual(['small'])
    expect(result.coverage).toMatchObject({ state: 'partial', eligible: 2, retrieved: 1, reviewed: 0, limits: ['whole_source_input_limit'] })
  })
})

import { deterministicFeedFindings } from '../review.js'
import type { StructuredFeedContent } from '../../db/feed-collaboration-store.js'
describe('[COMP:feed/draft-review] deterministic image and brand checks', () => {
  it('scenarios 8 and 16: unfinished targets and literal prohibited copy produce localized comments without edits', () => {
    const input = context(); const phrase = 'Always promise perfect irrigation'; const slotId = randomUUID()
    input.composition.segments[0]!.content.push({ type: 'generationPlaceholder', attrs: { id: slotId, kind: 'image', brief: 'PRIVATE BRIEF', briefRevision: 0, references: [] } })
    input.dimensions.content.sources = [{ id: 'composition:fixture', kind: 'composition', title: 'Draft', body: phrase, hash: 'fixture' }]
    input.dimensions.memory.sources = [{ id: 'brand:fixture', kind: 'brand', title: 'Brand', body: JSON.stringify({ naming: { restrictedTerms: [phrase] } }), hash: 'fixture' }]
    const content = { schemaVersion: 2, composition: input.composition, title: 'Fixture', privateBrief: '', postFormat: 'post', article: { sourceUrl: '', title: '', description: '' }, media: [], text: phrase, threadSegments: [] } as StructuredFeedContent
    const before = JSON.stringify(content)
    for (const locale of ['en', 'ja', 'zh', 'zh-cn'] as const) {
      const findings = deterministicFeedFindings(input, content, locale)
      expect(findings).toHaveLength(2); expect(findings[0]!.target).toMatchObject({ kind: 'block', blockId: slotId }); expect(findings[1]!.evidence[0]!.sourceId).toBe('brand:fixture')
      expect(findings.every(finding => !finding.suggestion)).toBe(true); expect(JSON.stringify(findings)).not.toContain('PRIVATE')
    }
    expect(JSON.stringify(content)).toBe(before)
  })
})
