/**
 * Persistence for private workspace/page alias history.
 *
 * The store runs mutations on the system pool only after the service has
 * authorized the actor. Alias digests remain after target deletion so a
 * previously shared private address can never be assigned to another target.
 *
 * [COMP:db/internal-link-aliases]
 */

import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import { suggestInternalAlias } from '@use-brian/shared/desktop-links'
import { getPool } from './client.js'

export type InternalLinkAliases = Readonly<{
  workspaceId: string
  workspaceAlias: string
  pageId?: string
  pageAlias?: string
}>

export type AliasAvailability = Readonly<{
  available: boolean
  suggestion?: string
}>

export type AliasRenameResult =
  | Readonly<{ ok: true; aliases: InternalLinkAliases }>
  | Readonly<{ ok: false; reason: 'conflict'; suggestion: string }>
  | Readonly<{ ok: false; reason: 'not_found' }>

export type InternalLinkAliasStore = {
  ensure(input: {
    workspaceId: string
    workspaceName: string
    pageId?: string
    pageTitle?: string
    actorUserId: string
  }): Promise<InternalLinkAliases | null>
  getCurrent(workspaceId: string, pageId?: string): Promise<InternalLinkAliases | null>
  resolve(workspaceAlias: string, pageAlias?: string): Promise<InternalLinkAliases | null>
  renameWorkspace(input: {
    workspaceId: string
    alias: string
    workspaceName: string
    actorUserId: string
  }): Promise<AliasRenameResult>
  renamePage(input: {
    workspaceId: string
    pageId: string
    alias: string
    pageTitle: string
    actorUserId: string
  }): Promise<AliasRenameResult>
  workspaceAvailability(workspaceId: string, alias: string, workspaceName: string): Promise<AliasAvailability>
  pageAvailability(workspaceId: string, pageId: string, alias: string, pageTitle: string): Promise<AliasAvailability>
}

export function internalAliasKey(alias: string): string {
  return createHash('sha256').update(alias, 'utf8').digest('hex')
}

class AliasConflictError extends Error {
  constructor(readonly suggestion: string) {
    super('Internal link alias is already reserved')
  }
}

async function inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function currentAliases(
  client: Pick<PoolClient, 'query'>,
  workspaceId: string,
  pageId?: string,
): Promise<InternalLinkAliases | null> {
  const workspace = await client.query<{ alias: string }>(
    `SELECT alias FROM workspace_link_aliases
      WHERE workspace_id = $1 AND is_current AND alias IS NOT NULL
      LIMIT 1`,
    [workspaceId],
  )
  const workspaceAlias = workspace.rows[0]?.alias
  if (!workspaceAlias) return null
  if (!pageId) return { workspaceId, workspaceAlias }

  const page = await client.query<{ alias: string }>(
    `SELECT alias FROM page_link_aliases
      WHERE namespace_workspace_id = $1 AND page_id = $2
        AND is_current AND alias IS NOT NULL
      LIMIT 1`,
    [workspaceId, pageId],
  )
  const pageAlias = page.rows[0]?.alias
  return pageAlias ? { workspaceId, workspaceAlias, pageId, pageAlias } : null
}

async function allocateWorkspaceAlias(
  client: Pick<PoolClient, 'query'>,
  input: { workspaceId: string; label: string; actorUserId: string },
): Promise<string> {
  const taken = new Set<string>()
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const alias = suggestInternalAlias(input.label, 'workspace', input.workspaceId, taken)
    const inserted = await client.query<{ alias: string }>(
      `INSERT INTO workspace_link_aliases
         (workspace_id, alias, alias_key, is_current, created_by)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (alias_key) DO NOTHING
       RETURNING alias`,
      [input.workspaceId, alias, internalAliasKey(alias), input.actorUserId],
    )
    if (inserted.rows[0]) return inserted.rows[0].alias
    taken.add(alias)
  }
  throw new Error('Unable to allocate a workspace link alias after 16 attempts')
}

async function allocatePageAlias(
  client: Pick<PoolClient, 'query'>,
  input: { workspaceId: string; pageId: string; label: string; actorUserId: string },
): Promise<string> {
  const taken = new Set<string>()
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const alias = suggestInternalAlias(input.label, 'page', input.pageId, taken)
    const inserted = await client.query<{ alias: string }>(
      `INSERT INTO page_link_aliases
         (namespace_workspace_id, page_id, alias, alias_key, is_current, created_by)
       VALUES ($1, $2, $3, $4, true, $5)
       ON CONFLICT (namespace_workspace_id, alias_key) DO NOTHING
       RETURNING alias`,
      [input.workspaceId, input.pageId, alias, internalAliasKey(alias), input.actorUserId],
    )
    if (inserted.rows[0]) return inserted.rows[0].alias
    taken.add(alias)
  }
  throw new Error('Unable to allocate a page link alias after 16 attempts')
}

export function createDbInternalLinkAliasStore(): InternalLinkAliasStore {
  return {
    async ensure(input) {
      return inTransaction(async (client) => {
        const workspace = await client.query(
          `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`,
          [input.workspaceId],
        )
        if (!workspace.rows[0]) return null
        if (input.pageId) {
          const page = await client.query(
            `SELECT id FROM saved_views
              WHERE id = $1 AND workspace_id = $2
              FOR UPDATE`,
            [input.pageId, input.workspaceId],
          )
          if (!page.rows[0]) return null
        }

        let aliases = await currentAliases(client, input.workspaceId, input.pageId)
        if (!aliases) {
          const workspaceCurrent = await currentAliases(client, input.workspaceId)
          if (!workspaceCurrent) {
            await allocateWorkspaceAlias(client, {
              workspaceId: input.workspaceId,
              label: input.workspaceName,
              actorUserId: input.actorUserId,
            })
          }
          if (input.pageId) {
            const pageCurrent = await client.query(
              `SELECT alias FROM page_link_aliases
                WHERE page_id = $1 AND is_current AND alias IS NOT NULL
                LIMIT 1`,
              [input.pageId],
            )
            if (!pageCurrent.rows[0]) {
              await allocatePageAlias(client, {
                workspaceId: input.workspaceId,
                pageId: input.pageId,
                label: input.pageTitle ?? '',
                actorUserId: input.actorUserId,
              })
            }
          }
          aliases = await currentAliases(client, input.workspaceId, input.pageId)
        }
        return aliases
      })
    },

    async getCurrent(workspaceId, pageId) {
      const client = await getPool().connect()
      try {
        return await currentAliases(client, workspaceId, pageId)
      } finally {
        client.release()
      }
    },

    async resolve(workspaceAlias, pageAlias) {
      const workspace = await getPool().query<{
        workspaceId: string
        workspaceAlias: string
      }>(
        `SELECT historical.workspace_id AS "workspaceId", current.alias AS "workspaceAlias"
           FROM workspace_link_aliases historical
           JOIN workspace_link_aliases current
             ON current.workspace_id = historical.workspace_id AND current.is_current
          WHERE historical.alias_key = $1
            AND historical.workspace_id IS NOT NULL
            AND current.alias IS NOT NULL
          LIMIT 1`,
        [internalAliasKey(workspaceAlias)],
      )
      const foundWorkspace = workspace.rows[0]
      if (!foundWorkspace) return null
      if (!pageAlias) return foundWorkspace

      const page = await getPool().query<{
        pageId: string
        pageAlias: string
      }>(
        `SELECT historical.page_id AS "pageId", current.alias AS "pageAlias"
           FROM page_link_aliases historical
           JOIN page_link_aliases current
             ON current.page_id = historical.page_id AND current.is_current
           JOIN saved_views page
             ON page.id = historical.page_id
            AND page.workspace_id = historical.namespace_workspace_id
          WHERE historical.namespace_workspace_id = $1
            AND historical.alias_key = $2
            AND historical.page_id IS NOT NULL
            AND current.alias IS NOT NULL
          LIMIT 1`,
        [foundWorkspace.workspaceId, internalAliasKey(pageAlias)],
      )
      const foundPage = page.rows[0]
      return foundPage
        ? { ...foundWorkspace, pageId: foundPage.pageId, pageAlias: foundPage.pageAlias }
        : null
    },

    async renameWorkspace(input) {
      try {
        return await inTransaction(async (client) => {
        const target = await client.query(
          `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE`,
          [input.workspaceId],
        )
        if (!target.rows[0]) return { ok: false, reason: 'not_found' } as const

        const holder = await client.query<{ id: string; workspaceId: string | null }>(
          `SELECT id, workspace_id AS "workspaceId"
             FROM workspace_link_aliases WHERE alias_key = $1 FOR UPDATE`,
          [internalAliasKey(input.alias)],
        )
        if (holder.rows[0] && holder.rows[0].workspaceId !== input.workspaceId) {
          return {
            ok: false,
            reason: 'conflict',
            suggestion: suggestInternalAlias(input.workspaceName, 'workspace', input.workspaceId, new Set([input.alias])),
          } as const
        }

        await client.query(
          `UPDATE workspace_link_aliases SET is_current = false
            WHERE workspace_id = $1 AND is_current`,
          [input.workspaceId],
        )
        if (holder.rows[0]) {
          await client.query(
            `UPDATE workspace_link_aliases
                SET alias = $2, is_current = true, deleted_at = NULL, created_by = $3
              WHERE id = $1`,
            [holder.rows[0].id, input.alias, input.actorUserId],
          )
        } else {
          const inserted = await client.query(
            `INSERT INTO workspace_link_aliases
               (workspace_id, alias, alias_key, is_current, created_by)
             VALUES ($1, $2, $3, true, $4)
             ON CONFLICT (alias_key) DO NOTHING
             RETURNING id`,
            [input.workspaceId, input.alias, internalAliasKey(input.alias), input.actorUserId],
          )
          if (!inserted.rows[0]) {
            throw new AliasConflictError(
              suggestInternalAlias(input.workspaceName, 'workspace', input.workspaceId, new Set([input.alias])),
            )
          }
        }
        const aliases = await currentAliases(client, input.workspaceId)
        return aliases ? { ok: true, aliases } : { ok: false, reason: 'not_found' }
        })
      } catch (error) {
        if (error instanceof AliasConflictError) {
          return { ok: false, reason: 'conflict', suggestion: error.suggestion }
        }
        throw error
      }
    },

    async renamePage(input) {
      try {
        return await inTransaction(async (client) => {
        const target = await client.query(
          `SELECT id FROM saved_views
            WHERE id = $1 AND workspace_id = $2
            FOR UPDATE`,
          [input.pageId, input.workspaceId],
        )
        if (!target.rows[0]) return { ok: false, reason: 'not_found' } as const

        const holder = await client.query<{ id: string; pageId: string | null }>(
          `SELECT id, page_id AS "pageId"
             FROM page_link_aliases
            WHERE namespace_workspace_id = $1 AND alias_key = $2
            FOR UPDATE`,
          [input.workspaceId, internalAliasKey(input.alias)],
        )
        if (holder.rows[0] && holder.rows[0].pageId !== input.pageId) {
          return {
            ok: false,
            reason: 'conflict',
            suggestion: suggestInternalAlias(input.pageTitle, 'page', input.pageId, new Set([input.alias])),
          } as const
        }

        await client.query(
          `UPDATE page_link_aliases SET is_current = false
            WHERE page_id = $1 AND is_current`,
          [input.pageId],
        )
        if (holder.rows[0]) {
          await client.query(
            `UPDATE page_link_aliases
                SET alias = $2, is_current = true, deleted_at = NULL, created_by = $3
              WHERE id = $1`,
            [holder.rows[0].id, input.alias, input.actorUserId],
          )
        } else {
          const inserted = await client.query(
            `INSERT INTO page_link_aliases
               (namespace_workspace_id, page_id, alias, alias_key, is_current, created_by)
             VALUES ($1, $2, $3, $4, true, $5)
             ON CONFLICT (namespace_workspace_id, alias_key) DO NOTHING
             RETURNING id`,
            [input.workspaceId, input.pageId, input.alias, internalAliasKey(input.alias), input.actorUserId],
          )
          if (!inserted.rows[0]) {
            throw new AliasConflictError(
              suggestInternalAlias(input.pageTitle, 'page', input.pageId, new Set([input.alias])),
            )
          }
        }
        const aliases = await currentAliases(client, input.workspaceId, input.pageId)
        return aliases ? { ok: true, aliases } : { ok: false, reason: 'not_found' }
        })
      } catch (error) {
        if (error instanceof AliasConflictError) {
          return { ok: false, reason: 'conflict', suggestion: error.suggestion }
        }
        throw error
      }
    },

    async workspaceAvailability(workspaceId, alias, workspaceName) {
      const holder = await getPool().query<{ workspaceId: string | null }>(
        `SELECT workspace_id AS "workspaceId" FROM workspace_link_aliases WHERE alias_key = $1`,
        [internalAliasKey(alias)],
      )
      const available = !holder.rows[0] || holder.rows[0].workspaceId === workspaceId
      return available
        ? { available: true }
        : {
            available: false,
            suggestion: suggestInternalAlias(workspaceName, 'workspace', workspaceId, new Set([alias])),
          }
    },

    async pageAvailability(workspaceId, pageId, alias, pageTitle) {
      const holder = await getPool().query<{ pageId: string | null }>(
        `SELECT page_id AS "pageId" FROM page_link_aliases
          WHERE namespace_workspace_id = $1 AND alias_key = $2`,
        [workspaceId, internalAliasKey(alias)],
      )
      const available = !holder.rows[0] || holder.rows[0].pageId === pageId
      return available
        ? { available: true }
        : {
            available: false,
            suggestion: suggestInternalAlias(pageTitle, 'page', pageId, new Set([alias])),
          }
    },
  }
}
