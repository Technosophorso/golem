import { describe, expect, it, vi } from 'vitest'
import type { AccountTarget } from '../deployment-accounts.js'
import { authorizeDeploymentDestination } from '../deployment-link-transport.js'

const target: AccountTarget = {
  kind: 'local',
  appUrl: 'https://brain.example',
  apiUrl: 'https://api.brain.example',
  auth: 'pkce',
}

describe('[COMP:app-desktop/deployment-links] explicit-target authorization', () => {
  it('resolves aliases with only the selected target token and preserves the block', async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({
      workspaceId: 'workspace-1', pageId: 'page-1',
      workspaceAlias: 'product', pageAlias: 'roadmap',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const result = await authorizeDeploymentDestination({
      destination: {
        kind: 'aliases', sourceUrl: 'https://brain.example/s/product/roadmap#b-focus',
        appOrigin: 'https://brain.example', workspaceAlias: 'product', pageAlias: 'roadmap', blockId: 'focus',
      },
      target,
      accessToken: 'oss-token',
      fetch,
    })
    expect(result).toMatchObject({
      kind: 'authorized',
      destination: { kind: 'ids', workspaceId: 'workspace-1', pageId: 'page-1', blockId: 'focus' },
      route: '/w/workspace-1/p/page-1#b-focus',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.brain.example/api/internal-links/resolve',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer oss-token' }),
        body: JSON.stringify({ workspaceAlias: 'product', pageAlias: 'roadmap' }),
      }),
    )
  })

  it('checks both workspace and page for stable-ID destinations', async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => new Response('{}', { status: 200 }))
    const result = await authorizeDeploymentDestination({
      destination: {
        kind: 'ids', sourceUrl: 'https://brain.example/w/same-workspace/p/same-page',
        appOrigin: 'https://brain.example', workspaceId: 'same-workspace', pageId: 'same-page',
      },
      target,
      accessToken: 'destination-token',
      fetch,
    })
    expect(result).toMatchObject({ kind: 'authorized', route: '/w/same-workspace/p/same-page' })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.brain.example/api/workspaces/same-workspace',
      'https://api.brain.example/api/views/same-page',
    ])
    for (const [, init] of fetch.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer destination-token' })
    }
  })

  it.each([
    [401, 'reauthenticate'],
    [403, 'denied'],
    [404, 'denied'],
    [503, 'unreachable'],
  ] as const)('maps target status %s to %s without trying another account', async (status, kind) => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => new Response('{}', { status }))
    await expect(authorizeDeploymentDestination({
      destination: {
        kind: 'ids', sourceUrl: 'https://brain.example/w/workspace-1/p',
        appOrigin: 'https://brain.example', workspaceId: 'workspace-1',
      },
      target,
      accessToken: 'destination-token',
      fetch,
    })).resolves.toEqual({ kind })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
