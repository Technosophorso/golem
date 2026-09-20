/** Member-authenticated native campaign REST adapter. [COMP:campaigns/store] */
import { Router, type Response } from 'express'
import { z } from 'zod'
import {
  CampaignError,
  type CampaignContext,
  type CampaignReadPort,
  type CampaignServicePort,
} from '@use-brian/core'
import {
  campaignAttachContentSchema,
  campaignCreateLinkSchema,
  campaignManualPublicationSchema,
  campaignSaveObjectSchema,
  campaignSetLinkEnabledSchema,
  campaignUuidSchema,
} from '@use-brian/shared/campaigns'
import { createCampaignService } from '../campaigns/service.js'
import { createDbCampaignStore } from '../db/campaign-store.js'
import { getWorkspaceMembershipSystem } from '../db/workspace-store.js'

const WorkspaceQuery = z.object({ workspaceId: campaignUuidSchema }).strict()
const ListQuery = WorkspaceQuery.extend({
  state: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()
const CommandBody = z.object({
  workspaceId: campaignUuidSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
  command: z.discriminatedUnion('kind', [
    campaignSaveObjectSchema.extend({ kind: z.literal('save_campaign') }),
    z.object({ kind: z.literal('archive_campaign'), campaignId: campaignUuidSchema }).strict(),
    campaignAttachContentSchema.extend({ kind: z.literal('attach_content') }),
    campaignManualPublicationSchema.extend({ kind: z.literal('record_manual_publication') }),
    campaignCreateLinkSchema.extend({ kind: z.literal('create_link') }),
    campaignSetLinkEnabledSchema.extend({ kind: z.literal('set_link_enabled') }),
  ]),
}).strict()

export type CampaignRouteAccess = {
  userId: string
  workspaceId: string
  role: 'owner' | 'admin' | 'member'
  canWrite: boolean
}

function campaignContext(access: CampaignRouteAccess): CampaignContext {
  return {
    workspaceId: access.workspaceId,
    actor: { kind: 'user', userId: access.userId },
    authority: {
      role: access.role,
      canRead: true,
      canWrite: access.canWrite,
      canConfigure: access.role === 'owner' || access.role === 'admin',
      // Phase 4 installs sender-specific authority; ordinary membership alone
      // is intentionally insufficient.
      canSend: false,
    },
  }
}

function respondError(res: Response, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_input', details: error.flatten() })
    return
  }
  if (error instanceof CampaignError) {
    const status = error.code === 'not_found' ? 404
      : error.code === 'forbidden' ? 403
        : error.code === 'conflict' ? 409
          : error.code === 'rate_limited' ? 429
            : error.code === 'unavailable' ? 503 : 400
    res.status(status).json({ error: error.code, message: error.message, ...error.details })
    return
  }
  console.error('[campaigns] request failed:', error)
  res.status(500).json({ error: 'internal' })
}

export function campaignRoutes(options: {
  service?: CampaignServicePort
  reads?: CampaignReadPort
  resolveAccess?: (userId: string, workspaceId: string) => Promise<CampaignRouteAccess | null>
} = {}): Router {
  const router = Router()
  const store = createDbCampaignStore()
  const service = options.service ?? createCampaignService(store)
  const reads: CampaignReadPort = options.reads ?? {
    listCampaigns: (workspaceId, filters) => store.listCampaigns(workspaceId, filters),
    getCampaign: (workspaceId, campaignId) => store.getCampaign(workspaceId, campaignId),
    listLinks: (workspaceId, campaignId) => store.listLinks(workspaceId, campaignId),
    getTrackingSetup: async () => ({ state: 'not_installed' }),
    getResults: async () => ({ state: 'not_installed', reason: 'Tracking not connected' }),
    getAttribution: async () => ({ state: 'not_installed', conversions: [] }),
    previewAudience: async () => ({ state: 'unavailable', reason: 'Email audience review is not enabled.' }),
    previewEmail: async () => ({ state: 'unavailable', reason: 'Email preview is not enabled.' }),
  }
  const resolveAccess = options.resolveAccess ?? (async (userId: string, workspaceId: string) => {
    const membership = await getWorkspaceMembershipSystem(userId, workspaceId)
    return membership ? {
      userId,
      workspaceId,
      role: membership.role,
      canWrite: membership.canDraft,
    } : null
  })

  async function access(req: { userId?: string }, res: Response, workspaceId: string): Promise<CampaignRouteAccess | null> {
    if (!req.userId) {
      res.status(401).json({ error: 'unauthorized' })
      return null
    }
    const resolved = await resolveAccess(req.userId, workspaceId)
    if (!resolved) {
      res.status(404).json({ error: 'not_found' })
      return null
    }
    return resolved
  }

  router.get('/', async (req, res) => {
    try {
      const input = ListQuery.parse(req.query)
      const auth = await access(req, res, input.workspaceId)
      if (!auth) return
      res.json({ campaigns: await reads.listCampaigns(input.workspaceId, { state: input.state, limit: input.limit }) })
    } catch (error) { respondError(res, error) }
  })

  router.post('/commands', async (req, res) => {
    try {
      const input = CommandBody.parse(req.body)
      const auth = await access(req, res, input.workspaceId)
      if (!auth) return
      const receipt = await service.execute(campaignContext(auth), {
        idempotencyKey: input.idempotencyKey,
        command: input.command,
      })
      res.status(receipt.replayed ? 200 : 201).json(receipt)
    } catch (error) { respondError(res, error) }
  })

  router.get('/:campaignId/links', async (req, res) => {
    try {
      const input = WorkspaceQuery.extend({ campaignId: campaignUuidSchema }).parse({ ...req.query, campaignId: req.params.campaignId })
      const auth = await access(req, res, input.workspaceId)
      if (!auth) return
      res.json({ links: await reads.listLinks(input.workspaceId, input.campaignId) })
    } catch (error) { respondError(res, error) }
  })

  router.get('/:campaignId', async (req, res) => {
    try {
      const input = WorkspaceQuery.extend({ campaignId: campaignUuidSchema }).parse({ ...req.query, campaignId: req.params.campaignId })
      const auth = await access(req, res, input.workspaceId)
      if (!auth) return
      const campaign = await reads.getCampaign(input.workspaceId, input.campaignId)
      if (!campaign) return void res.status(404).json({ error: 'not_found' })
      res.json({ campaign })
    } catch (error) { respondError(res, error) }
  })

  return router
}
