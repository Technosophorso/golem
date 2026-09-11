/** Selection-bound Feed tools use the UI's domain service. [COMP:feed/draft-suggestions] */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { buildTool, type Tool } from '@use-brian/core'
import { feedCommandRequestSchema, feedEditSchema, feedTargetSchema, feedReviewRequestSchema, type FeedEdit } from '@use-brian/shared'
import { proposeFeedReplacement } from '@use-brian/doc-model'
import { feedCommand, readReviewedFeedCollaboration, type FeedTurnContext } from './collaboration-service.js'
import { FeedCollaborationError } from '../db/feed-collaboration-store.js'
import { buildProposeDraftsTool } from './draft-tool.js'
import { requestFeedReview } from './review.js'
import { summarizeFeedRun } from '../db/feed-editorial-runs-store.js'
const uuid = z.string().uuid()
function selectedEdits(context: FeedTurnContext, edits: FeedEdit[]) {
  const target = context.reference.target
  if (!target || target.kind === 'post') return
  for (const edit of edits) {
    if (target.kind === 'range') {
      if (edit.kind !== 'replaceText' || edit.spans.some(span => !target.spans.some(t => span.segmentId === t.segmentId && span.blockId === t.blockId && span.from >= t.from && span.to <= t.to))) throw new FeedCollaborationError(403, 'selection_scope_mismatch')
    } else if (edit.kind === 'joinBlocks' || !('blockId' in edit) || edit.segmentId !== target.segmentId || edit.blockId !== target.blockId) throw new FeedCollaborationError(403, 'selection_scope_mismatch')
  }
}
export function buildFeedCollaborationTools(context: FeedTurnContext, sourceMessageId?: string): Tool[] {
  const live = async () => {
    const current = await readReviewedFeedCollaboration(context.actor)
    if (!current.copy || current.copy.revision !== context.reference.revision) throw new FeedCollaborationError(409, 'draft_context_changed')
    if (context.reference.threadId && !current.threads.some(t => t.id === context.reference.threadId)) throw new FeedCollaborationError(403, 'thread_scope_mismatch')
    return current
  }
  const common = { requiresCapability: 'feed', homeAppToolSet: { app: 'feed' as const, set: 'write' as const }, isConcurrencySafe: false, timeoutMs: 15_000 }
  return [
    buildTool({ ...common, name: 'reviewFeedDraft', description: 'Request five bounded editorial checks for the current Feed draft. Results appear as comments with source coverage. This does not edit, approve, publish, change Goals or save memory. Reuse mutationId to check the same request; an uncertain call requires an explicit new attempt.', inputSchema: feedReviewRequestSchema, isReadOnly: false, requiresConfirmation: false,
      async execute(input) { await live(); if (input.expectedRevision !== context.reference.revision) throw new FeedCollaborationError(409, 'draft_context_changed'); return { data: summarizeFeedRun(await requestFeedReview(context.actor, input)) } } }),
    buildTool({ ...common, name: 'readFeedDraft', description: 'Read the current authorized composition, comments and suggestions for this Feed draft. Returns its exact content revision.', inputSchema: z.object({}).strict(), isReadOnly: true, requiresConfirmation: false,
      async execute() { return { data: await live() } } }),
    buildTool({ ...common, name: 'commentOnFeedDraft', description: 'Discuss the selected Feed passage or block without changing copy. In a thread, reply in that same thread. Ordinary comments do not generate images or authorize rewriting.',
      inputSchema: z.object({ mutationId: uuid, text: z.string().trim().min(1).max(20_000), target: feedTargetSchema.optional() }).strict(), isReadOnly: false, requiresConfirmation: false,
      async execute(input) {
        await live(); const threadId = context.reference.threadId
        const target = context.reference.target ?? input.target ?? { kind: 'post' as const }
        const receipt = await feedCommand(context.actor, { mutationId: input.mutationId, expectedRevision: context.reference.revision, commands: [threadId ? { kind: 'reply', threadId, text: input.text } : { kind: 'comment', threadId: input.mutationId, target, text: input.text }] })
        return { data: receipt }
      } }),
    buildTool({ ...common, name: 'suggestFeedDraftChange', description: 'Propose exact selected-passage changes for human review. Preserve unselected content. Supply exact inline preimages from readFeedDraft. This creates a suggestion and does not apply it.',
      inputSchema: z.object({ mutationId: uuid, edits: z.array(feedEditSchema).min(1).max(100), rationale: z.string().max(20_000), parentId: uuid.optional() }).strict(), isReadOnly: false, requiresConfirmation: false,
      async execute(input) {
        await live(); selectedEdits(context, input.edits)
        return { data: await feedCommand(context.actor, { mutationId: input.mutationId, expectedRevision: context.reference.revision, commands: [{ kind: 'propose', suggestionId: input.mutationId, edits: input.edits, rationale: input.rationale, parentId: input.parentId, threadId: context.reference.threadId, sourceMessageId }] }) }
      } }),
    buildTool({ ...common, name: 'applyFeedDraftCommands', description: 'Apply explicitly approved Feed edits, suggestion decisions, Undo or context changes through the canonical command service. Requires confirmation. Discussion alone is not approval. Does not approve or publish a post.',
      inputSchema: feedCommandRequestSchema, isReadOnly: false, requiresConfirmation: true,
      async execute(input) {
        const current = await live()
        for (const command of input.commands) {
          if (command.kind === 'edit' || command.kind === 'propose') selectedEdits(context, command.edits)
          if (command.kind === 'decide') { const suggestion = current.suggestions.find(s => s.id === command.suggestionId); if (!suggestion) throw new FeedCollaborationError(404, 'suggestion_not_found'); selectedEdits(context, suggestion.edits) }
          if (context.reference.target?.kind === 'range' && ['undo', 'context', 'upgrade'].includes(command.kind)) throw new FeedCollaborationError(403, 'selection_scope_mismatch')
        }
        return { data: await feedCommand({ ...context.actor, kind: 'user' }, input) }
      } }),
    // Whole alternatives remain available; every invocation, even a reused
    // cardboard index, receives its own immutable proposal identity.
    buildProposeDraftsTool({ capture: async input => {
      const current = await live(); const content = current.copy!.content.composition!
      const mutationId = randomUUID()
      const commands = input.drafts.map(draft => {
        const target = context.reference.target ?? { kind: 'post' as const }
        if (target.kind === 'post' && content.segments.length > 1 && draft.threadSegments?.length !== content.segments.length) throw new FeedCollaborationError(400, 'matching_thread_segments_required')
        const edits = target.kind === 'post' && draft.threadSegments ? content.segments.flatMap((segment, index) => proposeFeedReplacement({ version: 1, segments: [segment] }, target, draft.threadSegments![index]!)) : proposeFeedReplacement(content, target, draft.text)
        // A whole alternative is explicitly post-scoped; it is still only a
        // proposal. A selected rewrite uses suggestFeedDraftChange instead.
        return { kind: 'propose' as const, suggestionId: randomUUID(), edits, rationale: input.rationale, sourceProposal: draft, sourceMessageId, sourceToolCallId: `${mutationId}:${draft.index}`, ...(context.reference.threadId ? { threadId: context.reference.threadId } : {}) }
      })
      return feedCommand(context.actor, { mutationId, expectedRevision: current.copy!.revision, commands })
    } }),
  ]
}
