import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { boundFeedLearningInput, parseFeedLearningSummary, type FeedLearningInput } from '../learning.js'
import { feedApplicabilityKey } from '../../db/playbook-store.js'

const author = randomUUID()
const approver = randomUUID()
const input: FeedLearningInput = {
  confirmationId: randomUUID(), title: 'Orchard example',
  scope: { platform: 'threads', postFormat: 'post', brandId: null, sensitivity: 'internal', compartments: [], projectIds: [] },
  sources: [
    { id: 'human', kind: 'decision', actorUserId: author, outcome: 'rejected', body: 'Use a concrete opening.' },
    { id: 'assistant', kind: 'proposal', actorUserId: null, outcome: 'unchosen', body: 'A promotional alternative.' },
  ], actorIds: [author],
  coverage: { eligible: 2, included: 2, omitted: 0, missing: 0, omittedActors: 0, revisionReferences: 0, decisionReferences: 1, proposalReferences: 1, messageReferences: 0 },
}
const summary = { summary: 'The author kept the concrete opening.', decisions: [{ statement: 'The author rejected promotional wording.', actorUserId: author, outcome: 'rejected', sourceIds: ['human'] }], conflicts: [], unresolved: [] }

describe('[COMP:feed/confirmation-learning] bounded source-grounded learning', () => {
  it('scenario 13: stores a historical summary without requiring or inventing a general rule', () => {
    expect(parseFeedLearningSummary(JSON.stringify(summary), input)).toEqual(summary)
    expect(parseFeedLearningSummary(JSON.stringify({ ...summary, decisions: [] }), input).decisions).toEqual([])
    expect(() => parseFeedLearningSummary(JSON.stringify({ ...summary, rules: ['Always use this wording.'] }), input)).toThrow()
  })
  it('scenarios 11 and 14: attributes actual contributors; confirmation does not transfer their choices to its approver', () => {
    expect(() => parseFeedLearningSummary(JSON.stringify({ ...summary, decisions: [{ ...summary.decisions[0], actorUserId: approver }] }), input)).toThrow('learning_actor_reference_invalid')
    expect(() => parseFeedLearningSummary(JSON.stringify({ ...summary, decisions: [{ ...summary.decisions[0], sourceIds: ['assistant'] }] }), input)).toThrow('learning_actor_reference_invalid')
    expect(() => parseFeedLearningSummary(JSON.stringify({ ...summary, decisions: [{ ...summary.decisions[0], outcome: 'accepted' }] }), input)).toThrow('learning_outcome_reference_invalid')
  })
  it('scenarios 11 and 13: preserves unchosen alternatives, unknown reasons and unresolved conflict', () => {
    const unchosen = { statement: 'An assistant alternative remained unchosen; no human reason was recorded.', actorUserId: null, outcome: 'unchosen', sourceIds: ['assistant'] }
    const conflict = { statement: 'No shared preference was established.', sourceIds: ['human', 'assistant'] }
    expect(parseFeedLearningSummary(JSON.stringify({ ...summary, decisions: [unchosen], conflicts: [conflict], unresolved: ['Which format should a future post use?'] }), input)).toMatchObject({ decisions: [unchosen], conflicts: [conflict] })
  })
  it('scenario 15: omitted or fabricated references cannot substantiate a saved lesson', () => {
    const bounded = boundFeedLearningInput(input, JSON.stringify(input).length - 10)
    expect(bounded.sources).toEqual([input.sources[0]])
    expect(bounded.coverage).toMatchObject({ included: 1, omitted: 1 })
    expect(input.sources).toHaveLength(2)
    expect(() => parseFeedLearningSummary(JSON.stringify({ ...summary, conflicts: [{ statement: 'Omitted alternative.', sourceIds: ['assistant'] }] }), bounded)).toThrow('learning_source_reference_invalid')
    expect(() => boundFeedLearningInput(input, 1)).toThrow('learning_context_too_large')
  })
  it('scenario 14: scope identity retains platform, format, brand, compartments and project; set order cannot duplicate a lesson', () => {
    const scope = { ...input.scope, compartments: ['design', 'editorial'], projectIds: [randomUUID(), randomUUID()] }
    expect(feedApplicabilityKey(scope)).toBe(feedApplicabilityKey({ ...scope, compartments: [...scope.compartments].reverse(), projectIds: [...scope.projectIds].reverse() }))
    for (const changed of [{ platform: 'linkedin' }, { postFormat: 'article' as const }, { brandId: randomUUID() }, { compartments: [] }, { projectIds: [] }]) expect(feedApplicabilityKey({ ...scope, ...changed })).not.toBe(feedApplicabilityKey(scope))
  })
})
