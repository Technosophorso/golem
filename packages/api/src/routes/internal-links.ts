/** Authenticated internal-link allocation, resolution, and alias management. */

import { Router, type Response } from 'express'
import { z } from 'zod'
import type {
  InternalLinkResult,
  InternalLinkService,
} from '../internal-link-service.js'

const targetSchema = z.object({
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid().optional(),
}).strict()

const workspaceAliasSchema = z.string().min(1).max(32).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const pageAliasSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const resolveSchema = z.object({
  workspaceAlias: workspaceAliasSchema,
  pageAlias: pageAliasSchema.optional(),
}).strict()

const aliasBodySchema = z.object({ alias: z.string().min(1).max(64) }).strict()

function send<T>(res: Response, result: InternalLinkResult<T>) {
  if (result.ok) return res.json(result.value)
  if (result.reason === 'forbidden') {
    return res.status(403).json({ error: 'You cannot manage this link alias' })
  }
  if (result.reason === 'invalid_alias') {
    return res.status(400).json({ error: 'Invalid link alias' })
  }
  if (result.reason === 'conflict') {
    return res.status(409).json({ error: 'Link alias is already reserved', suggestion: result.suggestion })
  }
  return res.status(404).json({ error: 'Internal link not found' })
}

function userIdOf(req: { userId?: string }): string | null {
  return req.userId ?? null
}

export function internalLinkRoutes(service: InternalLinkService): Router {
  const router = Router()

  router.post('/internal-links/ensure', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const parsed = targetSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(400).json({ error: 'Invalid internal-link target' })
    return send(res, await service.ensure(userId, parsed.data))
  })

  router.post('/internal-links/resolve', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const parsed = resolveSchema.safeParse(req.body ?? {})
    if (!parsed.success) return res.status(404).json({ error: 'Internal link not found' })
    return send(res, await service.resolve(userId, parsed.data))
  })

  router.put('/internal-links/workspaces/:id/alias', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = z.string().uuid().safeParse(req.params.id)
    const body = aliasBodySchema.safeParse(req.body ?? {})
    if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid link alias request' })
    return send(res, await service.renameWorkspace(userId, id.data, body.data.alias))
  })

  router.put('/internal-links/pages/:id/alias', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = z.string().uuid().safeParse(req.params.id)
    const body = aliasBodySchema.safeParse(req.body ?? {})
    if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid link alias request' })
    return send(res, await service.renamePage(userId, id.data, body.data.alias))
  })

  router.get('/internal-links/workspaces/:id/alias-availability', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = z.string().uuid().safeParse(req.params.id)
    const alias = workspaceAliasSchema.safeParse(req.query.alias)
    if (!id.success || !alias.success) return res.status(400).json({ error: 'Invalid link alias request' })
    return send(res, await service.workspaceAvailability(userId, id.data, alias.data))
  })

  router.get('/internal-links/pages/:id/alias-availability', async (req, res) => {
    const userId = userIdOf(req)
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = z.string().uuid().safeParse(req.params.id)
    const alias = pageAliasSchema.safeParse(req.query.alias)
    if (!id.success || !alias.success) return res.status(400).json({ error: 'Invalid link alias request' })
    return send(res, await service.pageAvailability(userId, id.data, alias.data))
  })

  return router
}
