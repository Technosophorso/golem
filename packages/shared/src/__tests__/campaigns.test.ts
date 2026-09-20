import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_CHANNEL_CAPABILITIES,
  CAMPAIGN_LIMITS,
  campaignBrowserEventSchema,
  campaignChannelFromWire,
  campaignCreateLinkSchema,
  campaignEmailMetadataSchema,
  campaignPrepareDispatchSchema,
  campaignTrustedConversionSchema,
} from '../campaigns.js'

describe('[COMP:campaigns/contracts] native campaign contracts', () => {
  it('preserves wire identifiers while exposing Email authoring without provider OAuth', () => {
    expect(campaignChannelFromWire('twitter')).toBe('twitter')
    expect(campaignChannelFromWire('x')).toBe('twitter')
    expect(CAMPAIGN_CHANNEL_CAPABILITIES.email).toMatchObject({
      authoring: true,
      delivery: 'smtp',
      providerConnectionRequired: false,
      utmMedium: 'email',
    })
    expect(CAMPAIGN_CHANNEL_CAPABILITIES.linkedin.providerConnectionRequired).toBe(false)
  })

  it('accepts bounded browser observations and refuses identity/form-shaped extras', () => {
    const event = {
      version: 1,
      eventId: 'event_0123456789abcdefghi',
      siteId: 'site__0123456789abcdefghi',
      type: 'page_view',
      occurredAt: '2026-09-20T12:00:00.000Z',
      pagePath: '/pricing/:plan',
      test: true,
      metadata: { cta: 'start' },
    }
    expect(campaignBrowserEventSchema.parse(event)).toMatchObject({ type: 'page_view', test: true })
    expect(campaignBrowserEventSchema.safeParse({ ...event, contactId: crypto.randomUUID() }).success).toBe(false)
    expect(campaignBrowserEventSchema.safeParse({ ...event, metadata: Object.fromEntries(Array.from({ length: CAMPAIGN_LIMITS.metadataKeys + 1 }, (_, index) => [`k${index}`, index])) }).success).toBe(false)
  })

  it('keeps trusted business identity on the server conversion envelope', () => {
    expect(campaignTrustedConversionSchema.parse({
      version: 1,
      siteId: 'site__0123456789abcdefghi',
      conversionKind: 'enquiry_submitted',
      externalOutcomeId: 'enquiry-42',
      occurredAt: '2026-09-20T12:00:00.000Z',
      subject: { kind: 'contact', id: crypto.randomUUID() },
      test: true,
      metadata: {},
    }).conversionKind).toBe('enquiry_submitted')
  })

  it('validates immutable link inputs without credentials or unsafe schemes', () => {
    const base = {
      campaignId: crypto.randomUUID(),
      placementId: crypto.randomUUID(),
      destination: 'https://example.com/path?ref=kept#pricing',
      utm: { source: 'linkedin', medium: 'organic_social', campaign: 'launch_2026_09', content: 'p001_body' },
      existingAttribution: 'reject',
    }
    expect(campaignCreateLinkSchema.parse(base).destination).toContain('#pricing')
    expect(campaignCreateLinkSchema.safeParse({ ...base, destination: 'javascript:alert(1)' }).success).toBe(false)
    expect(campaignCreateLinkSchema.safeParse({ ...base, destination: 'https://secret@example.com/' }).success).toBe(false)
  })

  it('bounds Email metadata, personalization, and broadcast size', () => {
    const metadata = {
      subject: 'A useful update',
      senderId: crypto.randomUUID(),
      audience: { segmentId: crypto.randomUUID(), segmentVersion: 3 },
      purposeKey: 'product_updates',
      personalization: [{ field: 'first_name', required: false, fallback: 'there' }],
      tracking: { links: true, website: true },
    }
    expect(campaignEmailMetadataSchema.parse(metadata).subject).toBe('A useful update')
    const dispatch = {
      campaignId: crypto.randomUUID(), placementId: crypto.randomUUID(), approvedRevision: 2,
      metadata, recipients: Array.from({ length: CAMPAIGN_LIMITS.broadcastRecipients + 1 }, (_, index) => ({
        contactId: crypto.randomUUID(), address: `person-${index}@example.com`, personalization: {}, eligibility: {},
      })),
    }
    expect(campaignPrepareDispatchSchema.safeParse(dispatch).success).toBe(false)
    expect(CAMPAIGN_LIMITS.senderHandoffsPerMinute).toBe(10)
    expect(CAMPAIGN_LIMITS.rawRetentionDays).toBe(90)
    expect(CAMPAIGN_LIMITS.aggregateRetentionMonths).toBe(13)
  })
})
