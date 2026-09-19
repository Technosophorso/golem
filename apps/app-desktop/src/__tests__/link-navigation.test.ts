import { describe, expect, it, vi } from 'vitest'
import type { InternalLinkDestination } from '@use-brian/shared/desktop-links'
import { deploymentAccountKey, deploymentKey, type AccountTarget } from '../deployment-accounts.js'
import {
  LinkNavigationCoordinator,
  parsePendingLinkNavigation,
  serializePendingLinkNavigation,
  type LinkNavigationDependencies,
} from '../link-navigation.js'

const target: AccountTarget = {
  kind: 'local', appUrl: 'https://brain.example', apiUrl: 'https://api.brain.example', auth: 'pkce',
}
const saved = {
  target,
  tokens: {
    accessToken: 'old', refreshToken: 'refresh', accessTokenExpiresAt: 10,
    user: { id: 'person-1', name: 'Person', email: 'person@example.com' },
  },
}
const accountKey = deploymentAccountKey(saved)
const destination = (page = 'roadmap'): InternalLinkDestination => ({
  kind: 'aliases',
  sourceUrl: `https://brain.example/s/product/${page}`,
  appOrigin: 'https://brain.example',
  workspaceAlias: 'product',
  pageAlias: page,
})

function fixture(overrides: Partial<LinkNavigationDependencies> = {}) {
  const states: unknown[] = []
  const persisted: unknown[] = []
  const deps: LinkNavigationDependencies = {
    accounts: () => ({ entries: [saved], active: { [deploymentKey(target)]: accountKey } }),
    refreshAccount: vi.fn(async () => ({ kind: 'ok' as const, accessToken: 'rotated' })),
    authorize: vi.fn(async (_key, _token, input) => ({
      kind: 'authorized' as const,
      destination: {
        kind: 'ids' as const, sourceUrl: 'https://brain.example/w/workspace-1/p/page-1',
        appOrigin: input.appOrigin, workspaceId: 'workspace-1', pageId: 'page-1',
      },
      route: '/w/workspace-1/p/page-1',
    })),
    deliver: vi.fn(async () => 'delivered' as const),
    persist: (value) => persisted.push(value),
    publish: (value) => states.push(value),
    openBrowser: vi.fn(),
    now: () => 1_000,
    requestId: () => 'request-1234',
    ...overrides,
  }
  return { coordinator: new LinkNavigationCoordinator(deps), deps, states, persisted }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('[COMP:app-desktop/link-navigation] pending destination coordinator', () => {
  it('refreshes, authorizes, and delivers once with the selected target account', async () => {
    const made = fixture()
    const requestId = made.coordinator.open(destination())
    await settle()
    expect(made.deps.refreshAccount).toHaveBeenCalledWith(accountKey)
    expect(made.deps.authorize).toHaveBeenCalledWith(accountKey, 'rotated', destination())
    expect(made.deps.deliver).toHaveBeenCalledWith(accountKey, '/w/workspace-1/p/page-1', requestId)
    expect(made.coordinator.state()?.phase).toBe('delivering')
    made.coordinator.acknowledge(requestId)
    expect(made.coordinator.state()).toBeNull()
    expect(made.persisted.at(-1)).toBeNull()
  })

  it('deduplicates repeated OS delivery of the same pending link', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const made = fixture({ refreshAccount: vi.fn(async () => { await wait; return { kind: 'ok' as const, accessToken: 'rotated' } }) })
    const first = made.coordinator.open(destination())
    const duplicate = made.coordinator.open(destination())
    expect(duplicate).toBe(first)
    release()
    await settle()
    expect(made.deps.refreshAccount).toHaveBeenCalledTimes(1)
    expect(made.deps.deliver).toHaveBeenCalledTimes(1)
  })

  it('suppresses stale navigation while retaining a completed token refresh', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    let next = 0
    const refresh = vi.fn(async () => { await wait; return { kind: 'ok' as const, accessToken: 'persisted-rotation' } })
    const made = fixture({ refreshAccount: refresh, requestId: () => `request-${++next}000` })
    made.coordinator.open(destination('old'))
    made.coordinator.open(destination('new'))
    release()
    await settle(); await settle()
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(made.deps.authorize).toHaveBeenCalledTimes(1)
    expect(made.deps.authorize).toHaveBeenCalledWith(accountKey, 'persisted-rotation', destination('new'))
    expect(made.deps.deliver).toHaveBeenCalledTimes(1)
  })

  it('keeps the request recoverable on denial, network failure, and unload veto', async () => {
    const denied = fixture({ authorize: vi.fn(async () => ({ kind: 'denied' as const })) })
    denied.coordinator.open(destination())
    await settle()
    expect(denied.coordinator.state()).toMatchObject({ phase: 'denied', canRetry: true, canOpenBrowser: true })

    const blocked = fixture({ deliver: vi.fn(async () => 'blocked' as const) })
    blocked.coordinator.open(destination())
    await settle()
    expect(blocked.coordinator.state()).toMatchObject({ phase: 'blocked', canRetry: true })
  })

  it('round-trips a validated record and makes an expired recovery explicit', () => {
    const value = {
      version: 1 as const, requestId: 'request-1234', createdAt: 1_000,
      sourceUrl: destination().sourceUrl, selectedAccountKey: accountKey, phase: 'authorizing' as const,
    }
    expect(parsePendingLinkNavigation(serializePendingLinkNavigation(value), 1_000)).toEqual(value)
    expect(parsePendingLinkNavigation(serializePendingLinkNavigation(value), 301_001)).toEqual({
      ...value,
      phase: 'expired',
    })
    expect(parsePendingLinkNavigation(serializePendingLinkNavigation(value), 86_401_001)).toBeNull()
    expect(parsePendingLinkNavigation('{"version":1,"requestId":"bad","createdAt":1000,"sourceUrl":"https://evil.example"}', 1_000)).toBeNull()
  })
})
