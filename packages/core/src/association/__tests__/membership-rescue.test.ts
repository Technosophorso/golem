import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AssociationMembershipRescueCreateSchema,
  AssociationMembershipRescueReversalSchema,
  AssociationMembershipRescueSettlementSchema,
} from '../domain.js'

describe('[COMP:crm/association-membership-rescue] Bounded evidence contracts', () => {
  it('requires finite access and exact positive settlement money', () => {
    const rescue={contactId:randomUUID(),planId:randomUUID(),idempotencyKey:randomUUID(),startsAt:'2026-09-01T00:00:00Z',
      endsAt:'2027-09-01T00:00:00Z',dueAt:'2026-09-30T00:00:00Z',reason:'Reviewed offline exception'}
    expect(AssociationMembershipRescueCreateSchema.parse(rescue)).toEqual(rescue)
    expect(AssociationMembershipRescueCreateSchema.safeParse({...rescue,endsAt:rescue.startsAt}).success).toBe(false)
    expect(AssociationMembershipRescueCreateSchema.safeParse({...rescue,endsAt:null}).success).toBe(false)
    const settlement={requestId:randomUUID(),method:'bank_transfer',evidenceReference:'bank-fixture-1',amountMinor:100,
      currency:'hkd',occurredAt:'2026-09-08T00:00:00Z'}
    expect(AssociationMembershipRescueSettlementSchema.parse(settlement)).toMatchObject({currency:'HKD',amountMinor:100})
    expect(AssociationMembershipRescueSettlementSchema.safeParse({...settlement,amountMinor:0}).success).toBe(false)
  })
  it('requires a reason and separate stable identity for reversal evidence', () => {
    const reversal={requestId:randomUUID(),evidenceReference:'reversal-fixture-1',amountMinor:100,currency:'HKD',
      occurredAt:'2026-09-09T00:00:00Z',reason:'Bank recalled the transfer'}
    expect(AssociationMembershipRescueReversalSchema.parse(reversal)).toEqual(reversal)
    expect(AssociationMembershipRescueReversalSchema.safeParse({...reversal,reason:''}).success).toBe(false)
  })
})
