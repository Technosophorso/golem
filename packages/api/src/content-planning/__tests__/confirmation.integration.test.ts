import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPool, queryWithRLS } from '../../db/client.js'
import { listMemoryUsers, listWorkspaceMemoryGroups } from '../../db/memories.js'
import { postWorkingCopiesStore } from '../../db/post-working-copies.js'
import { executeFeedCommands, getFeedCollaboration, withFeedTransaction, type FeedActor } from '../../db/feed-collaboration-store.js'
import { confirmFeedPost, listFeedConfirmations } from '../confirmation.js'
import { createFeedLearningHandler, executeFeedLearningCommand, readFeedLearnedDecisions } from '../learning.js'
import { getFeedRun, markFeedDispatch, saveFeedPart, failFeedRun, retryFeedRun } from '../../db/feed-editorial-runs-store.js'
import { readFeedDecisionEvidence } from '../../decision-learning/evidence-reader.js'
import { feedApplicabilityKey, insertDecisionReflectedRules, prepareExplicitFeedRule, decidePlaybookRule } from '../../db/playbook-store.js'
import { loadDecisionPlaybookContext } from '../../decision-learning/playbook-context.js'
import { loadFeedReviewContext, recordFeedContextApplication } from '../review-context.js'
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/absent')
if (url.hostname !== '127.0.0.1' || url.pathname !== '/feed_draft_collaboration_acceptance') throw new Error('Feed confirmation tests require the isolated loopback acceptance database')
const pool = getPool(); const workspaces: string[] = []; const users: string[] = []
beforeAll(async () => { expect((await pool.query('SELECT current_database() AS name,host(inet_server_addr()) AS host')).rows[0]).toEqual({ name: 'feed_draft_collaboration_acceptance', host: '127.0.0.1' }) })
afterAll(async () => { for (const id of workspaces) await pool.query('DELETE FROM workspaces WHERE id=$1', [id]); for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id]); await pool.end() })
async function fixture() {
  const workspaceId = randomUUID(); const userId = randomUUID(); const otherId = randomUUID(); const assistantId = randomUUID(); const sessionId = randomUUID(); workspaces.push(workspaceId); users.push(userId, otherId)
  await pool.query("INSERT INTO users(id,auth_provider_id,name) VALUES($1::uuid,$1::text,'Author fixture'),($2::uuid,$2::text,'Editor fixture')", [userId, otherId])
  await pool.query("INSERT INTO workspaces(id,name,owner_user_id) VALUES($1,'Feed confirmation fixture',$2)", [workspaceId, userId])
  await pool.query("INSERT INTO workspace_members(workspace_id,user_id,role,can_draft) VALUES($1,$2,'owner',true),($1,$3,'member',true)", [workspaceId, userId, otherId])
  await pool.query("INSERT INTO assistants(id,name,workspace_id,owner_user_id,kind,app_type,clearance) VALUES($1,'Feed fixture',$2,$3,'app','distribution','internal')", [assistantId, workspaceId, userId])
  await postWorkingCopiesStore.put(assistantId, sessionId, userId, { revision: 0, mutationId: randomUUID(), create: { platform: 'threads' }, content: { title: 'Orchard fixture', privateBrief: 'Private editorial direction.', text: 'A concrete orchard example.', postFormat: 'post', threadSegments: [], article: { sourceUrl: '', title: '', description: '' }, media: [] } })
  const actor: FeedActor = { userId, assistantId, sessionId, kind: 'user' }; const other = { ...actor, userId: otherId }
  await executeFeedCommands(actor, { expectedRevision: 1, mutationId: randomUUID(), commands: [{ kind: 'upgrade' }] })
  const request = { expectedRevision: 2, mutationId: randomUUID(), locale: 'en' as const }
  return { actor, other, workspaceId, request }
}
async function running(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  await pool.query("UPDATE feed_editorial_runs SET status='running',lease_id=$2,lease_until=now()+interval '3 minutes',attempts=attempts+1 WHERE id=$1", [runId, randomUUID()])
  return getFeedRun(f.actor, runId)
}
async function sibling(f: Awaited<ReturnType<typeof fixture>>) {
  const sessionId = randomUUID()
  await postWorkingCopiesStore.put(f.actor.assistantId, sessionId, f.actor.userId, { revision: 0, mutationId: randomUUID(), create: { platform: 'threads' }, content: { title: 'Related orchard example', privateBrief: '', text: 'A related orchard example.', postFormat: 'post', threadSegments: [], article: { sourceUrl: '', title: '', description: '' }, media: [] } })
  const actor = { ...f.actor, sessionId }
  await executeFeedCommands(actor, { expectedRevision: 1, mutationId: randomUUID(), commands: [{ kind: 'upgrade' }] })
  return { ...f, actor, other: { ...f.other, sessionId }, request: { ...f.request, mutationId: randomUUID() } }
}
async function correction(f: Awaited<ReturnType<typeof fixture>>, count = 1) {
  const threadId = randomUUID()
  const startingRevision = (await getFeedCollaboration(f.actor)).copy!.revision
  await executeFeedCommands(f.actor, { expectedRevision: startingRevision, mutationId: randomUUID(), commands: [{ kind: 'comment', threadId, target: { kind: 'post' }, text: 'Use a concrete opening with an observable example.' }] })
  for (let i = 0; i < count; i++) {
    const copy = (await getFeedCollaboration(f.actor)).copy!
    const segment = copy.content.composition!.segments[0]!; const before = segment.content[0]!
    await executeFeedCommands(f.actor, { expectedRevision: copy.revision, mutationId: randomUUID(), commands: [{ kind: 'edit', reasonThreadId: threadId, edits: [{ kind: 'replaceBlock', segmentId: segment.id, blockId: before.attrs.id, preimage: before, replacement: [{ type: 'paragraph', attrs: { id: before.attrs.id }, content: [{ type: 'text', text: `The orchard has ${i + 2} rows of trees.` }] }] }] }] })
  }
  return confirmFeedPost(f.actor, { ...f.request, expectedRevision: startingRevision + count })
}
describe('[COMP:feed/confirmation-learning] atomic confirmation boundary', () => {
  it('scenarios 13 and 15: revoking a prior confirmation withdraws later summaries derived from its retained source', async () => {
    const f = await fixture(); const first = await correction(f)
    const handler = createFeedLearningHandler(async () => ({ model: 'fixture', tier: 'background', inputCharacters: 64000, maxTokens: 6000, providerKeySource: 'platform', call: async input => ({ text: JSON.stringify(JSON.parse(input.prompt).evidence ? { rules: [] } : { summary: 'The orchard choice has a retained source.', decisions: [], conflicts: [], unresolved: [] }) }) }))
    await handler(await running(f, first.runId), new AbortController().signal)
    const copy = (await getFeedCollaboration(f.actor)).copy!
    const segment = copy.content.composition!.segments[0]!; const block = segment.content[0]!
    await executeFeedCommands(f.actor, { expectedRevision: 3, mutationId: randomUUID(), commands: [{ kind: 'edit', edits: [{ kind: 'replaceBlock', segmentId: segment.id, blockId: block.attrs.id, preimage: block, replacement: [{ type: 'paragraph', attrs: { id: block.attrs.id }, content: [{ type: 'text', text: 'The same orchard now has four rows.' }] }] }] }] })
    const second = await confirmFeedPost(f.actor, { ...f.request, mutationId: randomUUID(), expectedRevision: 4 })
    await handler(await running(f, second.runId), new AbortController().signal)
    const memories = (await pool.query("SELECT memory_id FROM feed_learning_outputs WHERE session_id=$1 AND kind='summary'", [f.actor.sessionId])).rows.map(row => row.memory_id)
    expect(memories).toHaveLength(2)
    await executeFeedLearningCommand(f.actor, { mutationId: randomUUID(), expectedRevision: 4, confirmationId: first.confirmation.id, command: { action: 'revoke' } })
    expect((await pool.query('SELECT id FROM memories WHERE id=ANY($1::uuid[]) AND retracted_at IS NOT NULL', [memories])).rows).toHaveLength(2)
    expect((await pool.query("SELECT status FROM feed_learning_outputs WHERE session_id=$1 AND kind='summary'", [f.actor.sessionId])).rows.every(row => row.status === 'suppressed')).toBe(true)
    expect((await loadFeedReviewContext((await sibling(f)).actor)).dimensions.memory.sources.map(source => source.id).filter(id => memories.some(memory => id === `memory:${memory}`))).toEqual([])
  })
  it('scenarios 13-15: shared voice correction and forgetting keep native versions, authority, source links and suppression', async () => {
    const f = await fixture(); const confirmed = await correction(f)
    const synthesize = createFeedLearningHandler(async () => ({ model: 'fixture', tier: 'background', inputCharacters: 64000, maxTokens: 6000, providerKeySource: 'platform', call: async input => ({ text: JSON.stringify(JSON.parse(input.prompt).evidence ? { rules: [] } : { summary: 'The orchard opening was confirmed.', decisions: [], conflicts: [], unresolved: [] }) }) }))
    await synthesize(await running(f, confirmed.runId), new AbortController().signal)

    const act = (command: import('@use-brian/shared').FeedLearningCommand, actor = f.actor) => executeFeedLearningCommand(actor, { mutationId: randomUUID(), expectedRevision: 3, confirmationId: confirmed.confirmation.id, command })
    const learned = await act({ action: 'remember', rule: 'Use an observable example in the opening.' }); const ruleId = learned.artifactIds[0]!
    const promoted = await act({ action: 'scopeRule', ruleId, scope: 'brand_voice' }); const memoryId = promoted.artifactIds[0]!
    await expect(act({ action: 'editVoice', memoryId, summary: 'A member must not replace team voice.', detail: '' }, f.other)).rejects.toMatchObject({ code: 'team_voice_authority_required' })
    await expect(act({ action: 'retractSource', eventId: confirmed.confirmation.history.eventIds[0]! }, f.other)).rejects.toMatchObject({ code: 'learning_source_authority_required' })
    const privateRule = await act({ action: 'remember', rule: 'Keep my personal opening preference distinct.' })
    const other = await readFeedLearnedDecisions(f.other)
    expect(other.confirmations[0]!.artifacts.map(item => item.id)).toContain(memoryId)
    expect(other.confirmations[0]!.artifacts.map(item => item.id)).not.toContain(privateRule.artifactIds[0])
    expect(other.privateSourcesOmitted).toBe(true)
    expect(other.sources.every(source => !source.canRetract)).toBe(true)
    const edited = await act({ action: 'editVoice', memoryId, summary: 'Open with a measurable example, followed by its context.', detail: 'Keep the source and its limits visible.' }); const correctedId = edited.artifactIds[0]!
    expect(correctedId).not.toBe(memoryId)
    expect((await pool.query('SELECT superseded_by FROM memories WHERE id=$1', [memoryId])).rows[0].superseded_by).toBe(correctedId)
    const view = await readFeedLearnedDecisions(f.actor)
    expect(view.confirmations[0]!.artifacts.find(item => item.id === correctedId)).toMatchObject({ kind: 'voice', status: 'active', canEdit: true })
    expect(view.sources.some(source => source.canRetract && source.actorName === 'Author fixture')).toBe(true)
    expect((await pool.query("SELECT decision_event_id FROM decision_derivations WHERE artifact_kind='memory' AND artifact_id=$1", [correctedId])).rows.length).toBeGreaterThan(1)
    const wording = 'Open with a measurable example, followed by its context.'
    expect((await act({ action: 'remember', rule: wording })).artifactIds).toEqual([correctedId])
    await act({ action: 'scopeVoice', memoryId: correctedId, scope: 'post' })
    expect((await loadFeedReviewContext(f.actor)).dimensions.memory.coverage.limits).toContain('post_only_guidance_exception')
    await act({ action: 'forgetVoice', memoryId: correctedId })
    const candidate = { rule: wording, applicabilityKind: 'feed', applicabilityKey: feedApplicabilityKey(confirmed.confirmation.scope), sourceEventIds: confirmed.confirmation.history.eventIds, eligibility: 'activation' }
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.other.userId, workspaceId: f.workspaceId, feedScope: confirmed.confirmation.scope, proposals: [candidate] })).toMatchObject({ activated: 0, deduped: 1 })
    const next = await sibling(f)
    expect((await loadFeedReviewContext(next.actor)).dimensions.memory.sources.map(source => source.id)).not.toContain(`memory:${correctedId}`)
  })
  it('scenarios 12 and 15: explicit retry replaces only a known invalid response and completed learning never calls again', async () => {
    const f = await fixture(); const confirmed = await confirmFeedPost(f.actor, f.request)
    const call = vi.fn().mockResolvedValueOnce({ text: 'invalid JSON', usage: { inputTokens: 20 } }).mockResolvedValueOnce({ text: JSON.stringify({ summary: 'An orchard example was finalized.', decisions: [], conflicts: [], unresolved: [] }) })
    const resolve = vi.fn(async () => ({ model: 'fixture', tier: 'background' as const, inputCharacters: 64000, maxTokens: 6000, providerKeySource: 'platform' as const, call }))
    const handler = createFeedLearningHandler(resolve); const first = await running(f, confirmed.runId)
    await expect(handler(first, new AbortController().signal)).rejects.toMatchObject({ code: 'learning_invalid_model_result' })
    await failFeedRun(first, 'learning_invalid_model_result')
    expect(call).toHaveBeenCalledTimes(1)
    const retry = await retryFeedRun(f.actor, first.id)
    expect(retry.result.parts.summary).toBeUndefined()
    expect(retry.result.discardedParts).toEqual([expect.objectContaining({ part: 'summary', response: expect.objectContaining({ text: 'invalid JSON' }) })])
    await handler(await running(f, first.id), new AbortController().signal)
    await handler(await getFeedRun(f.actor, first.id), new AbortController().signal)
    expect(call).toHaveBeenCalledTimes(2); expect(resolve).toHaveBeenCalledTimes(2)
    expect((await pool.query("SELECT memory_id FROM feed_learning_outputs WHERE confirmation_id=$1 AND kind='summary'", [confirmed.confirmation.id])).rows).toEqual([{ memory_id: expect.any(String) }])
    const next = await sibling(f); const nextConfirmation = await confirmFeedPost(next.actor, next.request); const uncertain = await running(next, nextConfirmation.runId)
    await markFeedDispatch(uncertain, 'summary'); await failFeedRun(uncertain, 'provider_outcome_unknown')
    await expect(retryFeedRun(next.actor, uncertain.id)).rejects.toMatchObject({ code: 'fresh_explicit_attempt_required' })
    expect(call).toHaveBeenCalledTimes(2)
  })
  it('scenarios 13 and 15: source erasure removes current/old memory, promoted voice, history copies and saved model receipts', async () => {
    const f = await fixture(); const confirmed = await correction(f)
    const run = await running(f, confirmed.runId)
    await markFeedDispatch(run, 'summary')
    await saveFeedPart(run, 'summary', { text: JSON.stringify({ summary: 'A private orchard decision summary.', decisions: [], conflicts: [], unresolved: [] }) })
    const resolver = async () => ({ model: 'fixture-background', tier: 'background', inputCharacters: 64000, maxTokens: 6000, call: async () => ({ text: '{"rules":[]}' }) })
    await createFeedLearningHandler(resolver)(await getFeedRun(f.actor, run.id), new AbortController().signal)
    const before = (await pool.query('SELECT memory_id FROM feed_learning_outputs WHERE confirmation_id=$1 AND kind=\'summary\'', [confirmed.confirmation.id])).rows[0].memory_id
    await pool.query("INSERT INTO brain_row_versions(primitive,row_id,version_no,before_image,valid_from,valid_to,mutation_actor,workspace_id) VALUES('memory',$1,1,'{\"summary\":\"A private orchard decision summary.\"}',now(),now(),'human_edit',$2)", [before, f.workspaceId])
    const change = (command: import('@use-brian/shared').FeedLearningCommand) => executeFeedLearningCommand(f.actor, { expectedRevision: 3, mutationId: randomUUID(), confirmationId: confirmed.confirmation.id, command })
    await change({ action: 'editSummary', summary: 'A corrected private orchard summary.', detail: 'Updated historical explanation.' })
    const remembered = await change({ action: 'remember', rule: 'Use an observable orchard example in the opening.' })
    const ruleId = remembered.artifactIds[0]!
    await change({ action: 'scopeRule', ruleId, scope: 'brand_voice' })
    expect((await pool.query('SELECT id FROM memories WHERE source_session_id=$1', [f.actor.sessionId])).rows).toHaveLength(3)
    await pool.query('DELETE FROM session_messages WHERE id=$1', [confirmed.confirmation.history.messageIds[0]])
    expect(await listFeedConfirmations(f.actor)).toEqual([])
    expect((await pool.query('SELECT id FROM memories WHERE source_session_id=$1', [f.actor.sessionId])).rows).toEqual([])
    expect((await pool.query('SELECT before_image,erased_at FROM brain_row_versions WHERE row_id=$1', [before])).rows[0]).toEqual({ before_image: null, erased_at: expect.any(Date) })
    expect((await pool.query('SELECT rule,rationale,status,semantic_key,provenance FROM assistant_playbook_rules WHERE id=$1', [ruleId])).rows[0]).toEqual({ rule: '', rationale: null, status: 'retired', semantic_key: expect.any(String), provenance: { sourceErased: true } })
    expect((await getFeedRun(f.actor, run.id))).toMatchObject({ status: 'cancelled', error: 'learning_source_erased', result: { parts: {}, sourceErased: true }, context: { confirmationId: confirmed.confirmation.id }, request: { confirmationId: confirmed.confirmation.id } })
  })
  it('scenarios 12-15: typed Remember, post-only exception, promotion and replay preserve one active representation', async () => {
    const f = await fixture(); const confirmed = await confirmFeedPost(f.actor, f.request)
    const request = { mutationId: randomUUID(), expectedRevision: 2, confirmationId: confirmed.confirmation.id, command: { action: 'remember' as const, rule: 'Use one concrete example in each opening.' } }
    const first = await executeFeedLearningCommand(f.actor, request)
    expect(await executeFeedLearningCommand(f.actor, request)).toEqual(first)
    const ruleId = first.artifactIds[0]!
    await expect(executeFeedLearningCommand(f.other, request)).rejects.toMatchObject({ code: 'mutation_id_reused' })
    await expect(executeFeedLearningCommand({ ...f.actor, kind: 'assistant' }, { ...request, mutationId: randomUUID() })).rejects.toMatchObject({ code: 'member_decision_required' })
    const change = (command: import('@use-brian/shared').FeedLearningCommand) => executeFeedLearningCommand(f.actor, { ...request, mutationId: randomUUID(), command })
    await change({ action: 'scopeRule', ruleId, scope: 'post' })
    expect((await pool.query('SELECT status FROM assistant_playbook_rules WHERE id=$1', [ruleId])).rows[0].status).toBe('active')
    expect((await loadFeedReviewContext(f.actor)).dimensions.memory.coverage.limits).toContain('post_only_guidance_exception')
    const promoted = await change({ action: 'scopeRule', ruleId, scope: 'brand_voice' })
    expect((await pool.query('SELECT status FROM assistant_playbook_rules WHERE id=$1', [ruleId])).rows[0].status).toBe('retired')
    expect((await pool.query("SELECT id,user_id,sensitivity,tags FROM memories WHERE id=$1", [promoted.artifactIds[0]])).rows[0]).toMatchObject({ user_id: null, sensitivity: 'internal', tags: expect.arrayContaining(['voice', 'threads', 'feed-editorial-voice']) })
    await change({ action: 'scopeRule', ruleId, scope: 'brand_voice' })
    const repeated = await executeFeedLearningCommand(f.actor, { ...request, mutationId: randomUUID() })
    expect(repeated.artifactIds).toEqual(promoted.artifactIds)
    expect((await pool.query("SELECT id FROM memories WHERE assistant_id=$1 AND tags @> ARRAY['feed-editorial-voice']::text[] AND valid_to IS NULL", [f.actor.assistantId])).rows).toHaveLength(1)
    await expect(change({ action: 'decideRule', ruleId, decision: 'restore' })).rejects.toMatchObject({ code: 'learning_rule_promoted_to_voice' })
  })
  it('scenarios 12 and 15: typed revocation is atomic, idempotent and withdraws inferred rules whose supporting confirmation was reversed', async () => {
    const f = await fixture(); const confirmed = await correction(f)
    await correction(await sibling(f)); await correction(await sibling(f))
    const bundle = await readFeedDecisionEvidence({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, scope: confirmed.confirmation.scope })
    await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, workspaceId: f.workspaceId, feedScope: confirmed.confirmation.scope, proposals: [{ rule: 'Use concrete openings.', applicabilityKind: 'feed', applicabilityKey: feedApplicabilityKey(confirmed.confirmation.scope), sourceEventIds: bundle.evidence.flatMap(item => item.eventIds), eligibility: 'activation' }] })
    const request = { mutationId: randomUUID(), expectedRevision: 3, confirmationId: confirmed.confirmation.id, command: { action: 'revoke' as const } }
    const first = await executeFeedLearningCommand(f.actor, request)
    expect(await executeFeedLearningCommand(f.actor, request)).toEqual(first)
    expect((await listFeedConfirmations(f.actor))[0]).toMatchObject({ revoked: true, current: false })
    expect((await pool.query('SELECT status,evidence_count FROM assistant_playbook_rules WHERE assistant_id=$1', [f.actor.assistantId])).rows).toEqual([{ status: 'suggested', evidence_count: 2 }])
    expect((await pool.query("SELECT id FROM feed_editorial_runs WHERE session_id=$1 AND kind='reconcile'", [f.actor.sessionId])).rows).toHaveLength(1)
    await expect(confirmFeedPost(f.actor, { ...f.request, expectedRevision: 3 })).rejects.toMatchObject({ code: 'revoked_confirmation_requires_revision' })
    const resolver = vi.fn(async () => { throw new Error('Revoked evidence must not dispatch') })
    await expect(createFeedLearningHandler(resolver)(await getFeedRun(f.actor, confirmed.runId), new AbortController().signal)).rejects.toMatchObject({ code: 'confirmation_revoked' })
    expect(resolver).not.toHaveBeenCalled()
  })
  it('scenarios 13-15: explicit Remember uses native member approval, retirement and restore without inferred evidence or duplicate rules', async () => {
    const f = await fixture(); const confirmed = await confirmFeedPost(f.actor, f.request)
    const prepare = (client: import('pg').PoolClient) => prepareExplicitFeedRule({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, rule: 'Use concrete examples in future Threads openings.', scope: confirmed.confirmation.scope }, client)
    await expect(withFeedTransaction(f.actor, async client => { await prepare(client); throw new Error('rollback explicit instruction') })).rejects.toThrow('rollback explicit instruction')
    expect((await pool.query('SELECT id FROM assistant_playbook_rules WHERE assistant_id=$1', [f.actor.assistantId])).rows).toEqual([])
    const rule = await withFeedTransaction(f.actor, async client => {
      const prepared = await prepare(client)
      expect(prepared.status).toBe('suggested'); expect(prepared.evidenceCount).toBe(0)
      const active = await decidePlaybookRule({ assistantId: f.actor.assistantId, ruleId: prepared.id, decision: 'approve', userId: f.actor.userId, workspaceId: f.workspaceId, isAssistantOwner: false, mutationId: randomUUID() }, client)
      expect(active).toMatchObject({ id: prepared.id, status: 'active' }); return prepared
    })
    const args = { assistantId: f.actor.assistantId, ruleId: rule.id, userId: f.actor.userId, workspaceId: f.workspaceId, isAssistantOwner: true }
    expect(await decidePlaybookRule({ ...args, userId: f.other.userId, decision: 'retire' })).toBe('forbidden')
    expect(await decidePlaybookRule({ ...args, decision: 'retire' })).toMatchObject({ status: 'retired' })
    expect((await withFeedTransaction(f.actor, prepare)).id).toBe(rule.id)
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, workspaceId: f.workspaceId, feedScope: confirmed.confirmation.scope, proposals: [{ rule: rule.rule, applicabilityKind: 'feed', applicabilityKey: feedApplicabilityKey(confirmed.confirmation.scope), sourceEventIds: [randomUUID()], eligibility: 'activation' }] })).toMatchObject({ deduped: 1, activated: 0 })
    expect(await decidePlaybookRule({ ...args, decision: 'restore', mutationId: randomUUID() })).toMatchObject({ id: rule.id, status: 'active' })
    expect((await pool.query('SELECT id FROM assistant_playbook_rules WHERE assistant_id=$1', [f.actor.assistantId])).rows).toEqual([{ id: rule.id }])
    expect((await pool.query("SELECT payload->>'decision' AS decision FROM decision_events WHERE source_id=$1 ORDER BY created_at", [rule.id])).rows.map(row => row.decision)).toEqual(['approve', 'retire', 'restore'])
  })
  it('scenarios 13-15: native evidence coalesces one post, activates across distinct posts, keeps actor scope and records exact applications', async () => {
    const f = await fixture(); const first = await correction(f, 3)
    const scope = first.confirmation.scope
    const proposal = async () => {
      const bundle = await readFeedDecisionEvidence({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, scope })
      return { bundle, rule: { rule: 'Open Threads posts with a concrete observable example.', applicabilityKind: 'feed', applicabilityKey: feedApplicabilityKey(scope), eligibility: 'activation', sourceEventIds: bundle.evidence.flatMap(item => item.eventIds) } }
    }
    const one = await proposal()
    expect(one.bundle.evidence).toHaveLength(1); expect(one.rule.sourceEventIds).toHaveLength(3)
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, workspaceId: f.workspaceId, feedScope: scope, proposals: [one.rule] })).toMatchObject({ suggested: 1, activated: 0 })
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.other.userId, workspaceId: f.workspaceId, feedScope: scope, proposals: [one.rule] })).toMatchObject({ rejected: 1 })
    await correction(await sibling(f))
    const two = await proposal()
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, workspaceId: f.workspaceId, feedScope: scope, proposals: [two.rule] })).toMatchObject({ activated: 0 })
    await correction(await sibling(f))
    const three = await proposal()
    expect(await insertDecisionReflectedRules({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, workspaceId: f.workspaceId, feedScope: scope, proposals: [three.rule] })).toMatchObject({ activated: 1 })
    const rules = (await pool.query('SELECT id,status,evidence_count,applies_to_user_id,decision_sensitivity FROM assistant_playbook_rules WHERE assistant_id=$1', [f.actor.assistantId])).rows
    expect(rules).toEqual([expect.objectContaining({ status: 'active', evidence_count: 3, applies_to_user_id: f.actor.userId, decision_sensitivity: 'internal' })])
    const params = { workspaceId: f.workspaceId, assistantId: f.actor.assistantId, actorUserId: f.actor.userId, externalPrincipal: false, operationKind: 'feed_generation', operationId: randomUUID(), sourceKind: 'feed_session', sourceId: f.actor.sessionId, logLabel: 'feed-fixture' }
    const applied = await loadDecisionPlaybookContext({ ...params, applicability: { kind: 'feed', scope } })
    expect(applied.appliedRuleIds).toEqual([rules[0].id]); expect(applied.decisionApplicationId).toBeTruthy()
    expect((await pool.query('SELECT artifact_refs FROM decision_applications WHERE id=$1', [applied.decisionApplicationId])).rows[0].artifact_refs).toEqual([{ kind: 'assistant_playbook_rule', id: rules[0].id }])
    for (const mismatch of [{ platform: 'linkedin' }, { postFormat: 'article' as const }, { sensitivity: 'public' as const }, { brandId: randomUUID() }]) expect((await loadDecisionPlaybookContext({ ...params, applicability: { kind: 'feed', scope: { ...scope, ...mismatch } } })).appliedRuleIds).toEqual([])
    expect((await loadDecisionPlaybookContext({ ...params, actorUserId: f.other.userId, applicability: { kind: 'feed', scope } })).appliedRuleIds).toEqual([])
    expect((await loadDecisionPlaybookContext(params)).appliedRuleIds).toEqual([])
  })
  it('scenarios 12-13: repairs a persisted model receipt and the native memory/output atomically; completed replay makes zero model calls', async () => {
    const f = await fixture(); const confirmed = await confirmFeedPost(f.actor, f.request)
    const run = await running(f, confirmed.runId)
    await markFeedDispatch(run, 'summary')
    await saveFeedPart(run, 'summary', { text: JSON.stringify({ summary: 'The orchard example was confirmed with no reusable lesson.', decisions: [], conflicts: [], unresolved: [] }) }, { inputTokens: 200, outputTokens: 30 })
    const resolver = vi.fn(async () => { throw new Error('A known response must never call a provider again') })
    const handler = createFeedLearningHandler(resolver)
    await handler(await getFeedRun(f.actor, run.id), new AbortController().signal)
    const first = (await pool.query("SELECT o.memory_id,m.summary,m.sensitivity,m.user_id,m.tags,m.detail FROM feed_learning_outputs o JOIN memories m ON m.id=o.memory_id WHERE o.confirmation_id=$1 AND o.kind='summary'", [confirmed.confirmation.id])).rows
    expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ sensitivity: 'internal', user_id: null, summary: 'The orchard example was confirmed with no reusable lesson.' })
    expect((await listMemoryUsers()).every(row => row.userId !== null)).toBe(true)
    expect(await listWorkspaceMemoryGroups()).toContainEqual({ assistantId: f.actor.assistantId, workspaceId: f.workspaceId })
    expect(first[0].tags).toContain('feed-post-decision'); expect(first[0].tags).not.toContain('voice')
    // Crash after the native memory transaction, before final run bookkeeping.
    await pool.query("UPDATE feed_editorial_runs SET result=result-'learningComplete' WHERE id=$1", [run.id])
    await handler(await running(f, run.id), new AbortController().signal)
    await handler(await getFeedRun(f.actor, run.id), new AbortController().signal)
    expect(resolver).not.toHaveBeenCalled()
    expect((await pool.query('SELECT id FROM memories WHERE source_session_id=$1', [f.actor.sessionId])).rows.map(row => row.id)).toEqual([first[0].memory_id])
    expect((await pool.query('SELECT id FROM feed_learning_outputs WHERE confirmation_id=$1', [confirmed.confirmation.id])).rows).toHaveLength(1)
    expect((await pool.query('SELECT id FROM assistant_playbook_rules WHERE assistant_id=$1', [f.actor.assistantId])).rows).toHaveLength(0)
    expect((await getFeedRun(f.actor, run.id)).status).toBe('succeeded')
    const next = await sibling(f)
    const context = await loadFeedReviewContext(next.actor)
    expect(context.dimensions.memory.sources.map(source => source.id)).toContain(`memory:${first[0].memory_id}`)
    const messageId = randomUUID()
    await pool.query("INSERT INTO session_messages(id,session_id,role,content,sequence_num,sender_user_id) VALUES($1,$2,'user','[]',1,$3)", [messageId, next.actor.sessionId, next.actor.userId])
    const applicationId = await recordFeedContextApplication(next.actor, next.workspaceId, 'feed_chat', messageId, context.dimensions.memory.sources, context.learningScope)
    expect((await pool.query('SELECT artifact_refs FROM decision_applications WHERE id=$1', [applicationId])).rows[0].artifact_refs).toContainEqual({ kind: 'memory', id: first[0].memory_id })
    const block = (await getFeedCollaboration(next.actor)).copy!.content.composition!.segments[0]!
    const suggestionId = randomUUID()
    await executeFeedCommands({ ...next.actor, kind: 'assistant' }, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'propose', suggestionId, applicationId: applicationId!, edits: [{ kind: 'replaceBlock', segmentId: block.id, blockId: block.content[0]!.attrs.id, preimage: block.content[0]!, replacement: [{ type: 'paragraph', attrs: { id: block.content[0]!.attrs.id }, content: [{ type: 'text', text: 'The next orchard has three rows.' }] }] }], rationale: 'Apply the referenced prior example as historical context.' }] })
    expect((await getFeedCollaboration(next.actor)).suggestions[0]!.applicationId).toBe(applicationId)
    await executeFeedCommands(next.actor, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'decide', suggestionId, outcome: 'accepted' }] })
    expect((await pool.query("SELECT d.relation FROM decision_derivations d JOIN decision_events e ON e.id=d.decision_event_id WHERE e.caused_by_application_id=$1", [applicationId])).rows).toEqual([])
    await executeFeedCommands(next.actor, { expectedRevision: 3, mutationId: randomUUID(), commands: [{ kind: 'undo', revision: 3 }] })
    expect((await pool.query("SELECT d.relation,d.artifact_id FROM decision_derivations d JOIN decision_events e ON e.id=d.decision_event_id WHERE e.caused_by_application_id=$1", [applicationId])).rows).toEqual([{ relation: 'invalidates', artifact_id: first[0].memory_id }])

    const summaryScope = async (scope: 'post' | 'future') => executeFeedLearningCommand(f.actor, { expectedRevision: 2, mutationId: randomUUID(), confirmationId: confirmed.confirmation.id, command: { action: 'scopeSummary', scope } })
    const narrowed = await summaryScope('post')
    expect((await loadFeedReviewContext(f.actor)).dimensions.memory.sources.map(source => source.id)).toContain(`memory:${narrowed.artifactIds[0]}`)
    expect((await loadFeedReviewContext(next.actor)).dimensions.memory.sources.map(source => source.id)).not.toContain(`memory:${narrowed.artifactIds[0]}`)
    expect((await readFeedLearnedDecisions(f.actor)).confirmations[0]!.summary).toMatchObject({ postOnly: true })
    const restored = await summaryScope('future')
    expect((await loadFeedReviewContext(next.actor)).dimensions.memory.sources.map(source => source.id)).toContain(`memory:${restored.artifactIds[0]}`)

    await pool.query("UPDATE sessions SET title='[linkedin] Related example' WHERE id=$1", [next.actor.sessionId])
    expect((await loadFeedReviewContext(next.actor)).dimensions.memory.sources.map(source => source.id)).not.toContain(`memory:${first[0].memory_id}`)
    const edit = { expectedRevision: 2, mutationId: randomUUID(), confirmationId: confirmed.confirmation.id, command: { action: 'editSummary' as const, summary: 'A corrected historical orchard outcome.', detail: 'This was a post-specific choice, with no standing instruction.' } }
    const corrected = await executeFeedLearningCommand(f.actor, edit)
    expect(await executeFeedLearningCommand(f.actor, edit)).toEqual(corrected)
    const currentMemory = corrected.artifactIds[0]!
    expect(currentMemory).not.toBe(first[0].memory_id)
    expect((await pool.query('SELECT valid_to FROM memories WHERE id=$1', [first[0].memory_id])).rows[0].valid_to).toBeTruthy()
    expect((await pool.query('SELECT memory_id FROM feed_learning_outputs WHERE confirmation_id=$1', [confirmed.confirmation.id])).rows[0].memory_id).toBe(currentMemory)
    const forget = { ...edit, mutationId: randomUUID(), command: { action: 'forgetSummary' as const } }
    const forgotten = await executeFeedLearningCommand(f.actor, forget)
    expect(await executeFeedLearningCommand(f.actor, forget)).toEqual(forgotten)
    expect((await pool.query('SELECT retracted_at,valid_to FROM memories WHERE id=$1', [currentMemory])).rows[0]).toEqual({ retracted_at: expect.any(Date), valid_to: expect.any(Date) })
    expect((await pool.query('SELECT status FROM feed_learning_outputs WHERE confirmation_id=$1', [confirmed.confirmation.id])).rows[0].status).toBe('suppressed')
    await expect(handler(await getFeedRun(f.actor, run.id), new AbortController().signal)).rejects.toMatchObject({ code: 'learning_suppressed' })
    expect(resolver).not.toHaveBeenCalled()
  })
  it('scenarios 12-14: ordinary synthesis calls each model stage once and preserves the linked goal and actual author', async () => {
    const f = await fixture()
    const goal = (await pool.query(`INSERT INTO goals(workspace_id,outcome,done_when,created_by_user_id) VALUES($1,'Explain observable orchard improvements','{"kind":"subtasks"}',$2) RETURNING id`, [f.workspaceId, f.actor.userId])).rows[0].id
    await executeFeedCommands(f.actor, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'context', goalId: goal }] })
    const first = await correction(f)
    await pool.query("UPDATE goals SET outcome='Later goal revision' WHERE id=$1", [goal])
    const call = vi.fn(async ({ prompt }: { prompt: string }) => {
      const input = JSON.parse(prompt)
      if ('evidence' in input) return { text: JSON.stringify({ rules: [] }), usage: { inputTokens: 100, outputTokens: 10 } }
      expect(input.sources.find((source: { kind: string }) => source.kind === 'goal').body).toContain('Explain observable orchard improvements')
      expect(JSON.stringify(input)).not.toContain('Later goal revision')
      const human = input.sources.find((source: { kind: string }) => source.kind === 'decision')
      return { text: JSON.stringify({ summary: 'The author chose an observable orchard example.', decisions: [{ statement: 'A human revision made the opening concrete.', actorUserId: f.actor.userId, outcome: 'revised', sourceIds: [human.id] }], conflicts: [], unresolved: [] }), usage: { inputTokens: 300, outputTokens: 50 } }
    })
    const resolve = vi.fn(async () => ({ model: 'fixture-background', tier: 'background', inputCharacters: 64000, maxTokens: 6000, call }))
    const handler = createFeedLearningHandler(resolve)
    await handler(await running(f, first.runId), new AbortController().signal)
    expect(call).toHaveBeenCalledTimes(2) // one summary and one actor reflection
    const row = (await pool.query("SELECT detail FROM memories WHERE source_session_id=$1", [f.actor.sessionId])).rows[0]
    expect(JSON.parse(row.detail).decisions[0].actorUserId).toBe(f.actor.userId)
    await handler(await getFeedRun(f.actor, first.runId), new AbortController().signal)
    expect(call).toHaveBeenCalledTimes(2); expect(resolve).toHaveBeenCalledTimes(2)
  })
  it('scenario 15: changed or erased source text cannot be synthesized from a stale confirmation', async () => {
    const f = await fixture(); const confirmed = await correction(f)
    await pool.query("UPDATE session_messages SET content='[{\"type\":\"text\",\"text\":\"Changed after confirmation.\"}]' WHERE id=$1", [confirmed.confirmation.history.messageIds[0]])
    const resolver = vi.fn(async () => { throw new Error('Changed evidence must not reach a model') })
    await expect(createFeedLearningHandler(resolver)(await running(f, confirmed.runId), new AbortController().signal)).rejects.toMatchObject({ code: 'learning_sources_changed' })
    expect((await readFeedDecisionEvidence({ assistantId: f.actor.assistantId, actorUserId: f.actor.userId, scope: confirmed.confirmation.scope })).evidence).toEqual([])
    await pool.query('DELETE FROM session_messages WHERE id=$1', [confirmed.confirmation.history.messageIds[0]])
    await expect(createFeedLearningHandler(resolver)(await getFeedRun(f.actor, confirmed.runId), new AbortController().signal)).rejects.toMatchObject({ code: 'confirmation_not_found' })
    expect((await getFeedRun(f.actor, confirmed.runId)).result).toEqual({ parts: {}, sourceErased: true })
    expect(resolver).not.toHaveBeenCalled()
  })
  it('scenario 14: checks the distribution assistant clearance again before reading private history or calling the model', async () => {
    const f = await fixture(); const confirmed = await confirmFeedPost(f.actor, f.request)
    await pool.query("UPDATE assistants SET clearance='public' WHERE id=$1", [f.actor.assistantId])
    const resolver = vi.fn(async () => { throw new Error('Private history must not reach a public assistant') })
    await expect(createFeedLearningHandler(resolver)(await running(f, confirmed.runId), new AbortController().signal)).rejects.toMatchObject({ code: 'learning_context_not_available' })
    expect(resolver).not.toHaveBeenCalled()
    expect((await pool.query('SELECT id FROM memories WHERE source_session_id=$1', [f.actor.sessionId])).rows).toHaveLength(0)
  })
  it('scenario 12: commits snapshot, event, output identity and outbox together; retries and two approvers share one revision', async () => {
    const f = await fixture()
    await expect(withFeedTransaction(f.actor, async (client, scope) => { await confirmFeedPost(f.actor, f.request, { transaction: { client, scope } }); throw new Error('fixture rollback') })).rejects.toThrow('fixture rollback')
    for (const table of ['feed_post_confirmations', 'feed_learning_outputs', 'feed_editorial_runs', 'decision_events']) expect((await pool.query(`SELECT id FROM ${table} WHERE session_id=$1`, [f.actor.sessionId])).rows).toHaveLength(0)
    const [first, concurrent] = await Promise.all([confirmFeedPost(f.actor, f.request), confirmFeedPost(f.other, { ...f.request, mutationId: randomUUID() })])
    expect(first.confirmation.id).toBe(concurrent.confirmation.id); expect(first.runId).toBe(concurrent.runId)
    const replay = await confirmFeedPost(f.actor, f.request); expect(replay.confirmation.id).toBe(first.confirmation.id)
    for (const table of ['feed_post_confirmations', 'feed_learning_outputs', 'feed_editorial_runs', 'decision_events']) expect((await pool.query(`SELECT id FROM ${table} WHERE session_id=$1`, [f.actor.sessionId])).rows).toHaveLength(1)
    expect(first.confirmation.projection.text).toBe('A concrete orchard example.'); expect(JSON.stringify(first.confirmation.projection)).not.toContain('Private editorial')
    const event = (await pool.query('SELECT payload FROM decision_events WHERE session_id=$1', [f.actor.sessionId])).rows[0]
    expect(event.payload).toMatchObject({ confirmationId: first.confirmation.id, revision: 2 }); expect(JSON.stringify(event.payload)).not.toContain('orchard')
    await expect(pool.query("UPDATE feed_post_confirmations SET content='{}' WHERE id=$1", [first.confirmation.id])).rejects.toThrow('append-only')
    expect(await listFeedConfirmations(f.actor)).toEqual([expect.objectContaining({ id: first.confirmation.id, current: true, revoked: false })])
  })
  it('scenarios 7-8 and 12: refuses unfinished/stale work, ID reuse, foreign scope and replay after access revocation', async () => {
    const f = await fixture(); const foreign = await fixture()
    await expect(confirmFeedPost(f.actor, { ...f.request, expectedRevision: 1 })).rejects.toMatchObject({ code: 'revision_conflict' })
    const content = (await getFeedCollaboration(f.actor)).copy!.content.composition!
    const segment = content.segments[0]!
    await executeFeedCommands(f.actor, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'edit', edits: [{ kind: 'insertBlock', segmentId: segment.id, afterId: segment.content[0]!.attrs.id, node: { type: 'generationPlaceholder', attrs: { id: randomUUID(), kind: 'text', brief: 'Missing evidence.', briefRevision: 0, references: [] } } }] }] })
    await expect(confirmFeedPost(f.actor, { ...f.request, expectedRevision: 3 })).rejects.toMatchObject({ code: 'unfinished_slot' })
    expect((await pool.query('SELECT id FROM feed_post_confirmations WHERE session_id=$1', [f.actor.sessionId])).rows).toHaveLength(0)
    const confirmed = await confirmFeedPost(foreign.actor, foreign.request)
    await expect(confirmFeedPost(foreign.other, foreign.request)).rejects.toMatchObject({ code: 'mutation_id_reused' })
    await expect(confirmFeedPost(foreign.actor, { ...foreign.request, locale: 'ja' })).rejects.toMatchObject({ code: 'mutation_id_reused' })
    expect((await queryWithRLS(f.actor.userId, 'SELECT id FROM feed_post_confirmations WHERE id=$1', [confirmed.confirmation.id])).rows).toHaveLength(0)
    expect((await queryWithRLS(foreign.actor.userId, 'SELECT id FROM feed_post_confirmations WHERE id=$1', [confirmed.confirmation.id])).rows).toHaveLength(1)
    await pool.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [foreign.workspaceId, foreign.actor.userId])
    await expect(confirmFeedPost(foreign.actor, foreign.request)).rejects.toMatchObject({ code: 'draft_access_required' })
  })
  it('scenarios 11 and 13: freezes reference membership/outcomes at the cutoff and links a later changed confirmation', async () => {
    const f = await fixture(); const threadId = randomUUID(); const suggestionId = randomUUID()
    const content = (await getFeedCollaboration(f.actor)).copy!.content.composition!; const segment = content.segments[0]!
    await executeFeedCommands({ ...f.actor, kind: 'assistant' }, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'propose', suggestionId, edits: [{ kind: 'replaceBlock', segmentId: segment.id, blockId: segment.content[0]!.attrs.id, preimage: segment.content[0]!, replacement: [{ type: 'paragraph', attrs: { id: segment.content[0]!.attrs.id }, content: [{ type: 'text', text: 'An alternative example.' }] }] }], rationale: 'Alternative opening.' }] })
    await executeFeedCommands(f.other, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'comment', threadId, target: { kind: 'post' }, text: 'Keep the concrete orchard example for this post.' }] })
    const first = await confirmFeedPost(f.actor, f.request)
    expect(first.confirmation.history.proposals).toEqual([expect.objectContaining({ id: suggestionId, status: 'proposed' })]); expect(first.confirmation.history.messageIds).toHaveLength(1)
    await executeFeedCommands(f.other, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'reply', threadId, text: 'A later discussion.' }, { kind: 'decide', suggestionId, outcome: 'rejected', reasonThreadId: threadId }] })
    expect((await confirmFeedPost(f.actor, f.request)).confirmation.history).toEqual(first.confirmation.history)
    await executeFeedCommands(f.actor, { expectedRevision: 2, mutationId: randomUUID(), commands: [{ kind: 'context', title: 'Revised orchard title' }] })
    const next = await confirmFeedPost(f.actor, { ...f.request, mutationId: randomUUID(), expectedRevision: 3 })
    expect(next.confirmation.priorConfirmationId).toBe(first.confirmation.id); expect(next.confirmation.history.proposals[0]!.status).toBe('rejected'); expect(next.confirmation.history.messageIds).toHaveLength(2)
    expect((await listFeedConfirmations(f.actor)).map(row => row.current)).toEqual([true, false])
  })
})
