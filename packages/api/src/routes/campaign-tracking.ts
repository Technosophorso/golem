/** Public campaign redirect/collection boundary. [COMP:api/campaign-tracking] */
import { Router } from 'express'
import { campaignOpaqueIdSchema } from '@use-brian/shared/campaigns'
import { createDbCampaignStore, type CampaignLinkRow } from '../db/campaign-store.js'

export function campaignTrackingRoutes(options: {
  findLink?: (publicId: string) => Promise<CampaignLinkRow | null>
  observeRedirect?: (input: { link: CampaignLinkRow; userAgent?: string; test: boolean }) => Promise<void>
} = {}): Router {
  const router = Router()
  const store = createDbCampaignStore()
  const findLink = options.findLink ?? ((publicId: string) => store.getLinkByPublicId(publicId))

  router.get('/r/:linkId', async (req, res) => {
    const parsed = campaignOpaqueIdSchema.safeParse(req.params.linkId)
    if (!parsed.success) return void res.status(404).type('text/plain').send('Campaign link unavailable')
    let link: CampaignLinkRow | null = null
    try { link = await findLink(parsed.data) } catch (error) {
      console.error('[campaign-tracking] redirect lookup failed:', error)
    }
    if (!link) return void res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Campaign link unavailable')
    res.set('Cache-Control', 'private, no-store, max-age=0')
    if (options.observeRedirect) {
      void options.observeRedirect({
        link,
        userAgent: req.get('user-agent'),
        test: req.query.brian_test === '1',
      }).catch(error => console.error('[campaign-tracking] redirect observation failed:', error))
    }
    res.redirect(307, link.destination)
  })

  return router
}
