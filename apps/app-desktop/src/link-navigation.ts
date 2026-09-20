/**
 * Single-intent coordinator for deployment-aware desktop navigation.
 * All IO is injected so stale-result, restart and delivery races are testable.
 *
 * [COMP:app-desktop/link-navigation]
 */
import {
  parseInternalLinkDestination,
  type InternalLinkDestination,
  type StableInternalLinkDestination,
} from '@use-brian/shared/desktop-links'
import { randomUUID } from 'node:crypto'
import { PENDING_VERIFIER_TTL_MS } from './desktop-auth.js'
import { deploymentKey, type DeploymentAccountSnapshot } from './deployment-accounts.js'
import type { AuthorizedDestinationResult } from './deployment-link-transport.js'
import { resolveDeploymentLink } from './deployment-links.js'

export type LinkNavigationPhase =
  | 'received'
  | 'choose-deployment'
  | 'choose-account'
  | 'connect'
  | 'authorizing'
  | 'reauthenticate'
  | 'denied'
  | 'unreachable'
  | 'blocked'
  | 'delivering'
  | 'expired'

export type LinkNavigationChoice = Readonly<{
  key: string
  label: string
  detail: string
}>

export type LinkNavigationDisplayState = Readonly<{
  requestId: string
  phase: LinkNavigationPhase
  appOrigin: string
  sourceUrl: string
  choices: readonly LinkNavigationChoice[]
  canRetry: boolean
  canOpenBrowser: boolean
  canCancel: boolean
}>

export type PendingLinkNavigation = Readonly<{
  version: 1
  requestId: string
  createdAt: number
  sourceUrl: string
  selectedAccountKey?: string
  phase: LinkNavigationPhase
}>

export type RefreshAccountResult =
  | Readonly<{ kind: 'ok'; accessToken: string }>
  | Readonly<{ kind: 'reauthenticate' }>
  | Readonly<{ kind: 'unreachable' }>

export type DeliverResult = 'delivered' | 'blocked' | 'unreachable'

export type LinkNavigationDependencies = {
  accounts(): DeploymentAccountSnapshot
  refreshAccount(accountKey: string): Promise<RefreshAccountResult>
  authorize(
    accountKey: string,
    accessToken: string,
    destination: InternalLinkDestination,
  ): Promise<AuthorizedDestinationResult>
  deliver(accountKey: string, route: string, requestId: string): Promise<DeliverResult>
  persist(record: PendingLinkNavigation | null): void
  publish(state: LinkNavigationDisplayState | null): void
  openBrowser(url: string): void
  now?: () => number
  requestId?: () => string
}

type Intent = {
  requestId: string
  createdAt: number
  destination: InternalLinkDestination
  phase: LinkNavigationPhase
  choices: LinkNavigationChoice[]
  selectedAccountKey?: string
  resolved?: StableInternalLinkDestination
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/
const RECOVERABLE_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1_000
const PHASES = new Set<LinkNavigationPhase>([
  'received', 'choose-deployment', 'choose-account', 'connect', 'authorizing',
  'reauthenticate', 'denied', 'unreachable', 'blocked', 'delivering', 'expired',
])

function display(intent: Intent): LinkNavigationDisplayState {
  return {
    requestId: intent.requestId,
    phase: intent.phase,
    appOrigin: intent.destination.appOrigin,
    sourceUrl: intent.destination.sourceUrl,
    choices: intent.choices,
    canRetry: ['denied', 'unreachable', 'blocked', 'expired', 'reauthenticate'].includes(intent.phase),
    canOpenBrowser: true,
    canCancel: true,
  }
}

function record(intent: Intent): PendingLinkNavigation {
  return {
    version: 1,
    requestId: intent.requestId,
    createdAt: intent.createdAt,
    sourceUrl: intent.destination.sourceUrl,
    ...(intent.selectedAccountKey ? { selectedAccountKey: intent.selectedAccountKey } : {}),
    phase: intent.phase,
  }
}

export function serializePendingLinkNavigation(value: PendingLinkNavigation): string {
  return JSON.stringify(value)
}

export function parsePendingLinkNavigation(
  raw: string,
  nowMs: number,
  maxAgeMs = PENDING_VERIFIER_TTL_MS,
): PendingLinkNavigation | null {
  let value: Partial<PendingLinkNavigation>
  try {
    value = JSON.parse(raw) as Partial<PendingLinkNavigation>
  } catch {
    return null
  }
  if (
    value.version !== 1 ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID.test(value.requestId) ||
    typeof value.createdAt !== 'number' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.phase !== 'string'
  ) {
    return null
  }
  const age = nowMs - value.createdAt
  if (
    age < 0 ||
    age > RECOVERABLE_RECORD_MAX_AGE_MS ||
    !PHASES.has(value.phase as LinkNavigationPhase) ||
    !parseInternalLinkDestination(value.sourceUrl)
  ) return null
  if (value.selectedAccountKey !== undefined && typeof value.selectedAccountKey !== 'string') return null
  return {
    ...(value as PendingLinkNavigation),
    phase: age > maxAgeMs ? 'expired' : value.phase as LinkNavigationPhase,
  }
}

export class LinkNavigationCoordinator {
  private current: Intent | null = null
  private committing = false

  constructor(private readonly deps: LinkNavigationDependencies) {}

  state(): LinkNavigationDisplayState | null {
    return this.current ? display(this.current) : null
  }

  restore(pending: PendingLinkNavigation): void {
    const destination = parseInternalLinkDestination(pending.sourceUrl)
    if (!destination) return
    const expired = (this.deps.now?.() ?? Date.now()) - pending.createdAt > PENDING_VERIFIER_TTL_MS
    this.current = {
      requestId: pending.requestId,
      createdAt: pending.createdAt,
      destination,
      phase: expired ? 'expired' : pending.phase,
      choices: [],
      ...(pending.selectedAccountKey ? { selectedAccountKey: pending.selectedAccountKey } : {}),
    }
    this.emit()
    if (!expired) void this.drive(this.current.requestId)
  }

  open(destination: InternalLinkDestination): string {
    if (
      this.current &&
      this.current.destination.sourceUrl === destination.sourceUrl &&
      this.current.phase !== 'expired'
    ) {
      this.emit()
      return this.current.requestId
    }
    const requestId = this.deps.requestId?.() ?? randomUUID()
    this.current = {
      requestId,
      createdAt: this.deps.now?.() ?? Date.now(),
      destination,
      phase: 'received',
      choices: [],
    }
    this.emit()
    if (!this.committing) void this.drive(requestId)
    return requestId
  }

  async choose(requestId: string, key: string): Promise<void> {
    const intent = this.active(requestId)
    if (!intent) return
    if (intent.phase === 'choose-deployment') {
      const entries = this.deps.accounts().entries.filter((entry) => deploymentKey(entry.target) === key)
      if (!entries.length) return
      const snapshot = { entries, active: this.deps.accounts().active }
      const resolution = resolveDeploymentLink(intent.destination, snapshot)
      if (resolution.kind === 'account') {
        intent.selectedAccountKey = resolution.accountKey
        await this.authorize(intent)
      } else if (resolution.kind === 'choose-account') {
        intent.phase = 'choose-account'
        intent.choices = resolution.accounts.map((account) => ({
          key: account.key,
          label: account.name || account.email || 'Account',
          detail: account.email,
        }))
        this.emit()
      }
      return
    }
    if (intent.phase === 'choose-account') {
      if (!intent.choices.some((choice) => choice.key === key)) return
      intent.selectedAccountKey = key
      await this.authorize(intent)
    }
  }

  retry(requestId: string): void {
    const intent = this.active(requestId)
    if (!intent) return
    intent.phase = 'received'
    intent.choices = []
    this.emit()
    if (!this.committing) void this.drive(requestId)
  }

  openInBrowser(requestId: string): void {
    const intent = this.active(requestId)
    if (intent) this.deps.openBrowser(intent.destination.sourceUrl)
  }

  cancel(requestId: string): void {
    if (!this.active(requestId)) return
    this.current = null
    this.deps.persist(null)
    this.deps.publish(null)
  }

  acknowledge(requestId: string): void {
    const intent = this.active(requestId)
    if (!intent || intent.phase !== 'delivering') return
    this.current = null
    this.deps.persist(null)
    this.deps.publish(null)
  }

  private active(requestId: string): Intent | null {
    return this.current?.requestId === requestId ? this.current : null
  }

  private emit(): void {
    if (!this.current) return
    this.deps.persist(record(this.current))
    this.deps.publish(display(this.current))
  }

  private async drive(requestId: string): Promise<void> {
    const intent = this.active(requestId)
    if (!intent) return
    const resolution = resolveDeploymentLink(intent.destination, this.deps.accounts())
    if (!this.active(requestId)) return
    if (resolution.kind === 'unknown-deployment' || resolution.kind === 'unsupported-base-path') {
      intent.phase = 'connect'
      intent.choices = []
      this.emit()
      return
    }
    if (resolution.kind === 'choose-target') {
      intent.phase = 'choose-deployment'
      intent.choices = resolution.deployments.map((deployment) => ({
        key: deployment.key,
        label: new URL(deployment.target.appUrl).host,
        detail: `${deployment.target.apiUrl} · ${deployment.accountCount}`,
      }))
      this.emit()
      return
    }
    if (resolution.kind === 'choose-account') {
      intent.phase = 'choose-account'
      intent.choices = resolution.accounts.map((account) => ({
        key: account.key,
        label: account.name || account.email || 'Account',
        detail: account.email,
      }))
      this.emit()
      return
    }
    intent.selectedAccountKey = resolution.accountKey
    await this.authorize(intent)
  }

  private async authorize(intent: Intent): Promise<void> {
    const requestId = intent.requestId
    const accountKey = intent.selectedAccountKey
    if (!accountKey) return
    intent.phase = 'authorizing'
    intent.choices = []
    this.emit()

    const refreshed = await this.deps.refreshAccount(accountKey)
    if (!this.active(requestId)) return
    if (refreshed.kind !== 'ok') {
      intent.phase = refreshed.kind
      this.emit()
      return
    }
    const authorized = await this.deps.authorize(
      accountKey,
      refreshed.accessToken,
      intent.destination,
    )
    if (!this.active(requestId)) return
    if (authorized.kind !== 'authorized') {
      intent.phase = authorized.kind
      this.emit()
      return
    }
    intent.resolved = authorized.destination
    this.committing = true
    const outcome = await this.deps.deliver(accountKey, authorized.route, requestId)
    this.committing = false
    if (this.active(requestId)) {
      intent.phase = outcome === 'delivered' ? 'delivering' : outcome
      this.emit()
    } else if (this.current?.phase === 'received') {
      void this.drive(this.current.requestId)
    }
  }
}
