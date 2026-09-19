/**
 * Deployment-aware internal-link grammar shared by app-web and desktop.
 * Browser-safe: no Node imports.
 *
 * Spec: docs/architecture/features/internal-links.md.
 * [COMP:shared/desktop-links]
 */

export const INTERNAL_WORKSPACE_ALIAS_MAX_LENGTH = 32
export const INTERNAL_PAGE_ALIAS_MAX_LENGTH = 64
export const MAX_NATIVE_OPEN_URL_LENGTH = 8 * 1024

const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const BLOCK_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ENCODED_SEPARATOR = /%(?:2f|5c)/i
const ENCODED_DOT = /%2e/i

export type StableInternalLinkDestination = Readonly<{
  kind: 'ids'
  sourceUrl: string
  appOrigin: string
  workspaceId: string
  pageId?: string
  blockId?: string
}>

export type AliasInternalLinkDestination = Readonly<{
  kind: 'aliases'
  sourceUrl: string
  appOrigin: string
  workspaceAlias: string
  pageAlias?: string
  blockId?: string
}>

export type InternalLinkDestination =
  | StableInternalLinkDestination
  | AliasInternalLinkDestination

export type InternalAliasKind = 'workspace' | 'page'

function aliasMax(kind: InternalAliasKind): number {
  return kind === 'workspace'
    ? INTERNAL_WORKSPACE_ALIAS_MAX_LENGTH
    : INTERNAL_PAGE_ALIAS_MAX_LENGTH
}

export function isValidInternalAlias(alias: string, kind: InternalAliasKind): boolean {
  return alias.length > 0 && alias.length <= aliasMax(kind) && ALIAS_PATTERN.test(alias)
}

function stableSuffix(seed: string): string {
  // FNV-1a over UTF-16 code units. This is a deterministic label suffix, not
  // a security digest; deletion reservations use a server-side database digest.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6)
}

export function suggestInternalAlias(
  label: string,
  kind: InternalAliasKind,
  stableSeed: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const max = aliasMax(kind)
  let base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')

  if (!base) base = `${kind === 'workspace' ? 'team' : 'page'}-${stableSuffix(stableSeed)}`
  if (!taken.has(base)) return base

  // Allocation performs a bounded retry. Include the stable suffix before a
  // small attempt number so concurrent clients converge on the same candidates.
  const suffix = stableSuffix(stableSeed)
  for (let attempt = 2; attempt <= 16; attempt += 1) {
    const tail = `-${suffix}-${attempt}`
    const candidate = `${base.slice(0, max - tail.length).replace(/-+$/g, '')}${tail}`
    if (isValidInternalAlias(candidate, kind) && !taken.has(candidate)) return candidate
  }
  return `${kind === 'workspace' ? 'team' : 'page'}-${suffix}`.slice(0, max)
}

function validId(value: string): boolean {
  return ID_PATTERN.test(value)
}

function validBlockHash(hash: string): string | undefined | null {
  if (!hash) return undefined
  if (!hash.startsWith('#b-')) return null
  const blockId = hash.slice(3)
  return BLOCK_PATTERN.test(blockId) ? blockId : null
}

function rawPathIsSafe(rawUrl: string): boolean {
  const match = rawUrl.match(/^https?:\/\/[^/?#]+([^?#]*)/i)
  if (!match) return false
  const rawPath = match[1] || '/'
  if (rawPath.includes('\\') || ENCODED_SEPARATOR.test(rawPath) || ENCODED_DOT.test(rawPath)) {
    return false
  }
  return !rawPath.split('/').some((segment) => segment === '.' || segment === '..')
}

/** Parse a portable member destination. Query strings are never part of it. */
export function parseInternalLinkDestination(rawUrl: string): InternalLinkDestination | null {
  if (!rawPathIsSafe(rawUrl)) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    return null
  }
  if (url.search || url.origin === 'null') return null

  let segments: string[]
  try {
    segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  const blockId = validBlockHash(url.hash)
  if (blockId === null) return null

  const common = {
    sourceUrl: `${url.origin}${url.pathname}${url.hash}`,
    appOrigin: url.origin,
    ...(blockId ? { blockId } : {}),
  }

  if (segments[0] === 'w' && segments[2] === 'p' && (segments.length === 3 || segments.length === 4)) {
    const workspaceId = segments[1]
    const pageId = segments[3]
    if (!validId(workspaceId) || (pageId !== undefined && !validId(pageId))) return null
    if (!pageId && blockId) return null
    return { kind: 'ids', ...common, workspaceId, ...(pageId ? { pageId } : {}) }
  }

  if (segments[0] === 's' && (segments.length === 2 || segments.length === 3)) {
    const workspaceAlias = segments[1]
    const pageAlias = segments[2]
    if (
      !isValidInternalAlias(workspaceAlias, 'workspace') ||
      (pageAlias !== undefined && !isValidInternalAlias(pageAlias, 'page'))
    ) {
      return null
    }
    if (!pageAlias && blockId) return null
    return { kind: 'aliases', ...common, workspaceAlias, ...(pageAlias ? { pageAlias } : {}) }
  }

  return null
}

function normalizedOrigin(appOrigin: string): string | null {
  try {
    const url = new URL(appOrigin)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null
    }
    if (url.pathname !== '/' || url.search || url.hash) return null
    return url.origin
  } catch {
    return null
  }
}

function blockHash(blockId: string | undefined): string {
  if (!blockId) return ''
  if (!BLOCK_PATTERN.test(blockId)) throw new Error('Invalid block id')
  return `#b-${blockId}`
}

export function buildCanonicalInternalLink(input: {
  appOrigin: string
  workspaceId: string
  pageId?: string
  blockId?: string
}): string {
  const origin = normalizedOrigin(input.appOrigin)
  if (!origin || !validId(input.workspaceId) || (input.pageId && !validId(input.pageId))) {
    throw new Error('Invalid canonical internal-link input')
  }
  if (!input.pageId && input.blockId) throw new Error('A block requires a page')
  const path = `/w/${encodeURIComponent(input.workspaceId)}/p${input.pageId ? `/${encodeURIComponent(input.pageId)}` : ''}`
  return `${origin}${path}${blockHash(input.blockId)}`
}

export function buildAliasInternalLink(input: {
  appOrigin: string
  workspaceAlias: string
  pageAlias?: string
  blockId?: string
}): string {
  const origin = normalizedOrigin(input.appOrigin)
  if (
    !origin ||
    !isValidInternalAlias(input.workspaceAlias, 'workspace') ||
    (input.pageAlias && !isValidInternalAlias(input.pageAlias, 'page'))
  ) {
    throw new Error('Invalid alias internal-link input')
  }
  if (!input.pageAlias && input.blockId) throw new Error('A block requires a page')
  const path = `/s/${encodeURIComponent(input.workspaceAlias)}${input.pageAlias ? `/${encodeURIComponent(input.pageAlias)}` : ''}`
  return `${origin}${path}${blockHash(input.blockId)}`
}

/** Build the web compatibility wrapper around an already validated ID URL. */
export function buildIdHandoffUrl(destinationUrl: string): string {
  const destination = parseInternalLinkDestination(destinationUrl)
  if (!destination || destination.kind !== 'ids') throw new Error('ID destination required')
  const relative = new URL(destination.sourceUrl)
  const result = new URL('/open', destination.appOrigin)
  result.searchParams.set('path', `${relative.pathname}${relative.hash}`)
  return result.href
}

/** Validate `/open?path=` without allowing it to become an external redirect. */
export function parseIdHandoffPath(
  path: string,
  appOrigin: string,
): StableInternalLinkDestination | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > MAX_NATIVE_OPEN_URL_LENGTH) {
    return null
  }
  const origin = normalizedOrigin(appOrigin)
  if (!origin) return null
  const parsed = parseInternalLinkDestination(`${origin}${path}`)
  return parsed?.kind === 'ids' ? parsed : null
}

export function buildNativeOpenUrl(destinationUrl: string, scheme = 'usebrian'): string {
  const destination = parseInternalLinkDestination(destinationUrl)
  if (!destination || !/^[a-z][a-z0-9+.-]*$/i.test(scheme)) {
    throw new Error('Invalid native destination')
  }
  const nativeUrl = `${scheme}://open-url?v=1&url=${encodeURIComponent(destination.sourceUrl)}`
  if (nativeUrl.length > MAX_NATIVE_OPEN_URL_LENGTH) throw new Error('Native URL is too long')
  return nativeUrl
}

export function parseNativeOpenUrl(
  rawUrl: string,
  scheme = 'usebrian',
): InternalLinkDestination | null {
  if (rawUrl.length === 0 || rawUrl.length > MAX_NATIVE_OPEN_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${scheme}:` || url.hostname !== 'open-url' || url.pathname !== '') {
    return null
  }
  const keys = [...url.searchParams.keys()]
  if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('v') || !keys.includes('url')) {
    return null
  }
  if (url.searchParams.getAll('v').length !== 1 || url.searchParams.get('v') !== '1') return null
  if (url.searchParams.getAll('url').length !== 1) return null
  const destination = url.searchParams.get('url')
  return destination ? parseInternalLinkDestination(destination) : null
}
