import { describe, expect, it } from 'vitest'
import {
  buildAliasInternalLink,
  buildCanonicalInternalLink,
  buildIdHandoffUrl,
  buildNativeOpenUrl,
  INTERNAL_PAGE_ALIAS_MAX_LENGTH,
  INTERNAL_WORKSPACE_ALIAS_MAX_LENGTH,
  isValidInternalAlias,
  MAX_NATIVE_OPEN_URL_LENGTH,
  parseInternalLinkDestination,
  parseIdHandoffPath,
  parseNativeOpenUrl,
  suggestInternalAlias,
} from '../desktop-links.js'

describe('[COMP:shared/desktop-links] deployment-aware internal links', () => {
  it('parses canonical workspace, page, and block destinations', () => {
    expect(parseInternalLinkDestination('https://brain.example/w/workspace-1/p')).toMatchObject({
      kind: 'ids', appOrigin: 'https://brain.example', workspaceId: 'workspace-1',
    })
    expect(parseInternalLinkDestination('https://brain.example/w/workspace-1/p/page-1#b-block-1')).toEqual({
      kind: 'ids',
      sourceUrl: 'https://brain.example/w/workspace-1/p/page-1#b-block-1',
      appOrigin: 'https://brain.example',
      workspaceId: 'workspace-1',
      pageId: 'page-1',
      blockId: 'block-1',
    })
  })

  it('parses private alias destinations without resolving them', () => {
    expect(parseInternalLinkDestination('http://localhost:3001/s/product/roadmap#b-section_1')).toEqual({
      kind: 'aliases',
      sourceUrl: 'http://localhost:3001/s/product/roadmap#b-section_1',
      appOrigin: 'http://localhost:3001',
      workspaceAlias: 'product',
      pageAlias: 'roadmap',
      blockId: 'section_1',
    })
  })

  it('round-trips canonical, alias, fallback, and native builders', () => {
    const canonical = buildCanonicalInternalLink({
      appOrigin: 'https://brain.example', workspaceId: 'workspace-1', pageId: 'page-1', blockId: 'block-1',
    })
    expect(canonical).toBe('https://brain.example/w/workspace-1/p/page-1#b-block-1')
    expect(buildIdHandoffUrl(canonical)).toBe(
      'https://brain.example/open?path=%2Fw%2Fworkspace-1%2Fp%2Fpage-1%23b-block-1',
    )
    const alias = buildAliasInternalLink({
      appOrigin: 'https://brain.example', workspaceAlias: 'product', pageAlias: 'roadmap', blockId: 'block-1',
    })
    expect(parseNativeOpenUrl(buildNativeOpenUrl(alias))).toEqual(
      parseInternalLinkDestination(alias),
    )
  })

  it('validates the ID fallback as a same-origin member route', () => {
    expect(parseIdHandoffPath('/w/workspace-1/p/page-1#b-block-1', 'https://brain.example')).toMatchObject({
      kind: 'ids', workspaceId: 'workspace-1', pageId: 'page-1', blockId: 'block-1',
    })
    expect(parseIdHandoffPath('//evil.example/w/workspace-1/p', 'https://brain.example')).toBeNull()
    expect(parseIdHandoffPath('/s/product/roadmap', 'https://brain.example')).toBeNull()
    expect(parseIdHandoffPath('/w/workspace-1/p?page=1', 'https://brain.example')).toBeNull()
  })

  it('rejects redirects, traversal, encoded separators, queries, and unsupported hashes', () => {
    for (const value of [
      'https://user:pass@brain.example/s/product',
      'https://brain.example//evil.example/s/product',
      'https://brain.example/s/../product',
      'https://brain.example/s/%2e%2e/product',
      'https://brain.example/s/product%2Froadmap',
      'https://brain.example/s/product\\roadmap',
      'https://brain.example/s/product/roadmap?next=https://evil.example',
      'https://brain.example/s/product/roadmap#other',
      'https://brain.example/open?path=%2Fw%2Fx%2Fp',
      'https://brain.example/s/product/roadmap/extra',
    ]) expect(parseInternalLinkDestination(value)).toBeNull()
  })

  it('requires one version and one URL in native links', () => {
    const encoded = encodeURIComponent('https://brain.example/s/product/roadmap')
    expect(parseNativeOpenUrl(`usebrian://open-url?v=2&url=${encoded}`)).toBeNull()
    expect(parseNativeOpenUrl(`usebrian://open-url?v=1&url=${encoded}&url=${encoded}`)).toBeNull()
    expect(parseNativeOpenUrl(`usebrian://open-url?url=${encoded}&v=1`)).toMatchObject({
      kind: 'aliases', workspaceAlias: 'product', pageAlias: 'roadmap',
    })
    expect(parseNativeOpenUrl(`usebrian://open-url?v=1&url=${encoded}&extra=1`)).toBeNull()
    expect(parseNativeOpenUrl('x'.repeat(MAX_NATIVE_OPEN_URL_LENGTH + 1))).toBeNull()
  })

  it('validates and suggests stable workspace/page aliases', () => {
    expect(isValidInternalAlias('product-team', 'workspace')).toBe(true)
    expect(isValidInternalAlias('x'.repeat(INTERNAL_WORKSPACE_ALIAS_MAX_LENGTH + 1), 'workspace')).toBe(false)
    expect(isValidInternalAlias('x'.repeat(INTERNAL_PAGE_ALIAS_MAX_LENGTH), 'page')).toBe(true)
    expect(isValidInternalAlias('Product', 'page')).toBe(false)
    expect(suggestInternalAlias('Product Roadmap', 'page', 'page-1')).toBe('product-roadmap')
    expect(suggestInternalAlias('製品', 'workspace', 'workspace-1')).toMatch(/^team-[a-z0-9]{6}$/)
    expect(suggestInternalAlias('', 'page', 'page-1')).toBe(
      suggestInternalAlias('', 'page', 'page-1'),
    )
  })

  it('uses bounded stable collision candidates within the size limit', () => {
    const first = suggestInternalAlias('Roadmap', 'page', 'page-1')
    const next = suggestInternalAlias('Roadmap', 'page', 'page-1', new Set([first]))
    expect(next).toMatch(/^roadmap-[a-z0-9]{6}-2$/)
    expect(next.length).toBeLessThanOrEqual(INTERNAL_PAGE_ALIAS_MAX_LENGTH)
  })
})
