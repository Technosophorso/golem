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

export const ProviderEntitlementEventSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/),
  eventId: z.string().trim().min(1).max(500),
  providerReference: z.string().trim().min(1).max(500),
  providerPeriodId: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
  command: z.union([GrantCrmEntitlementCommandSchema, UpdateCrmEntitlementCommandSchema]),
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
