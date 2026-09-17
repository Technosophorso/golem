/** Closed normalized provider inbox contracts. [COMP:crm/provider-inbox] */
import { z } from 'zod'
import { AssociationProviderEventInputSchema, AssociationProviderFinancialEventInputSchema } from './domain.js'
import { GrantCrmEntitlementCommandSchema, UpdateCrmEntitlementCommandSchema } from '../crm/operations-types.js'

const MembershipCheckoutEvidenceSchema = z.object({
  id: z.string().uuid(),
  providerCheckoutReference: z.string().trim().min(1).max(500),
  providerCouponReference: z.string().trim().min(1).max(500),
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).strict()

const ReviewEntitlementFinancialEventCommandSchema = z.object({
  kind: z.literal('review_entitlement_financial_event'),
  entitlementId: z.string().uuid(),
  adjustmentReference: z.string().trim().min(1).max(500),
  adjustmentKind: z.enum(['refund', 'dispute']),
  adjustmentStatus: z.enum(['pending', 'succeeded', 'failed', 'cancelled', 'open', 'won', 'lost', 'prevented']),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentIntentId: z.string().trim().min(1).max(500),
}).strict().superRefine((input, ctx) => {
  const refund = ['pending', 'succeeded', 'failed', 'cancelled'].includes(input.adjustmentStatus)
  const dispute = ['open', 'won', 'lost', 'prevented'].includes(input.adjustmentStatus)
  if ((input.adjustmentKind === 'refund' && !refund) || (input.adjustmentKind === 'dispute' && !dispute)) {
    ctx.addIssue({ code: 'custom', path: ['adjustmentStatus'], message: 'Financial status does not match its adjustment kind.' })
  }
})

export const ProviderEntitlementEventSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  eventId: z.string().trim().min(1).max(500),
  providerReference: z.string().trim().min(1).max(500),
  providerPeriodId: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
  command: z.union([GrantCrmEntitlementCommandSchema, UpdateCrmEntitlementCommandSchema, ReviewEntitlementFinancialEventCommandSchema]),
  membershipCheckout: MembershipCheckoutEvidenceSchema.optional(),
}).strict().superRefine((input, ctx) => {
  const command = input.command
  if (command.kind === 'grant_entitlement' && (command.provider !== input.provider
    || command.providerEntitlementId !== input.providerReference || command.providerPeriodId !== input.providerPeriodId || !command.endsAt)) {
    ctx.addIssue({ code: 'custom', path: ['command'], message: 'A grant must match the verified provider object and finite period.' })
  }
  if (input.membershipCheckout && command.kind !== 'grant_entitlement') {
    ctx.addIssue({ code: 'custom', path: ['membershipCheckout'], message: 'Membership checkout evidence is valid only for an entitlement grant.' })
  }
})
export type ProviderEntitlementEvent = z.infer<typeof ProviderEntitlementEventSchema>
export const ProviderInboxEnvelopeSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('order'), orderId: z.string().uuid(),
    event: z.union([AssociationProviderEventInputSchema, AssociationProviderFinancialEventInputSchema]) }).strict(),
  z.object({ target: z.literal('entitlement'), event: ProviderEntitlementEventSchema }).strict(),
])
export type ProviderInboxEnvelope = z.infer<typeof ProviderInboxEnvelopeSchema>
export const ProviderReceiptStateSchema = z.enum(['pending', 'processing', 'applied', 'retry', 'needs_reconciliation'])
export type ProviderReceiptState = z.infer<typeof ProviderReceiptStateSchema>
