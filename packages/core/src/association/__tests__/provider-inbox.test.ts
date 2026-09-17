import { describe, expect, it } from 'vitest'
import { ProviderEntitlementEventSchema } from '../provider-inbox.js'

const base = {
  provider: 'stripe',
  eventId: 'evt_membership_refund',
  providerReference: 'sub_membership',
  providerPeriodId: 'checkout:cs_membership',
  occurredAt: '2026-09-12T12:00:00Z',
  command: {
    kind: 'review_entitlement_financial_event' as const,
    entitlementId: '11111111-1111-4111-8111-111111111111',
    adjustmentReference: 're_membership',
    adjustmentKind: 'refund' as const,
    adjustmentStatus: 'succeeded' as const,
    amountMinor: 120000,
    currency: 'HKD',
    paymentIntentId: 'pi_membership',
  },
}

describe('[COMP:crm/provider-inbox] membership financial review evidence', () => {
  it('accepts a closed verified refund or dispute command', () => {
    expect(ProviderEntitlementEventSchema.parse(base).command.kind).toBe('review_entitlement_financial_event')
    expect(ProviderEntitlementEventSchema.parse({
      ...base,
      command: { ...base.command, adjustmentKind: 'dispute', adjustmentStatus: 'open' },
    }).command.kind).toBe('review_entitlement_financial_event')
  })

  it('rejects mismatched statuses and checkout evidence', () => {
    expect(ProviderEntitlementEventSchema.safeParse({
      ...base,
      command: { ...base.command, adjustmentStatus: 'open' },
    }).success).toBe(false)
    expect(ProviderEntitlementEventSchema.safeParse({
      ...base,
      membershipCheckout: {
        id: '22222222-2222-4222-8222-222222222222',
        providerCheckoutReference: 'cs_membership',
        providerCouponReference: 'coupon_membership',
        amountMinor: 120000,
        currency: 'HKD',
      },
    }).success).toBe(false)
  })
})
