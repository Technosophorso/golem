import { describe, expect, it } from 'vitest'
import type { InternalLinkDestination } from '@use-brian/shared/desktop-links'
import {
  deploymentAccountKey,
  deploymentKey,
  type AccountTarget,
  type SavedDeploymentAccount,
} from '../deployment-accounts.js'
import { resolveDeploymentLink } from '../deployment-links.js'

const destination = (appOrigin: string): InternalLinkDestination => ({
  kind: 'ids',
  sourceUrl: `${appOrigin}/w/same-workspace/p/same-page`,
  appOrigin,
  workspaceId: 'same-workspace',
  pageId: 'same-page',
})

const cloud: AccountTarget = {
  kind: 'cloud', appUrl: 'https://app.usebrian.ai', apiUrl: 'https://api.usebrian.ai', auth: 'pkce',
}
const oss: AccountTarget = {
  kind: 'local', appUrl: 'https://brain.example', apiUrl: 'https://brain.example/api', auth: 'pkce',
}
const tokens = (id: string, name = id) => ({
  accessToken: `${id}-access`, refreshToken: `${id}-refresh`, accessTokenExpiresAt: 9_999_999_999_999,
  user: { id, name, email: 'same@example.com' },
})
const entry = (target: AccountTarget, id: string): SavedDeploymentAccount => ({ target, tokens: tokens(id) })

describe('[COMP:app-desktop/deployment-links] deployment-first destination resolution', () => {
  it('uses exact origin even when IDs and emails are identical across cloud and OSS', () => {
    const cloudEntry = entry(cloud, 'same-user')
    const ossEntry = entry(oss, 'same-user')
    expect(resolveDeploymentLink(destination(oss.appUrl), {
      entries: [cloudEntry, ossEntry],
      active: { [deploymentKey(cloud)]: deploymentAccountKey(cloudEntry) },
    })).toEqual({
      kind: 'account', appOrigin: oss.appUrl, target: oss,
      accountKey: deploymentAccountKey(ossEntry),
    })
  })

  it('prefers the selected account for the destination deployment', () => {
    const first = entry(oss, 'first')
    const selected = entry(oss, 'selected')
    expect(resolveDeploymentLink(destination(oss.appUrl), {
      entries: [first, selected],
      active: { [deploymentKey(oss)]: deploymentAccountKey(selected) },
    })).toMatchObject({ kind: 'account', accountKey: deploymentAccountKey(selected) })
  })

  it('requires a deployment-pairing choice when API or auth pairings differ', () => {
    const alternate = { ...oss, apiUrl: 'https://api.brain.example' }
    const result = resolveDeploymentLink(destination(oss.appUrl), {
      entries: [entry(oss, 'person'), entry(alternate, 'person')], active: {},
    })
    expect(result).toMatchObject({ kind: 'choose-target', appOrigin: oss.appUrl })
    if (result.kind === 'choose-target') expect(result.deployments).toHaveLength(2)
  })

  it('shows only accounts belonging to the exact deployment pairing', () => {
    const result = resolveDeploymentLink(destination(oss.appUrl), {
      entries: [entry(oss, 'one'), entry(oss, 'two'), entry(cloud, 'cloud')], active: {},
    })
    expect(result).toMatchObject({ kind: 'choose-account', target: oss })
    if (result.kind === 'choose-account') {
      expect(result.accounts.map((account) => account.id)).toEqual(['one', 'two'])
    }
  })

  it('rejects saved base paths instead of collapsing them by hostname', () => {
    const based = { ...oss, appUrl: 'https://brain.example/base' }
    expect(resolveDeploymentLink(destination(oss.appUrl), {
      entries: [entry(based, 'person')], active: {},
    })).toMatchObject({ kind: 'unsupported-base-path', appOrigin: oss.appUrl })
  })

  it('returns unknown without using the active deployment as a fallback', () => {
    expect(resolveDeploymentLink(destination('https://unknown.example'), {
      entries: [entry(cloud, 'person')],
      active: { [deploymentKey(cloud)]: deploymentAccountKey(entry(cloud, 'person')) },
    })).toEqual({ kind: 'unknown-deployment', appOrigin: 'https://unknown.example' })
  })
})
