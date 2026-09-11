/** Canonical vertical command port, shared by member/legacy/integration/tool adapters.
 * [COMP:crm/association-service]
 */
import { z } from 'zod'
import { AssociationWaitlistOfferInputSchema } from './waitlist.js'
import { ProviderEntitlementEventSchema, ProviderReceiptStateSchema } from './provider-inbox.js'
import { WORKSPACE_MODULE_ACTIONS } from '@use-brian/shared'
import { CrmOperationsActorSchema, CrmOperationsAuthoritySchema } from '../crm/operations-types.js'
import {
  AssociationTicketInputSchema, AssociationOrderCreateSchema, AssociationProviderEventInputSchema, AssociationProviderFinancialEventInputSchema, AssociationProviderBindingInputSchema,
  AssociationRegistrationUpdateSchema, AssociationOrderStatusSchema, AssociationRegistrationStatusSchema,
  AssociationCheckInCorrectionSchema,
  AssociationMembershipRescueCreateSchema, AssociationMembershipRescueSettlementSchema,
  AssociationMembershipRescueReversalSchema, AssociationMembershipRescueCancellationSchema,
  AssociationMembershipRescueStatusSchema,
  AssociationListPageSchema, type AssociationOrderFinancialSummary,
  type AssociationSourceOrderImportInput,
} from './domain.js'

const Id = z.string().uuid()
export const AssociationContextSchema = z.object({
  workspaceId: Id,
  actor: CrmOperationsActorSchema,
  authority: CrmOperationsAuthoritySchema.extend({
    canRead: z.boolean(), canReconcileProvider: z.boolean().default(false),
  }),
}).strict()
export type AssociationContext = z.infer<typeof AssociationContextSchema>

export const AssociationCommandSchema = z.union([
  z.object({ kind: z.literal('module_status') }).strict(),
  z.object({ kind: z.literal('module_action'), action: z.enum(WORKSPACE_MODULE_ACTIONS), expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('list_tickets'), eventId: Id }).strict(),
  z.object({ kind: z.literal('save_ticket'), eventId: Id, ticket: AssociationTicketInputSchema }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_waitlist'), eventId: Id.optional(), includeClosed: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('offer_waitlist_place'), offer: AssociationWaitlistOfferInputSchema }).strict(),
  z.object({ kind: z.literal('create_order'), order: AssociationOrderCreateSchema }).strict(),
  z.object({ kind: z.literal('get_order'), orderId: Id }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_orders'), eventId: Id.optional(),
    contactId: Id.optional(), status: AssociationOrderStatusSchema.optional() }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('module_blockers') }).strict(),
  z.object({ kind: z.literal('expire_due_order'), orderId: Id }).strict(),
  z.object({ kind: z.literal('cancel_order'), orderId: Id }).strict(),
  z.object({ kind: z.literal('confirm_free_order'), orderId: Id }).strict(),
  z.object({ kind: z.literal('bind_order_provider'), orderId: Id, binding: AssociationProviderBindingInputSchema }).strict(),
  z.object({ kind: z.literal('reconcile_provider_event'), orderId: Id, event: AssociationProviderEventInputSchema }).strict(),
  z.object({ kind: z.literal('reconcile_provider_financial_event'), orderId: Id, event: AssociationProviderFinancialEventInputSchema }).strict(),
  z.object({ kind: z.literal('reconcile_provider_entitlement'), event: ProviderEntitlementEventSchema }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_provider_receipts'), orderId: Id.optional(), entitlementId: Id.optional(), state: ProviderReceiptStateSchema.optional() }).strict(),
  z.object({ kind: z.literal('retry_provider_receipt'), receiptId: Id }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_membership_rescues'), contactId: Id.optional(),
    planId: Id.optional(), status: AssociationMembershipRescueStatusSchema.optional() }).strict(),
  z.object({ kind: z.literal('create_membership_rescue'), rescue: AssociationMembershipRescueCreateSchema }).strict(),
  z.object({ kind: z.literal('settle_membership_rescue'), rescueId: Id, settlement: AssociationMembershipRescueSettlementSchema }).strict(),
  z.object({ kind: z.literal('reverse_membership_rescue'), rescueId: Id, reversal: AssociationMembershipRescueReversalSchema }).strict(),
  z.object({ kind: z.literal('cancel_membership_rescue'), rescueId: Id, cancellation: AssociationMembershipRescueCancellationSchema }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_registrations'), eventId: Id, status: AssociationRegistrationStatusSchema.optional() }).strict(),
  AssociationListPageSchema.extend({ kind: z.literal('list_operational_roster'), eventId: Id }).strict(),
  z.object({ kind: z.literal('update_registration'), registrationId: Id, update: AssociationRegistrationUpdateSchema }).strict(),
  z.object({ kind: z.literal('correct_check_in'), registrationId: Id, correction: AssociationCheckInCorrectionSchema }).strict(),
])
export type AssociationCommand = z.infer<typeof AssociationCommandSchema>
export type AssociationCommandResult = {
  command: AssociationCommand['kind']
  record?: Record<string, unknown>
  items?: Array<Record<string, unknown>>
  nextCursor?: string | null
  created?: boolean
  pendingOrders?: number
  financialSummary?: AssociationOrderFinancialSummary[]
  receipt?: Record<string, unknown>
}
export interface AssociationServicePort {
  execute(context: AssociationContext, command: AssociationCommand): Promise<AssociationCommandResult>
}
/** Internal port used only by the confirmed production-import service. */
export interface AssociationSourceOrderImportPort {
  importSourceOrder(
    context: AssociationContext,
    input: AssociationSourceOrderImportInput,
  ): Promise<{ record: Record<string, unknown>; created: boolean; duplicate: boolean }>
}
export const ASSOCIATION_READ_COMMANDS = ['module_status', 'list_tickets', 'get_order', 'list_orders', 'module_blockers', 'list_registrations', 'list_operational_roster', 'list_waitlist', 'list_provider_receipts', 'list_membership_rescues'] as const
