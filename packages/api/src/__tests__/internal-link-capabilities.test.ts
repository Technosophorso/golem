import { describe, expect, it, vi } from 'vitest'
import { detectInternalLinkAliasReadiness } from '../internal-link-capabilities.js'

describe('[COMP:api/internal-links] public rollout readiness', () => {
  it('advertises aliases only when both migration tables exist', async () => {
    const ready = vi.fn(async () => ({ rows: [{ workspace: 'workspace_link_aliases', page: 'page_link_aliases' }] }))
    expect(await detectInternalLinkAliasReadiness(ready)).toEqual({ internalLinkAliasesVersion: 1 })
    expect(await detectInternalLinkAliasReadiness(async () => ({ rows: [{ workspace: 'workspace_link_aliases', page: null }] }))).toEqual({})
  })

  it('fails closed while the database is unavailable', async () => {
    expect(await detectInternalLinkAliasReadiness(async () => { throw new Error('offline') })).toEqual({})
  })
})
