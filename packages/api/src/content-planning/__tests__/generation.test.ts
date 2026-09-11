import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { feedGenerationRequestSchema, feedGenerationEstimateRequestSchema, type FeedPlaceholderAttrs } from '@use-brian/shared'
import { feedParagraph } from '@use-brian/doc-model'
import { generationPrompt, parseFeedTextCandidates, type FeedGenerationContext } from '../generation.js'
import { createFeedGenerationPort } from '../generation-port.js'
import type { FeedEditorialRun } from '../../db/feed-editorial-runs-store.js'
const slot: FeedPlaceholderAttrs = { id: randomUUID(), kind: 'text', brief: 'Explain orchard irrigation.', briefRevision: 1, references: [] }
const segmentId = randomUUID()
const context = { slot, segmentId, request: { mutationId: randomUUID(), expectedRevision: 2, segmentId, slotId: slot.id, count: 2, model: 'standard', locale: 'en' }, content: { schemaVersion: 2, title: 'Fixture', privateBrief: 'Use concrete examples.', composition: { version: 1, segments: [{ id: segmentId, content: [feedParagraph('Opening.'), { type: 'generationPlaceholder', attrs: slot }] }] } }, sources: [], omissions: [] } as unknown as FeedGenerationContext
const run = { id: randomUUID(), revision: 2, context } as FeedEditorialRun

describe('[COMP:feed/draft-generation] estimate and candidate contract', () => {
  it('scenarios 4 and 8: requires explicit confirmation and bounded typed candidate counts', () => {
    expect(feedGenerationRequestSchema.safeParse({ mutationId: randomUUID(), estimateId: randomUUID(), confirmed: false }).success).toBe(false)
    expect(feedGenerationEstimateRequestSchema.safeParse({ ...context.request, count: 6 }).success).toBe(false)
    expect(feedGenerationRequestSchema.safeParse({ mutationId: randomUUID(), estimateId: randomUUID(), confirmed: true, price: 0 }).success).toBe(false)
  })
  it('scenario 4: creates stable typed slot replacements without mutating accepted composition', () => {
    const before = JSON.stringify(context.content)
    const candidates = parseFeedTextCandidates(JSON.stringify({ candidates: [{ markdown: '**Measured** irrigation.\n\nA second paragraph.', rationale: 'Uses a concrete claim for review.' }] }), run)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ runId: run.id, slotId: slot.id, briefRevision: 1, sourceRevision: 2 })
    const edit = candidates[0]!.edits[0]!
    expect(edit.kind).toBe('replaceBlock')
    if (edit.kind === 'replaceBlock') { expect(edit.preimage).toEqual({ type: 'generationPlaceholder', attrs: slot }); expect(edit.replacement[0]!.attrs.id).toBe(slot.id); expect(edit.replacement).toHaveLength(2) }
    expect(JSON.stringify(context.content)).toBe(before)
  })
  it('scenario 8: refuses empty, malformed and over-count results without retrying a provider', () => {
    for (const text of ['not json', '{"candidates":[]}', '{"candidates":[{"markdown":"","rationale":""}]}', JSON.stringify({ candidates: [1, 2, 3].map(() => ({ markdown: 'Draft.', rationale: '' })) })]) expect(() => parseFeedTextCandidates(text, run)).toThrow()
  })
  it('scenario 8: excludes whole oversized sources and rejects an oversized required outline', () => {
    const bounded = generationPrompt({ ...context, sources: [{ id: 'oversized', title: 'Notes', body: 'x'.repeat(50_000), hash: 'hash' }] }, 40_000)
    expect(bounded.sources).toHaveLength(0); expect(bounded.omissions).toContain('oversized:input_limit')
    expect(() => generationPrompt(context, 10)).toThrow('generation_context_too_large')
  })
  it('scenario 8: resolves text without calling it and reports unpriced BYO honestly', async () => {
    const call = vi.fn(); const port = createFeedGenerationPort(async () => ({ model: 'custom-fixture', tier: 'standard', providerKeySource: 'user', inputCharacters: 20_000, maxTokens: 6000, call }))
    const resolved = await port.resolve({ workspaceId: randomUUID(), userId: randomUUID(), assistantId: randomUUID(), sessionId: randomUUID() }, 'text', 'standard')
    expect(resolved.price(100)).toMatchObject({ maximumUsd: null, billing: 'byo', currency: 'USD' }); expect(call).not.toHaveBeenCalled()
  })
})
