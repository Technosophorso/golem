/** Explicit-target authorization probes for deployment-aware links. */
import {
  buildCanonicalInternalLink,
  type InternalLinkDestination,
  type StableInternalLinkDestination,
} from '@use-brian/shared/desktop-links'
import type { AccountTarget } from './deployment-accounts.js'

export type TargetFetch = (input: string, init: RequestInit) => Promise<Response>

export type AuthorizedDestinationResult =
  | Readonly<{ kind: 'authorized'; destination: StableInternalLinkDestination; route: string }>
  | Readonly<{ kind: 'reauthenticate' }>
  | Readonly<{ kind: 'denied' }>
  | Readonly<{ kind: 'unreachable' }>

function canonicalRoute(destination: StableInternalLinkDestination): string {
  const url = new URL(buildCanonicalInternalLink(destination))
  return `${url.pathname}${url.hash}`
}

function statusResult(status: number): Exclude<AuthorizedDestinationResult, { kind: 'authorized' }> {
  if (status === 401) return { kind: 'reauthenticate' }
  if (status === 403 || status === 404) return { kind: 'denied' }
  return { kind: 'unreachable' }
}

function requestInit(accessToken: string, body?: unknown): RequestInit {
  return {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

/**
 * Resolve/verify using only the selected target's API URL, token and transport.
 * The active deployment is deliberately absent from this interface.
 */
export async function authorizeDeploymentDestination(input: {
  destination: InternalLinkDestination
  target: AccountTarget
  accessToken: string
  fetch: TargetFetch
}): Promise<AuthorizedDestinationResult> {
  try {
    if (input.destination.kind === 'aliases') {
      const response = await input.fetch(
        new URL('/api/internal-links/resolve', input.target.apiUrl).href,
        requestInit(input.accessToken, {
          workspaceAlias: input.destination.workspaceAlias,
          ...(input.destination.pageAlias ? { pageAlias: input.destination.pageAlias } : {}),
        }),
      )
      if (!response.ok) return statusResult(response.status)
      const body = await response.json() as Record<string, unknown>
      if (
        typeof body.workspaceId !== 'string' ||
        (input.destination.pageAlias && typeof body.pageId !== 'string')
      ) {
        return { kind: 'unreachable' }
      }
      const destination: StableInternalLinkDestination = {
        kind: 'ids',
        sourceUrl: buildCanonicalInternalLink({
          appOrigin: input.destination.appOrigin,
          workspaceId: body.workspaceId,
          ...(typeof body.pageId === 'string' ? { pageId: body.pageId } : {}),
          ...(input.destination.blockId ? { blockId: input.destination.blockId } : {}),
        }),
        appOrigin: input.destination.appOrigin,
        workspaceId: body.workspaceId,
        ...(typeof body.pageId === 'string' ? { pageId: body.pageId } : {}),
        ...(input.destination.blockId ? { blockId: input.destination.blockId } : {}),
      }
      return { kind: 'authorized', destination, route: canonicalRoute(destination) }
    }

    const workspace = await input.fetch(
      new URL(`/api/workspaces/${encodeURIComponent(input.destination.workspaceId)}`, input.target.apiUrl).href,
      requestInit(input.accessToken),
    )
    if (!workspace.ok) return statusResult(workspace.status)
    if (input.destination.pageId) {
      const page = await input.fetch(
        new URL(`/api/views/${encodeURIComponent(input.destination.pageId)}`, input.target.apiUrl).href,
        requestInit(input.accessToken),
      )
      if (!page.ok) return statusResult(page.status)
    }
    return {
      kind: 'authorized',
      destination: input.destination,
      route: canonicalRoute(input.destination),
    }
  } catch {
    return { kind: 'unreachable' }
  }
}
