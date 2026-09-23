/**
 * End-to-end integration test for the github extractWrites → composition
 * executor → store writes flow.
 *
 * Covers the dual-write dedup behavior: when the same `event.repo` is
 * processed twice, the second invocation should NOT create a duplicate
 * entity — it should find the existing one by canonical_id and (when
 * attributes differ) supersede it.
 *
 * Pipeline B itself isn't invoked here — that needs full processor
 * test infrastructure. This test verifies the adapter-level chain.
 */

import { describe, expect, it, vi } from 'vitest'

import { createComposeExecutor } from '../../../../classification/compose.js'
import type {
  CompositionContext,
} from '../../../../classification/compose.js'
import { extractWritesFromGithubEvent, githubActorIdentity } from '../extract-writes.js'
import type { GithubNormalizedEvent } from '../types.js'
import type { CrmStore } from '../../../../crm/types.js'
import type {
  EntityCreateParams,
  EntityLinkCreateParams,
  EntityLinkRecord,
  EntityLinksStore,
  EntityRecord,
  EntityStore,
} from '../../../../entities/types.js'

const NOW = new Date('2026-05-28T10:00:00Z')

function baseEvent(overrides: Partial<GithubNormalizedEvent> = {}): GithubNormalizedEvent {
  return {
    event_type: 'pull_request.opened',
    delivery_id: 'd-1',
    occurred_at: NOW,
    repo: 'whatever/belvedere',
    branch: 'feature/x',
    actor: { id: 101, login: 'alice', is_bot: false },
    payload: {},
    ...overrides,
  }
}

function baseCtx(event = baseEvent()): CompositionContext {
  const identity = githubActorIdentity(event)
  return {
    personIdentities: identity ? { actor: identity } : undefined,
    actorUserId: 'user-1',
    workspaceId: 'ws-1',
    sensitivity: 'internal',
    assistantId: null,
    userId: null,
    sourceEpisodeId: 'ep-1',
    createdByRule: 'github-adapter-direct',
    boundary: 'connector',
  }
}

function makeEntity(p: Partial<EntityRecord> & Pick<EntityRecord, 'id'>): EntityRecord {
  return {
    id: p.id,
    kind: p.kind ?? 'repository',
    displayName: p.displayName ?? 'unknown',
    canonicalId: p.canonicalId ?? null,
    aliases: p.aliases ?? [],
    attributes: p.attributes ?? {},
    sensitivity: 'internal',
    workspaceId: p.workspaceId ?? 'ws-1',
    userId: null,
    assistantId: null,
    createdByUserId: 'user-1',
    createdByAssistantId: null,
    sourceEpisodeId: p.sourceEpisodeId ?? null,
    sourceSessionId: null,
    source: 'extracted',
    verifiedByUserId: null,
    verifiedAt: null,
    validFrom: NOW,
    validTo: null,
    supersededBy: null,
    retractedAt: null,
    retractedReason: null,
    retractedBy: null,
    centrality: 0,
    centralityComputedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/**
 * In-memory store stubs that emulate the dedup-by-canonical_id behavior
 * the real EntityStore implements. Keeps the test free of pg mocking.
 */
function makeStores() {
  const created: EntityRecord[] = []
  const byCanonical = new Map<string, EntityRecord>()
  const byName = new Map<string, EntityRecord>()
  const links: EntityLinkRecord[] = []

  function indexEntity(rec: EntityRecord) {
    if (rec.canonicalId) byCanonical.set(`${rec.kind}:${rec.canonicalId}`, rec)
    byName.set(`${rec.kind}:${rec.displayName.toLowerCase()}`, rec)
  }

  const entityStore: Partial<EntityStore> = {
    create: vi.fn(async (params: EntityCreateParams) => {
      const { aliases: _unused, ...rest } = params as EntityCreateParams & { aliases?: readonly string[] }
      const rec = makeEntity({
        id: `ent-${created.length + 1}`,
        ...rest,
      })
      created.push(rec)
      indexEntity(rec)
      return rec
    }),
    findByCanonicalIdSystem: vi.fn(async (_u, _w, cid) => {
      const matches: EntityRecord[] = []
      for (const [key, ent] of byCanonical) {
        if (key.endsWith(`:${cid}`)) matches.push(ent)
      }
      return matches
    }),
    findByNameSystem: vi.fn(async (_u, _w, name, opts?: { kind?: string }) => {
      return byName.get(`${opts?.kind ?? 'person'}:${name.toLowerCase()}`) ?? null
    }),
    supersedeAttributes: vi.fn(async (_u, id, patch) => {
      const existing = created.find((e) => e.id === id)
      if (!existing) return null
      const merged = { ...existing, attributes: patch.attributes, updatedAt: NOW }
      return merged
    }),
  }

  const linksStore: Partial<EntityLinksStore> = {
    create: vi.fn(async (params: EntityLinkCreateParams) => {
      const rec: EntityLinkRecord = {
        id: `link-${links.length + 1}`,
        sourceKind: params.sourceKind,
        sourceId: params.sourceId,
        targetKind: params.targetKind,
        targetId: params.targetId,
        edgeType: params.edgeType,
        attributes: params.attributes ?? {},
        source: params.source,
        verifiedByUserId: null,
        verifiedAt: null,
        validFrom: NOW,
        validTo: null,
        retractedAt: null,
        retractedReason: null,
        sourceEpisodeId: params.sourceEpisodeId ?? null,
        sensitivity: params.sensitivity ?? 'internal',
        workspaceId: params.workspaceId,
        userId: params.userId ?? null,
        assistantId: params.assistantId ?? null,
        createdAt: NOW,
      }
      links.push(rec)
      return rec
    }),
  }

  // Match production: only a stable provider binding can reuse a person.
  const peopleByIdentity = new Map<string, EntityRecord>()
  const crm = {
    createContact: vi.fn(async (params: Parameters<CrmStore['createContact']>[0]) => {
      const key = params.stableIdentity ? JSON.stringify([params.workspaceId, params.stableIdentity]) : null
      const existing = key ? peopleByIdentity.get(key) : null
      if (existing) return { id: existing.id }
      const rec = makeEntity({
        id: `ent-${created.length + 1}`,
        kind: 'person',
        displayName: params.name,
        canonicalId: params.email ?? null,
        attributes: { external_ref: params.externalRef },
        workspaceId: params.workspaceId,
      })
      created.push(rec)
      indexEntity(rec)
      if (key) peopleByIdentity.set(key, rec)
      return { id: rec.id }
    }),
    createCompany: vi.fn(async (params: { workspaceId: string; name: string; domain?: string | null }) => {
      if (params.domain) {
        const existing = byCanonical.get(`company:${params.domain}`)
        if (existing) return { id: `company-${existing.id}`, entityId: existing.id }
      }
      const byNameExisting = byName.get(`company:${params.name.toLowerCase()}`)
      if (byNameExisting) return { id: `company-${byNameExisting.id}`, entityId: byNameExisting.id }
      const rec = makeEntity({
        id: `ent-${created.length + 1}`,
        kind: 'company',
        displayName: params.name,
        canonicalId: params.domain ?? null,
        workspaceId: params.workspaceId,
      })
      created.push(rec)
      indexEntity(rec)
      return { id: `company-${created.length}`, entityId: rec.id }
    }),
    createDeal: vi.fn(),
  } as unknown as CrmStore

  return { entityStore: entityStore as EntityStore, linksStore: linksStore as EntityLinksStore, crm, created, byCanonical, links }
}

describe('[COMP:brain/source-adapters/github/extract-writes] e2e integration', () => {
  it('writes repository + person entity + documented_by edge for a PR event', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({
      entities: stores.entityStore,
      links: stores.linksStore,
      crm: stores.crm,
    })

    const event = baseEvent()
    const writes = extractWritesFromGithubEvent(event)!
    const result = await exec.write(writes, baseCtx())

    // Two entities written: repo (primary) + actor (derived person)
    expect(stores.created).toHaveLength(2)
    const repo = stores.created.find((e) => e.kind === 'repository')!
    const actor = stores.created.find((e) => e.kind === 'person')!
    expect(repo.displayName).toBe('belvedere')
    expect(repo.canonicalId).toBe('https://github.com/whatever/belvedere')
    expect(actor.displayName).toBe('alice')
    expect(actor.attributes.external_ref).toMatchObject({ provider: 'github', host: 'github.com', id: '101' })
    expect(actor.canonicalId).toBeNull()

    // One edge: documented_by(repo, actor)
    expect(stores.links).toHaveLength(1)
    expect(stores.links[0]?.edgeType).toBe('documented_by')
    expect(stores.links[0]?.sourceId).toBe(repo.id)
    expect(stores.links[0]?.targetId).toBe(actor.id)

    // Result map populated correctly
    expect(result.entityIds.primary).toBe(repo.id)
    expect(result.entityIds.actor).toBe(actor.id)
    expect(result.edgeIds).toHaveLength(1)
  })

  it('dedups on second event for same repo — no duplicate entity write', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({
      entities: stores.entityStore,
      links: stores.linksStore,
      crm: stores.crm,
    })

    // First event creates entities
    await exec.write(extractWritesFromGithubEvent(baseEvent())!, baseCtx())
    expect(stores.created).toHaveLength(2)

    // Second event on same repo + actor — should dedup, not duplicate
    await exec.write(extractWritesFromGithubEvent(baseEvent({ delivery_id: 'd-2' }))!, baseCtx())

    // CompositionExecutor.findByCanonicalId dedups the repository (which has
    // canonical_id). People reuse the verified account binding only.
    expect(stores.created).toHaveLength(2)
    // Edges are NOT deduped at this layer (intentional — same repo+actor on
    // separate events is still a distinct documented_by, e.g. two PRs by the
    // same person produce two link rows).
    expect(stores.links).toHaveLength(2)
  })

  it('reuses the account after a login change but separates different accounts with the same login', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({ entities: stores.entityStore, links: stores.linksStore, crm: stores.crm })
    const original = baseEvent()
    const renamed = baseEvent({ actor: { id: 101, login: 'alice-renamed', is_bot: false } })
    const namesake = baseEvent({ actor: { id: 202, login: 'alice', is_bot: false } })
    const first = await exec.write(extractWritesFromGithubEvent(original)!, baseCtx(original))
    const second = await exec.write(extractWritesFromGithubEvent(renamed)!, baseCtx(renamed))
    const third = await exec.write(extractWritesFromGithubEvent(namesake)!, baseCtx(namesake))
    expect(second.entityIds.actor).toBe(first.entityIds.actor)
    expect(third.entityIds.actor).not.toBe(first.entityIds.actor)
    expect(stores.created.filter((e) => e.kind === 'person')).toHaveLength(2)
    expect(stores.links[2]?.targetId).toBe(third.entityIds.actor)
    expect(stores.entityStore.findByNameSystem).not.toHaveBeenCalled()
  })

  it('skips actor + edge entirely when actor is a bot', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({
      entities: stores.entityStore,
      links: stores.linksStore,
      crm: stores.crm,
    })

    const writes = extractWritesFromGithubEvent(
      baseEvent({ actor: { login: 'dependabot[bot]', is_bot: true } }),
    )!
    await exec.write(writes, baseCtx())

    expect(stores.created).toHaveLength(1)
    expect(stores.created[0]?.kind).toBe('repository')
    expect(stores.links).toHaveLength(0)
  })

  it('different repos produce separate entity rows', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({
      entities: stores.entityStore,
      links: stores.linksStore,
      crm: stores.crm,
    })

    await exec.write(extractWritesFromGithubEvent(baseEvent({ repo: 'a/x' }))!, baseCtx())
    await exec.write(extractWritesFromGithubEvent(baseEvent({ repo: 'b/x' }))!, baseCtx())

    const repos = stores.created.filter((e) => e.kind === 'repository')
    expect(repos).toHaveLength(2)
    expect(repos[0]?.canonicalId).toBe('https://github.com/a/x')
    expect(repos[1]?.canonicalId).toBe('https://github.com/b/x')
  })

  it('stamps provenance in entity attributes', async () => {
    const stores = makeStores()
    const exec = createComposeExecutor({
      entities: stores.entityStore,
      links: stores.linksStore,
      crm: stores.crm,
    })

    await exec.write(extractWritesFromGithubEvent(baseEvent())!, baseCtx())
    const repo = stores.created.find((e) => e.kind === 'repository')!
    const provenance = repo.attributes._provenance as Record<string, unknown>
    expect(provenance.created_by_rule).toBe('github-adapter-direct')
    expect(provenance.boundary).toBe('connector')
    expect(provenance.first_written_at).toBeDefined()
  })
})
