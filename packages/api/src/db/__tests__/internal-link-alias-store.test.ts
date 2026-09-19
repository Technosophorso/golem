import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../client.js', () => ({ getPool: vi.fn() }))

import { getPool } from '../client.js'
import {
  createDbInternalLinkAliasStore,
  internalAliasKey,
} from '../internal-link-alias-store.js'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const PAGE_ID = '00000000-0000-4000-8000-000000000002'

const rows = (value: unknown[]) => ({ rows: value, rowCount: value.length }) as never

function poolWith(
  clientQuery: (sql: string, params?: unknown[]) => Promise<unknown>,
  poolQuery: (sql: string, params?: unknown[]) => Promise<unknown> = clientQuery,
) {
  const release = vi.fn()
  const client = { query: vi.fn(clientQuery), release }
  vi.mocked(getPool).mockReturnValue({
    connect: vi.fn(async () => client),
    query: vi.fn(poolQuery),
  } as never)
  return { client, release }
}

describe('[COMP:db/internal-link-aliases] alias history store', () => {
  beforeEach(() => vi.resetAllMocks())

  it('retries an automatic workspace collision with a bounded stable suffix', async () => {
    let currentReads = 0
    let inserts = 0
    const made = poolWith(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return rows([])
      if (sql.includes('SELECT id FROM workspaces')) return rows([{ id: WORKSPACE_ID }])
      if (sql.includes('SELECT alias FROM workspace_link_aliases')) {
        currentReads += 1
        return currentReads < 3 ? rows([]) : rows([{ alias: 'product-abc123-2' }])
      }
      if (sql.includes('INSERT INTO workspace_link_aliases')) {
        inserts += 1
        return inserts === 1 ? rows([]) : rows([{ alias: 'product-abc123-2' }])
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    const result = await createDbInternalLinkAliasStore().ensure({
      workspaceId: WORKSPACE_ID,
      workspaceName: 'Product',
      actorUserId: 'user-1',
    })
    expect(result).toEqual({ workspaceId: WORKSPACE_ID, workspaceAlias: 'product-abc123-2' })
    expect(inserts).toBe(2)
    expect(made.release).toHaveBeenCalled()
  })

  it('resolves any historical workspace/page pair to current aliases', async () => {
    const poolQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workspace_link_aliases historical')) {
        expect(params).toEqual([internalAliasKey('product-old')])
        return rows([{ workspaceId: WORKSPACE_ID, workspaceAlias: 'product-current' }])
      }
      if (sql.includes('FROM page_link_aliases historical')) {
        expect(params).toEqual([WORKSPACE_ID, internalAliasKey('roadmap-old')])
        return rows([{ pageId: PAGE_ID, pageAlias: 'roadmap-current' }])
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    poolWith(async () => rows([]), poolQuery)
    expect(await createDbInternalLinkAliasStore().resolve('product-old', 'roadmap-old')).toEqual({
      workspaceId: WORKSPACE_ID,
      workspaceAlias: 'product-current',
      pageId: PAGE_ID,
      pageAlias: 'roadmap-current',
    })
  })

  it('allows reclaiming the same target history through the atomic rename path', async () => {
    const statements: string[] = []
    const made = poolWith(async (sql) => {
      statements.push(sql)
      if (sql === 'BEGIN' || sql === 'COMMIT') return rows([])
      if (sql.includes('SELECT id FROM saved_views')) return rows([{ id: PAGE_ID }])
      if (sql.includes('SELECT id, page_id AS')) return rows([{ id: 'alias-row-1', pageId: PAGE_ID }])
      if (sql.includes('SELECT alias FROM workspace_link_aliases')) return rows([{ alias: 'product' }])
      if (sql.includes('SELECT alias FROM page_link_aliases')) return rows([{ alias: 'roadmap-old' }])
      if (sql.startsWith('UPDATE') || sql.includes('UPDATE page_link_aliases')) return rows([])
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    const result = await createDbInternalLinkAliasStore().renamePage({
      workspaceId: WORKSPACE_ID,
      pageId: PAGE_ID,
      alias: 'roadmap-old',
      pageTitle: 'Roadmap',
      actorUserId: 'user-1',
    })
    expect(result).toMatchObject({ ok: true, aliases: { pageAlias: 'roadmap-old' } })
    expect(statements.some((sql) => sql.includes('SET alias = $2, is_current = true'))).toBe(true)
    expect(made.release).toHaveBeenCalled()
  })

  it('keeps another target and deletion tombstones reserved', async () => {
    const poolQuery = vi.fn(async () => rows([{ workspaceId: null }]))
    poolWith(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return rows([])
      if (sql.includes('SELECT id FROM workspaces')) return rows([{ id: WORKSPACE_ID }])
      if (sql.includes('SELECT id, workspace_id AS')) return rows([{ id: 'alias-row', workspaceId: null }])
      throw new Error(`Unexpected SQL: ${sql}`)
    }, poolQuery)
    const store = createDbInternalLinkAliasStore()
    expect(await store.workspaceAvailability(WORKSPACE_ID, 'retired-team', 'Product')).toMatchObject({
      available: false,
    })
    expect(await store.renameWorkspace({
      workspaceId: WORKSPACE_ID,
      alias: 'retired-team',
      workspaceName: 'Product',
      actorUserId: 'user-1',
    })).toMatchObject({ ok: false, reason: 'conflict' })
  })

  it('rolls back a manual rename when another transaction claims the alias', async () => {
    const statements: string[] = []
    poolWith(async (sql) => {
      statements.push(sql)
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return rows([])
      if (sql.includes('SELECT id FROM workspaces')) return rows([{ id: WORKSPACE_ID }])
      if (sql.includes('SELECT id, workspace_id AS')) return rows([])
      if (sql.includes('UPDATE workspace_link_aliases SET is_current')) return rows([])
      if (sql.includes('INSERT INTO workspace_link_aliases')) return rows([])
      throw new Error(`Unexpected SQL: ${sql}`)
    })

    await expect(createDbInternalLinkAliasStore().renameWorkspace({
      workspaceId: WORKSPACE_ID,
      alias: 'launch-plan',
      workspaceName: 'Product',
      actorUserId: 'user-1',
    })).resolves.toMatchObject({ ok: false, reason: 'conflict' })
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
  })
})
