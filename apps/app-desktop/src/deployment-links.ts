/**
 * Pure deployment-first account resolution for portable internal links.
 * No network request or active-target state participates in this decision.
 *
 * [COMP:app-desktop/deployment-links]
 */
import type { InternalLinkDestination } from '@use-brian/shared/desktop-links'
import {
  deploymentAccountKey,
  deploymentKey,
  type AccountTarget,
  type DeploymentAccountSnapshot,
  type SavedDeploymentAccount,
} from './deployment-accounts.js'

export type DeploymentChoice = Readonly<{
  key: string
  target: AccountTarget
  accountCount: number
}>

export type AccountChoice = Readonly<{
  key: string
  target: AccountTarget
  id: string
  name: string
  email: string
}>

export type DeploymentLinkResolution =
  | Readonly<{ kind: 'unknown-deployment'; appOrigin: string }>
  | Readonly<{ kind: 'unsupported-base-path'; appOrigin: string; targets: readonly AccountTarget[] }>
  | Readonly<{ kind: 'choose-target'; appOrigin: string; deployments: readonly DeploymentChoice[] }>
  | Readonly<{ kind: 'choose-account'; appOrigin: string; target: AccountTarget; accounts: readonly AccountChoice[] }>
  | Readonly<{ kind: 'account'; appOrigin: string; target: AccountTarget; accountKey: string }>

function exactRootOrigin(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function accountChoice(entry: SavedDeploymentAccount): AccountChoice {
  return {
    key: deploymentAccountKey(entry),
    target: entry.target,
    id: entry.tokens.user?.id ?? '',
    name: entry.tokens.user?.name ?? '',
    email: entry.tokens.user?.email ?? '',
  }
}

/** Resolve the exact destination origin before consulting any account identity. */
export function resolveDeploymentLink(
  destination: InternalLinkDestination,
  snapshot: DeploymentAccountSnapshot,
): DeploymentLinkResolution {
  const appOrigin = exactRootOrigin(destination.appOrigin)
  if (!appOrigin) return { kind: 'unknown-deployment', appOrigin: destination.appOrigin }

  const sameOrigin: SavedDeploymentAccount[] = []
  const unsupported: AccountTarget[] = []
  for (const entry of snapshot.entries) {
    let targetUrl: URL
    try {
      targetUrl = new URL(entry.target.appUrl)
    } catch {
      continue
    }
    if (targetUrl.origin !== appOrigin) continue
    const targetOrigin = exactRootOrigin(entry.target.appUrl)
    if (!targetOrigin) {
      unsupported.push(entry.target)
      continue
    }
    sameOrigin.push(entry)
  }

  if (unsupported.length > 0) {
    const distinct = new Map(unsupported.map((target) => [deploymentKey(target), target]))
    return { kind: 'unsupported-base-path', appOrigin, targets: [...distinct.values()] }
  }
  if (sameOrigin.length === 0) return { kind: 'unknown-deployment', appOrigin }

  const byDeployment = new Map<string, SavedDeploymentAccount[]>()
  for (const entry of sameOrigin) {
    const key = deploymentKey(entry.target)
    const entries = byDeployment.get(key) ?? []
    entries.push(entry)
    byDeployment.set(key, entries)
  }
  if (byDeployment.size > 1) {
    return {
      kind: 'choose-target',
      appOrigin,
      deployments: [...byDeployment.entries()].map(([key, entries]) => ({
        key,
        target: entries[0].target,
        accountCount: entries.length,
      })),
    }
  }

  const [targetKey, entries] = [...byDeployment.entries()][0]
  const selected = snapshot.active[targetKey]
  if (selected && entries.some((entry) => deploymentAccountKey(entry) === selected)) {
    return { kind: 'account', appOrigin, target: entries[0].target, accountKey: selected }
  }
  if (entries.length === 1) {
    return {
      kind: 'account',
      appOrigin,
      target: entries[0].target,
      accountKey: deploymentAccountKey(entries[0]),
    }
  }
  return {
    kind: 'choose-account',
    appOrigin,
    target: entries[0].target,
    accounts: entries.map(accountChoice),
  }
}
