import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInternalLinkService } from '../internal-link-service.js'
import type { InternalLinkAliasStore } from '../db/internal-link-alias-store.js'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PAGE_ID = '00000000-0000-4000-8000-000000000002'

function fixture() {
  const store: InternalLinkAliasStore = {
    ensure: vi.fn(async ({ workspaceId, pageId }) => ({
      workspaceId,
      workspaceAlias: 'product',
      ...(pageId ? { pageId, pageAlias: 'roadmap' } : {}),
    })),
    getCurrent: vi.fn(),
    resolve: vi.fn(async (_workspaceAlias, pageAlias) => ({
      workspaceId: WORKSPACE_ID,
      workspaceAlias: 'product-current',
      ...(pageAlias ? { pageId: PAGE_ID, pageAlias: 'roadmap-current' } : {}),
    })),
    renameWorkspace: vi.fn(async ({ workspaceId, alias }) => ({
      ok: true as const,
      aliases: { workspaceId, workspaceAlias: alias },
    })),
    renamePage: vi.fn(async ({ workspaceId, pageId, alias }) => ({
      ok: true as const,
      aliases: { workspaceId, workspaceAlias: 'product', pageId, pageAlias: alias },
    })),
    workspaceAvailability: vi.fn(async () => ({ available: true })),
    pageAvailability: vi.fn(async () => ({ available: true })),
  }
  const workspaceStore = {
    get: vi.fn(async () => ({ id: WORKSPACE_ID, name: 'Product' })),
    getRole: vi.fn(async (): Promise<'owner' | 'admin' | 'member' | null> => 'member'),
  }
  const savedViewStore = {
    getById: vi.fn(async () => ({
      id: PAGE_ID,
      workspaceId: WORKSPACE_ID,
      name: 'Roadmap',
      createdBy: 'creator-1',
    })),
  }
  const auditStore = { append: vi.fn(async () => {}) }
  const onAliasChanged = vi.fn(async () => {})
  const service = createInternalLinkService({
    store,
    workspaceStore: workspaceStore as never,
    savedViewStore: savedViewStore as never,
    auditStore: auditStore as never,
    appOrigin: 'https://brain.example/ignored',
    onAliasChanged,
  })
  return { service, store, workspaceStore, savedViewStore, auditStore, onAliasChanged }
}

describe('[COMP:api/internal-links] authorized internal-link commands', () => {
  let made = fixture()
  beforeEach(() => { made = fixture() })

  it('lets a reader lazily ensure a private page link without changing publication', async () => {
    const result = await made.service.ensure('member-1', {
      workspaceId: WORKSPACE_ID,
      pageId: PAGE_ID,
    })
    expect(result).toEqual({
      ok: true,
      value: {
        workspaceId: WORKSPACE_ID,
        workspaceAlias: 'product',
        pageId: PAGE_ID,
        pageAlias: 'roadmap',
        sharePath: '/s/product/roadmap',
        url: 'https://brain.example/s/product/roadmap',
        canonicalPath: `/w/${WORKSPACE_ID}/p/${PAGE_ID}`,
      },
    })
    expect(made.store.ensure).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'member-1', workspaceName: 'Product', pageTitle: 'Roadmap',
    }))
  })

  it('resolves historical aliases to current aliases only after both access checks', async () => {
    const result = await made.service.resolve('member-1', {
      workspaceAlias: 'product-old',
      pageAlias: 'roadmap-old',
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        workspaceAlias: 'product-current',
        pageAlias: 'roadmap-current',
        canonicalPath: `/w/${WORKSPACE_ID}/p/${PAGE_ID}`,
      },
    })
    expect(made.workspaceStore.getRole).toHaveBeenCalledWith('member-1', WORKSPACE_ID)
    expect(made.savedViewStore.getById).toHaveBeenCalledWith('member-1', PAGE_ID)
  })

  it('uses one generic not-found outcome when the actor cannot access the target', async () => {
    made.workspaceStore.getRole.mockResolvedValueOnce(null)
    expect(await made.service.resolve('outsider', {
      workspaceAlias: 'product-old', pageAlias: 'roadmap-old',
    })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('allows page creators and workspace admins to rename, but not ordinary readers', async () => {
    expect(await made.service.renamePage('member-1', PAGE_ID, 'new-roadmap')).toEqual({
      ok: false, reason: 'forbidden',
    })

    made.savedViewStore.getById.mockResolvedValueOnce({
      id: PAGE_ID, workspaceId: WORKSPACE_ID, name: 'Roadmap', createdBy: 'member-1',
    } as never)
    const renamed = await made.service.renamePage('member-1', PAGE_ID, 'new-roadmap')
    expect(renamed).toMatchObject({ ok: true, value: { pageAlias: 'new-roadmap' } })
    expect(made.auditStore.append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'page.link_alias_changed', subjectId: PAGE_ID,
    }))
    expect(made.onAliasChanged).toHaveBeenCalledTimes(1)
  })

  it('requires owner/admin for workspace alias changes and preserves conflict suggestions', async () => {
    expect(await made.service.renameWorkspace('member-1', WORKSPACE_ID, 'new-product')).toEqual({
      ok: false, reason: 'forbidden',
    })
    made.workspaceStore.getRole.mockResolvedValueOnce('admin')
    vi.mocked(made.store.renameWorkspace).mockResolvedValueOnce({
      ok: false, reason: 'conflict', suggestion: 'new-product-ab12cd-2',
    })
    expect(await made.service.renameWorkspace('admin-1', WORKSPACE_ID, 'new-product')).toEqual({
      ok: false, reason: 'conflict', suggestion: 'new-product-ab12cd-2',
    })
  })
})
