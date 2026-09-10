import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FeedCommand, FeedCommandRequest, FeedEdit } from '@use-brian/shared'
import { feedParagraph, projectFeed, sliceFeedInline } from '@use-brian/doc-model'
import { getPool } from '../../db/client.js'
import { executeFeedCommands, getFeedCollaboration, getFeedThreadMessages, type FeedActor, type StructuredFeedContent } from '../../db/feed-collaboration-store.js'
import { postWorkingCopiesStore, type PostWorkingContent } from '../../db/post-working-copies.js'

// Deliberately no skip: this is the phase barrier, not a mocked substitute.
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/absent')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/feed_draft_collaboration_acceptance') throw new Error('Feed integration requires its isolated loopback acceptance database')
const pool = getPool(); const createdWorkspaces: string[] = []; const users: string[] = []
beforeAll(async () => {
  const row = (await pool.query('SELECT inet_server_addr()::text AS address,current_database() AS name')).rows[0]
  expect(['127.0.0.1/32', '127.0.0.1', '::1/128', '::1']).toContain(row.address)
  expect(row.name).toBe('feed_draft_collaboration_acceptance')
})
afterAll(async () => {
  for (const id of createdWorkspaces) await pool.query('DELETE FROM workspaces WHERE id=$1', [id])
  for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id])
  await pool.end()
})
async function fixture(text = 'First paragraph.\n\nThe same phrase.\n\nThe same phrase.') {
  const workspaceId = randomUUID(); const userId = randomUUID(); const otherId = randomUUID(); const assistantId = randomUUID(); const sessionId = randomUUID()
  createdWorkspaces.push(workspaceId); users.push(userId, otherId)
  await pool.query('INSERT INTO users(id,auth_provider_id,name) VALUES($1::uuid,$1::text,\'Author fixture\'),($2::uuid,$2::text,\'Editor fixture\')', [userId, otherId])
  await pool.query("INSERT INTO workspaces(id,name,owner_user_id) VALUES($1,'Feed fixture',$2)", [workspaceId, userId])
  await pool.query("INSERT INTO workspace_members(workspace_id,user_id,role,can_draft) VALUES($1,$2,'owner',true),($1,$3,'member',true)", [workspaceId, userId, otherId])
  await pool.query("INSERT INTO assistants(id,name,workspace_id,owner_user_id,kind,app_type,clearance) VALUES($1,'Feed fixture',$2,$3,'app','distribution','internal')", [assistantId, workspaceId, userId])
  const actor: FeedActor = { userId, assistantId, sessionId, kind: 'user' }; const other = { ...actor, userId: otherId }
  const content: PostWorkingContent = { title: 'Fixture draft', privateBrief: 'Private direction', text, postFormat: 'post', threadSegments: [], article: { sourceUrl: '', title: '', description: '' }, media: [] }
  await postWorkingCopiesStore.put(assistantId, sessionId, userId, { revision: 0, mutationId: randomUUID(), create: { platform: 'threads' }, content })
  const command = async (commands: FeedCommand[], expectedRevision?: number, who = actor, mutationId = randomUUID()) => executeFeedCommands(who, { commands, expectedRevision: expectedRevision ?? (await getFeedCollaboration(actor)).copy!.revision, mutationId })
  const upgrade = async () => { await command([{ kind: 'upgrade' }], 1); return (await getFeedCollaboration(actor)).copy!.content as StructuredFeedContent }
  return { workspaceId, actor, other, command, upgrade, content }
}
function replace(content: StructuredFeedContent, block: number, text: string): FeedEdit {
  const segment = content.composition.segments[0]!; const node = segment.content[block]!
  if (node.type !== 'paragraph' && node.type !== 'heading') throw new Error('text required')
  const length = (node.content ?? []).reduce((n, item) => n + (item.type === 'text' ? item.text.length : 1), 0)
  return { kind: 'replaceText', spans: [{ segmentId: segment.id, blockId: node.attrs.id, from: 0, to: length }], preimage: [sliceFeedInline(node.content ?? [], 0, length)], replacement: [[{ type: 'text', text }]] }
}
describe('[COMP:feed/draft-comments] PostgreSQL command and anchor barrier', () => {
  it('scenarios 2 and 9: upgrades losslessly and stores the legacy snapshot without stripping old-client retries', async () => {
    const f = await fixture('  **Bold** 中文\n\n[unfinished gap]\n'); const structured = await f.upgrade()
    expect(projectFeed(structured.composition).text).toBe(f.content.text)
    const snapshot = await getFeedCollaboration(f.actor)
    expect(snapshot.copy!.revision).toBe(2)
    const old = (await pool.query('SELECT content FROM feed_post_revisions WHERE session_id=$1 AND revision=1', [f.actor.sessionId])).rows[0]
    expect(old.content).toEqual(f.content)
    await expect(postWorkingCopiesStore.put(f.actor.assistantId, f.actor.sessionId, f.actor.userId, { revision: 2, mutationId: snapshot.copy!.mutationId, content: f.content })).rejects.toMatchObject({ status: 409 })
    expect((await getFeedCollaboration(f.actor)).copy!.content).toEqual(structured)
    await expect(pool.query('UPDATE feed_post_working_copies SET content=$2 WHERE session_id=$1', [f.actor.sessionId, JSON.stringify(f.content)])).rejects.toThrow('typed commands')
  })
  it('scenarios 1 and 2: threads use attributed Feed transcripts and discussion does not invalidate content', async () => {
    const f = await fixture(); const content = await f.upgrade(); const segment = content.composition.segments[0]!; const threadId = randomUUID()
    const anchor = { kind: 'range' as const, spans: [{ segmentId: segment.id, blockId: segment.content[2]!.attrs.id, from: 4, to: 15 }] }
    const receipt = await f.command([{ kind: 'comment', threadId, target: anchor, text: 'Make the second example precise.' }], 2)
    expect(receipt.revision).toBe(2)
    await f.command([{ kind: 'reply', threadId, text: 'Agreed, keep the first example.' }], 2, f.other)
    await f.command([{ kind: 'resolve', threadId, resolved: true }, { kind: 'resolve', threadId, resolved: false }], 2)
    const messages = await getFeedThreadMessages(f.actor, threadId)
    expect(messages.map(m => m.senderUserId)).toEqual([f.actor.userId, f.other.userId])
    const before = await getFeedCollaboration(f.actor)
    const session = (await pool.query('SELECT mode,channel_type FROM sessions WHERE id=$1', [before.threads[0]!.transcriptSessionId])).rows[0]
    expect(session).toEqual({ mode: null, channel_type: 'feed_thread' })
    await f.command([{ kind: 'edit', edits: [{ kind: 'moveBlock', segmentId: segment.id, blockId: segment.content[2]!.attrs.id, afterId: null }] }], 2)
    expect((await getFeedCollaboration(f.actor)).threads[0]!.anchor).toEqual(before.threads[0]!.anchor)
  })

  it('scenario 7: retains old receipts, rejects ID reuse and refuses denied replay after revocation', async () => {
    const f = await fixture(); const content = await f.upgrade(); const request: FeedCommandRequest = { mutationId: randomUUID(), expectedRevision: 2, commands: [{ kind: 'edit', edits: [replace(content, 0, 'Saved once.')] }] }
    const original = await executeFeedCommands(f.other, request)
    await f.command([{ kind: 'comment', threadId: randomUUID(), target: { kind: 'post' }, text: 'An intervening discussion.' }], 3)
    expect(await executeFeedCommands(f.other, request)).toEqual(original)
    await expect(executeFeedCommands(f.actor, request)).rejects.toMatchObject({ code: 'mutation_id_reused' })
    await expect(executeFeedCommands(f.other, { ...request, commands: [{ kind: 'upgrade' }] })).rejects.toMatchObject({ code: 'mutation_id_reused' })
    await pool.query('UPDATE workspace_members SET can_draft=false WHERE workspace_id=$1 AND user_id=$2', [f.workspaceId, f.other.userId])
    await expect(executeFeedCommands(f.other, request)).rejects.toMatchObject({ status: 403 })
  })
  it('scenarios 6 and 7: rolls back content, anchors, transcript, journal and receipt as one compound command', async () => {
    const f = await fixture(); const content = await f.upgrade(); const mutationId = randomUUID(); const threadId = randomUUID()
    await expect(f.command([{ kind: 'comment', threadId, target: { kind: 'post' }, text: 'Must roll back.' }, { kind: 'edit', edits: [replace(content, 0, 'Must roll back too.')] }, { kind: 'reply', threadId: randomUUID(), text: 'Unknown target.' }], 2, f.actor, mutationId)).rejects.toMatchObject({ status: 404 })
    const snapshot = await getFeedCollaboration(f.actor)
    expect(snapshot.copy!.revision).toBe(2); expect(snapshot.copy!.content).toEqual(content); expect(snapshot.threads).toHaveLength(0)
    expect((await pool.query('SELECT id FROM decision_events WHERE session_id=$1', [f.actor.sessionId])).rowCount).toBe(0)
    expect((await pool.query('SELECT mutation_id FROM feed_collaboration_mutations WHERE session_id=$1 AND mutation_id=$2', [f.actor.sessionId, mutationId])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM sessions WHERE channel_id=$1', [`feed-thread:${threadId}`])).rowCount).toBe(0)
  })
  it('scenario 7: rejects cross-workspace/session scope at the service and SQL boundaries', async () => {
    const f = await fixture(); const foreign = await fixture(); await f.upgrade(); const otherContent = await foreign.upgrade(); const threadId = randomUUID()
    await foreign.command([{ kind: 'comment', threadId, target: { kind: 'post' }, text: 'Other workspace.' }], 2)
    await expect(getFeedCollaboration({ ...f.actor, sessionId: foreign.actor.sessionId })).rejects.toMatchObject({ status: 404 })
    await expect(f.command([{ kind: 'reply', threadId, text: 'Not permitted.' }], 2)).rejects.toMatchObject({ status: 404 })
    await expect(f.command([{ kind: 'edit', edits: [replace(otherContent, 0, 'Wrong session.')] }], 2)).rejects.toMatchObject({ code: 'invalid_target' })
    await expect(pool.query(`INSERT INTO feed_collaboration_mutations(session_id,mutation_id,workspace_id,assistant_id,actor_user_id,actor_kind,fingerprint,command_kind,receipt) VALUES($1,$2,$3,$4,$5,'user','fake','edit','{}')`, [f.actor.sessionId, randomUUID(), foreign.workspaceId, f.actor.assistantId, f.actor.userId])).rejects.toThrow('scope mismatch')
  })
  it('scenario 7: refuses private/inaccessible images and permits shared authorized durable images', async () => {
    const f = await fixture(); const content = await f.upgrade(); const fileId = randomUUID(); const segment = content.composition.segments[0]!
    await pool.query("INSERT INTO workspace_files(id,workspace_id,path,name,mime,storage_uri,user_id,created_by_user_id,sensitivity) VALUES($1,$2,$3,'fixture.png','image/png','file:///fixture.png',$4,$4,'internal')", [fileId, f.workspaceId, '/'+fileId+'.png', f.actor.userId])
    const edit: FeedEdit = { kind: 'insertBlock', segmentId: segment.id, afterId: segment.content[0]!.attrs.id, node: { type: 'image', attrs: { id: randomUUID(), fileId, mimeType: 'image/png', placement: 'inline', alt: 'Fixture diagram' } } }
    await expect(f.command([{ kind: 'edit', edits: [edit] }], 2)).rejects.toMatchObject({ code: 'file_not_available_to_draft' })
    await pool.query('UPDATE workspace_files SET user_id=NULL WHERE id=$1', [fileId])
    await f.command([{ kind: 'edit', edits: [edit] }], 2)
    expect((await getFeedCollaboration(f.actor)).copy!.content.media[0]!.fileId).toBe(fileId)
  })

  it('erases Feed transcripts with their owning draft instead of leaving orphan sessions', async () => {
    const f = await fixture(); await f.upgrade(); const threadId = randomUUID()
    await f.command([{ kind: 'comment', threadId, target: { kind: 'post' }, text: 'Owned discussion.' }], 2)
    const transcript = (await getFeedCollaboration(f.actor)).threads[0]!.transcriptSessionId
    await pool.query('DELETE FROM sessions WHERE id=$1', [f.actor.sessionId])
    expect((await pool.query('SELECT id FROM sessions WHERE id=$1', [transcript])).rowCount).toBe(0)
    expect((await pool.query('SELECT id FROM session_messages WHERE session_id=$1', [transcript])).rowCount).toBe(0)
  })
  it('scenario 2: a changed duplicate-text block cannot redirect acceptance to a matching phrase', async () => {
    const f = await fixture('same same'); const content = await f.upgrade(); const s = content.composition.segments[0]!; const suggestionId = randomUUID()
    const edit: FeedEdit = { kind: 'replaceText', spans: [{ segmentId: s.id, blockId: s.content[0]!.attrs.id, from: 5, to: 9 }], preimage: [[{ type: 'text', text: 'same' }]], replacement: [[{ type: 'text', text: 'chosen' }]] }
    await f.command([{ kind: 'propose', suggestionId, edits: [edit], rationale: 'Second occurrence only.' }], 2)
    await f.command([{ kind: 'edit', edits: [replace(content, 0, 'same same same')] }], 2)
    await expect(f.command([{ kind: 'decide', suggestionId, outcome: 'accepted' }], 3)).rejects.toMatchObject({ code: 'proposal_target_changed' })
    expect((await getFeedCollaboration(f.actor)).copy!.content.text).toBe('same same same')
  })

})

describe('[COMP:feed/draft-suggestions] PostgreSQL suggestion acceptance', () => {
  it('scenario 3: concurrent acceptance applies once, with one member decision and a recoverable conflict', async () => {
    const f = await fixture(); const content = await f.upgrade(); const suggestionId = randomUUID()
    await f.command([{ kind: 'propose', suggestionId, edits: [replace(content, 1, 'Chosen replacement.')], rationale: 'Concrete example.' }], 2)
    const results = await Promise.allSettled([f.command([{ kind: 'decide', suggestionId, outcome: 'accepted' }], 2), f.command([{ kind: 'decide', suggestionId, outcome: 'accepted' }], 2, f.other)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'revision_conflict' } })
    const snapshot = await getFeedCollaboration(f.actor)
    expect(snapshot.copy!.revision).toBe(3); expect(snapshot.suggestions[0]!.status).toBe('accepted')
    expect((await pool.query("SELECT id FROM decision_events WHERE session_id=$1 AND event_kind='feed.proposal_decided'", [f.actor.sessionId])).rowCount).toBe(1)
    await f.command([{ kind: 'undo', revision: 3 }], 3)
    expect((await getFeedCollaboration(f.actor)).suggestions[0]!.status).toBe('undone')
    expect((await getFeedCollaboration(f.actor)).copy!.content.text).toBe(f.content.text)
  })
})

describe('[COMP:feed/editorial-decisions] Immutable editorial lineage', () => {
  it('scenario 11 foundation: immutable alternatives and explicit counterproposals retain distinct source history', async () => {
    const f = await fixture(); const content = await f.upgrade(); const first = randomUUID(); const second = randomUUID(); const counter = randomUUID()
    await f.command([{ kind: 'propose', suggestionId: first, edits: [replace(content, 0, 'Alternative one.')], rationale: 'First choice.', sourceToolCallId: 'tool-index-0' }, { kind: 'propose', suggestionId: second, edits: [replace(content, 0, 'Alternative two.')], rationale: 'Reused index, new proposal.', sourceToolCallId: 'tool-index-0' }], 2, { ...f.actor, kind: 'assistant' })
    await f.command([{ kind: 'propose', suggestionId: counter, parentId: first, edits: [replace(content, 0, 'Human counterproposal.')], rationale: 'Prefer the concrete outcome.' }], 2, f.other)
    const proposals = (await getFeedCollaboration(f.actor)).suggestions
    expect(proposals).toHaveLength(3); expect(proposals.find(p => p.id === counter)).toMatchObject({ parentId: first, authorUserId: f.other.userId })
    expect(proposals.every(p => p.status === 'proposed')).toBe(true)
    await expect(pool.query("UPDATE feed_draft_suggestions SET rationale='replaced evidence' WHERE id=$1", [first])).rejects.toThrow('immutable')
    expect((await pool.query('SELECT id FROM decision_events WHERE session_id=$1', [f.actor.sessionId])).rowCount).toBe(0)
  })
})
