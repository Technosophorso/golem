import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { CampaignLinkRow } from '../../db/campaign-store.js'
import { campaignTrackingRoutes } from '../campaign-tracking.js'

const PUBLIC_ID = '0123456789abcdef0123456789abcdef'
const LINK: CampaignLinkRow = {
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  campaignId: '00000000-0000-4000-8000-000000000003',
  placementId: '00000000-0000-4000-8000-000000000004',
  publicId: PUBLIC_ID,
  destination: 'https://example.com/offer?utm_source=linkedin&brian_link=0123456789abcdef0123456789abcdef#details',
  utm: { source: 'linkedin', medium: 'organic_social', campaign: 'example', content: 'body' },
  enabled: true,
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
}

function app(options: Parameters<typeof campaignTrackingRoutes>[0]) {
  const server = express()
  // Deliberately mount the public router before a broad auth guard: this is
  // the route order both editions receive from bootOpenApi.
  server.use(campaignTrackingRoutes(options))
  server.use('/api', (_req, res) => res.status(401).json({ error: 'auth' }))
  return server
}

describe('[COMP:api/campaign-tracking] public native campaign boundaries', () => {
  it('redirects only through an enabled stored destination without caching', async () => {
    const findLink = vi.fn(async () => LINK)
    const response = await request(app({ findLink }))
      .get(`/r/${PUBLIC_ID}?url=https://attacker.example/`)
      .expect(307)
    expect(response.headers.location).toBe(LINK.destination)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(findLink).toHaveBeenCalledWith(PUBLIC_ID)
  })

  it('keeps redirect delivery working when observation storage fails', async () => {
    const observeRedirect = vi.fn(async () => { throw new Error('collector offline') })
    const response = await request(app({ findLink: async () => LINK, observeRedirect }))
      .get(`/r/${PUBLIC_ID}?brian_test=1`)
      .set('user-agent', 'synthetic-browser')
      .expect(307)
    expect(response.headers.location).toBe(LINK.destination)
    await vi.waitFor(() => expect(observeRedirect).toHaveBeenCalledWith(expect.objectContaining({ test: true })))
  })

  it('never turns a malformed or unknown id into an open redirect', async () => {
    await request(app({ findLink: async () => LINK })).get('/r/not-valid?url=https://attacker.example').expect(404)
    await request(app({ findLink: async () => null })).get(`/r/${PUBLIC_ID}?url=https://attacker.example`).expect(503)
  })
})
