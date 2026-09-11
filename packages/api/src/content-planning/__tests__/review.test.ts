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
