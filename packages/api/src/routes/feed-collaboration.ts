/** Authenticated shared Feed collaboration routes. [COMP:feed/draft-comments] */
import { Router } from 'express'
import { z } from 'zod'
import { feedCommandRequestSchema } from '@use-brian/shared'
import { feedCommand } from '../content-planning/collaboration-service.js'
import { getFeedCollaboration, getFeedThreadMessages, FeedCollaborationError, withFeedTransaction, type FeedActor } from '../db/feed-collaboration-store.js'
const uuid = z.string().uuid()
export function feedCollaborationRoutes(): Router {
  const router = Router(); const base = '/:assistantId/draft-sessions/:sessionId'
  router.all(`${base}/{*rest}`, async (req, res, next) => {
    if (!req.userId) { res.status(401).json({ error: 'Unauthorized' }); return }
    if (!uuid.safeParse(req.params.assistantId).success || !uuid.safeParse(req.params.sessionId).success) { res.status(400).json({ error: 'Invalid draft identity' }); return }
    next()
  })
  router.get(`${base}/collaboration`, async (req, res) => {
    try { res.json(await getFeedCollaboration({ userId: req.userId!, assistantId: req.params.assistantId, sessionId: req.params.sessionId, kind: 'user' })) }
    catch (error) { replyError(res, error) }
  })
  router.post(`${base}/commands`, async (req, res) => {
    try { res.json({ receipt: await feedCommand({ userId: req.userId!, assistantId: req.params.assistantId, sessionId: req.params.sessionId, kind: 'user' }, feedCommandRequestSchema.parse(req.body)) }) }
    catch (error) { replyError(res, error) }
  })
  router.get(`${base}/threads/:threadId/messages`, async (req, res) => {
    try {
      const before = z.coerce.number().int().positive().max(2_000_000_000).parse(req.query.before ?? 2_000_000_000)
      res.json({ messages: await getFeedThreadMessages({ userId: req.userId!, assistantId: req.params.assistantId, sessionId: req.params.sessionId, kind: 'user' }, uuid.parse(req.params.threadId), before) })
    } catch (error) { replyError(res, error) }
  })
  router.get(`${base}/history`, async (req, res) => {
    try {
      const actor: FeedActor = { userId: req.userId!, assistantId: req.params.assistantId, sessionId: req.params.sessionId, kind: 'user' }
      const before = z.coerce.number().int().positive().max(2_000_000_000).parse(req.query.before ?? 2_000_000_000)
      const revisions = await withFeedTransaction(actor, async client => (await client.query(`SELECT revision,actor_user_id AS "actorUserId",actor_kind AS "actorKind",content,forward_commands AS commands,created_at AS "createdAt" FROM feed_post_revisions WHERE session_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 30`, [actor.sessionId, before])).rows, false)
      res.json({ revisions, nextBefore: revisions.length === 30 ? revisions.at(-1)!.revision : null })
    } catch (error) { replyError(res, error) }
  })
  return router
}
function replyError(res: import('express').Response, error: unknown) {
  if (error instanceof FeedCollaborationError) res.status(error.status).json({ error: error.code, code: error.code })
  else if (error instanceof z.ZodError) res.status(400).json({ error: 'Invalid Feed request', code: 'invalid_request' })
  else { console.error('[feed-collaboration] request failed', error); res.status(500).json({ error: 'Draft collaboration unavailable', code: 'collaboration_unavailable' }) }
}
