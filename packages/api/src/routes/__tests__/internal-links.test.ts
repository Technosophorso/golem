import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers.js'
import { internalLinkRoutes } from '../internal-links.js'
import type { InternalLinkService } from '../../internal-link-service.js'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PAGE_ID = '00000000-0000-4000-8000-000000000002'

function fixture() {
  const value = {
    workspaceId: WORKSPACE_ID,
    workspaceAlias: 'product',
    pageId: PAGE_ID,
    pageAlias: 'roadmap',
    sharePath: '/s/product/roadmap',
    url: 'https://brain.example/s/product/roadmap',
    canonicalPath: `/w/${WORKSPACE_ID}/p/${PAGE_ID}`,
  }
  const service: InternalLinkService = {
    ensure: vi.fn(async () => ({ ok: true as const, value })),
    resolve: vi.fn(async () => ({ ok: true as const, value })),
    renameWorkspace: vi.fn(async () => ({ ok: true as const, value })),
    renamePage: vi.fn(async () => ({ ok: true as const, value })),
    workspaceAvailability: vi.fn(async () => ({ ok: true as const, value: { available: true } })),
    pageAvailability: vi.fn(async () => ({ ok: true as const, value: { available: true } })),
  }
  return { service, app: createTestApp('/api', internalLinkRoutes(service), { userId: 'user-1' }) }
}

describe('[COMP:api/internal-links] authenticated routes', () => {
  let made = fixture()
  beforeEach(() => { made = fixture() })

  it('ensures and resolves links under the authenticated user', async () => {
    expect((await request(made.app).post('/api/internal-links/ensure').send({
      workspaceId: WORKSPACE_ID, pageId: PAGE_ID,
    })).status).toBe(200)
    expect(made.service.ensure).toHaveBeenCalledWith('user-1', {
      workspaceId: WORKSPACE_ID, pageId: PAGE_ID,
    })

    expect((await request(made.app).post('/api/internal-links/resolve').send({
      workspaceAlias: 'product-old', pageAlias: 'roadmap-old',
    })).body).toMatchObject({ canonicalPath: `/w/${WORKSPACE_ID}/p/${PAGE_ID}` })
  })

  it('maps conflicts to 409 without exposing the holder', async () => {
    vi.mocked(made.service.renamePage).mockResolvedValueOnce({
      ok: false, reason: 'conflict', suggestion: 'roadmap-ab12cd-2',
    })
    const response = await request(made.app)
      .put(`/api/internal-links/pages/${PAGE_ID}/alias`)
      .send({ alias: 'roadmap' })
    expect(response.status).toBe(409)
    expect(response.body).toEqual({
      error: 'Link alias is already reserved', suggestion: 'roadmap-ab12cd-2',
    })
  })

  it('returns the same 404 shape for malformed and inaccessible resolution', async () => {
    const malformed = await request(made.app)
      .post('/api/internal-links/resolve')
      .send({ workspaceAlias: 'Not Valid' })
    expect(malformed.status).toBe(404)

    vi.mocked(made.service.resolve).mockResolvedValueOnce({ ok: false, reason: 'not_found' })
    const missing = await request(made.app)
      .post('/api/internal-links/resolve')
      .send({ workspaceAlias: 'private-team' })
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual(malformed.body)
  })

  it('exposes scoped availability without conflicting-object identity', async () => {
    vi.mocked(made.service.workspaceAvailability).mockResolvedValueOnce({
      ok: true, value: { available: false, suggestion: 'product-ab12cd-2' },
    })
    const response = await request(made.app)
      .get(`/api/internal-links/workspaces/${WORKSPACE_ID}/alias-availability`)
      .query({ alias: 'product' })
    expect(response.body).toEqual({ available: false, suggestion: 'product-ab12cd-2' })
  })
})
