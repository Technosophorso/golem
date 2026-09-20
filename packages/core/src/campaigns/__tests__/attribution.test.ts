import { describe, expect, it } from 'vitest'
import {
  campaignConversionRate,
  classifyCampaignRequest,
  normalizeBrowserOccurredAt,
  selectCampaignAttribution,
  type CampaignTouch,
} from '../attribution.js'

const touch = (overrides: Partial<CampaignTouch>): CampaignTouch => ({
  eventId: crypto.randomUUID(),
  linkId: 'link_0123456789abcdefghi',
  siteId: 'site__0123456789abcdefghi',
  occurredAt: '2026-09-10T10:00:00.000Z',
  acquisitionEvidence: 'browser_observed',
  utm: { source: 'linkedin', medium: 'organic_social' },
  ...overrides,
})

describe('[COMP:campaigns/attribution] bounded attribution rules', () => {
  it('freezes distinct first and last eligible external touches', () => {
    const first = touch({ eventId: 'first_0123456789abcdefghi', occurredAt: '2026-09-05T10:00:00.000Z' })
    const latest = touch({ eventId: 'latest_0123456789abcdefgh', occurredAt: '2026-09-18T10:00:00.000Z', utm: { source: 'newsletter' } })
    const output = selectCampaignAttribution([latest, first], '2026-09-20T10:00:00.000Z')
    expect(output.firstTouch?.eventId).toBe(first.eventId)
    expect(output.lastTouch?.eventId).toBe(latest.eventId)
    expect(output.ruleVersion).toBe(1)
    expect(output.lookbackDays).toBe(30)
  })

  it('does not let direct/internal navigation overwrite acquisition and expires old evidence', () => {
    const external = touch({ occurredAt: '2026-09-15T10:00:00.000Z' })
    const internal = touch({ eventId: 'internal_0123456789abcdefgh', occurredAt: '2026-09-19T10:00:00.000Z', internalNavigation: true })
    const direct = touch({ eventId: 'direct_0123456789abcdefghij', occurredAt: '2026-09-19T11:00:00.000Z', direct: true })
    expect(selectCampaignAttribution([external, internal, direct], '2026-09-20T10:00:00.000Z').lastTouch?.eventId).toBe(external.eventId)
    expect(selectCampaignAttribution([touch({ occurredAt: '2026-07-01T00:00:00.000Z' })], '2026-09-20T10:00:00.000Z').state).toBe('unattributed')
  })

  it('bounds browser clock skew instead of letting timestamps rewrite history', () => {
    const received = new Date('2026-09-20T10:00:00.000Z')
    expect(normalizeBrowserOccurredAt('2027-01-01T00:00:00.000Z', received).toISOString()).toBe('2026-09-20T10:05:00.000Z')
    expect(normalizeBrowserOccurredAt('2020-01-01T00:00:00.000Z', received).toISOString()).toBe('2026-06-22T10:00:00.000Z')
  })

  it('keeps scanners and unknown requests separate from observed browsers', () => {
    expect(classifyCampaignRequest('LinkedInBot/1.0')).toBe('known_automated')
    expect(classifyCampaignRequest('Mozilla/5.0 Safari/605.1')).toBe('observed_browser')
    expect(classifyCampaignRequest(undefined)).toBe('unknown')
  })

  it('reports rates only with an honest denominator', () => {
    expect(campaignConversionRate({ verifiedConversions: 2, sessions: 10 })).toEqual({ value: 0.2, denominator: 'sessions' })
    expect(campaignConversionRate({ verifiedConversions: 2, sessions: null })).toMatchObject({ value: null, denominator: 'unavailable' })
  })
})
