/** Canonical Association command authority. [COMP:crm/association-service] */
import {
  ASSOCIATION_READ_COMMANDS, AssociationCommandSchema, AssociationContextSchema,
  AssociationError, CrmOperationsError, CrmIntegrationScopeError,
  actorAuditIdentity, crmIntegrationResourceSelection,
  requireCrmIntegrationOperation, requireCrmIntegrationResources,
  type AssociationActor, type AssociationContext, type AssociationServicePort,
  AssociationSourceOrderImportSchema, type AssociationSourceOrderImportPort,
  type CrmIntegrationOperation, type CrmOperationsServicePort,
} from '@use-brian/core'
import { createAssociationStore, type AssociationStore } from '../db/association-store.js'
import { createWorkspaceModulesStore, type WorkspaceModulesStore } from '../db/workspace-modules-store.js'

function actor(context: AssociationContext): AssociationActor {
  const identity = actorAuditIdentity(context.actor)
  return { credentialKind: context.actor.kind, credentialId: identity.actorCredentialId,
    ...(identity.actingUserId ? { actingUserId: identity.actingUserId } : {}),
    ...(context.authority.integration ? { integration: context.authority.integration } : {}) }
}

export function createAssociationService(options: {
  crmService: CrmOperationsServicePort
  store?: AssociationStore
  modules?: WorkspaceModulesStore
}): AssociationServicePort & AssociationSourceOrderImportPort {
  const store = options.store ?? createAssociationStore()
  // Resolve the default lazily so pure command tests never open a database.
  const modules = () => options.modules ?? createWorkspaceModulesStore()
  return {
    async importSourceOrder(rawContext, rawInput) {
      const context = AssociationContextSchema.parse(rawContext)
      const input = AssociationSourceOrderImportSchema.parse(rawInput)
      if (context.actor.kind !== 'import' || context.actor.jobId !== input.importJobId
        || !context.authority.canWrite || !context.authority.canConfigure
        || !['owner', 'admin'].includes(context.authority.role)) {
        throw new CrmOperationsError('not_authorized', 'Source orders require the current owner/admin production import job.')
      }
      const saved = await store.importSourceOrder(context.workspaceId, input, actor(context))
      return { record: saved.record, created: saved.created, duplicate: !saved.created }
    },
    async execute(rawContext, rawCommand) {
      const context = AssociationContextSchema.parse(rawContext)
      const command = AssociationCommandSchema.parse(rawCommand)
      const { workspaceId, authority } = context
      const integration = authority.integration
      const read = (ASSOCIATION_READ_COMMANDS as readonly string[]).includes(command.kind)
      if (!(read ? authority.canRead : authority.canWrite)) throw new CrmOperationsError('not_authorized', 'Association authority is required.')
      if (context.actor.kind === 'intake_key') throw new CrmOperationsError('not_authorized', 'An intake credential cannot operate Association commerce.')
      if (context.actor.kind === 'integration_key' && integration?.credentialId !== context.actor.credentialId) throw new CrmIntegrationScopeError('association.read')
      const operation: CrmIntegrationOperation = read ? 'association.read'
        : ['save_ticket', 'save_promotion'].includes(command.kind) ? 'crm.catalog.configure'
        : ['reconcile_provider_event', 'reconcile_provider_financial_event', 'reconcile_provider_entitlement', 'bind_order_provider'].includes(command.kind) ? 'association.provider_events.write' : 'association.orders.write'
      if (integration) {
        if (command.kind === 'module_action') throw new CrmOperationsError('not_authorized', 'A member owner or admin is required for module actions.')
        requireCrmIntegrationOperation(integration, operation)
        if ('eventId' in command && command.eventId) requireCrmIntegrationResources(integration, operation, { eventIds: command.eventId })
      }
      if(command.kind==='expire_due_order' && !(context.actor.kind==='system_job' && context.actor.job==='association_expiry'))
        throw new CrmOperationsError('not_authorized','Due reservation expiry requires its dedicated system job.')
      if (context.actor.kind === 'system_job' && !(
        (context.actor.job === 'association_reconciliation' && ['reconcile_provider_event', 'reconcile_provider_financial_event'].includes(command.kind))
        || (context.actor.job === 'association_expiry' && command.kind === 'expire_due_order')
        || (context.actor.job === 'entitlement_reconciliation' && command.kind === 'reconcile_provider_entitlement')
      )) throw new CrmOperationsError('not_authorized', 'This system job cannot perform the requested Association command.')
      const dbActor = actor(context)
      const output = { command: command.kind }
      const pagination = () => {
        if (!('limit' in command)) throw new Error('Command has no pagination')
        return { limit: command.limit, cursor: command.cursor ?? null,
          createdAfter: command.createdAfter, createdBefore: command.createdBefore }
      }
      const requireFinanceReviewer = () => {
        if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
          throw new CrmOperationsError('not_authorized', 'A workspace owner or admin is required to review offline payment evidence.')
        }
      }
      switch (command.kind) {
        case 'module_status': return { ...output, record: { ...(await modules().getAssociation(workspaceId)) } }
        case 'module_action': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A member owner or admin is required for module actions.')
          }
          const changed = await modules().act(workspaceId, context.actor.userId, command)
          return { ...output, record: { ...changed.module }, created: changed.changed, pendingOrders: changed.pendingOrders }
        }
        case 'list_tickets': return { ...output, items: await store.listTickets(workspaceId, command.eventId) }
        case 'save_ticket': return { ...output, ...(await store.upsertTicket(workspaceId, command.eventId, command.ticket, dbActor)) }
        case 'list_promotions': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A workspace owner or admin must manage promotions.')
          }
          return { ...output, ...(await store.listPromotions(workspaceId, { ...pagination(), status: command.status })) }
        }
        case 'save_promotion': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A workspace owner or admin must manage promotions.')
          }
          return { ...output, ...(await store.upsertPromotion(workspaceId, command.promotion, dbActor)) }
        }
        case 'list_waitlist': {
          const events = integration ? crmIntegrationResourceSelection(integration, 'association.read', 'eventIds') : 'all'
          if (integration) requireCrmIntegrationOperation(integration, 'crm.submissions.read')
          const definitions = integration ? crmIntegrationResourceSelection(integration, 'crm.submissions.read', 'definitionIds') : 'all'
          return { ...output, ...(await store.listWaitlist(workspaceId, { ...pagination(), eventId: command.eventId, includeClosed: command.includeClosed,
            ...(events === 'all' ? {} : { allowedEventIds: events }), ...(definitions === 'all' ? {} : { allowedDefinitionIds: definitions }) })) }
        }
        case 'offer_waitlist_place': return { ...output, ...(await store.offerWaitlistPlace(workspaceId, command.offer, dbActor)) }
        case 'list_provider_receipts': {
          const events = integration ? crmIntegrationResourceSelection(integration, 'association.read', 'eventIds') : 'all'
          const plans = integration ? (integration.grants.some(grant => grant.operation === 'crm.entitlements.read')
            ? crmIntegrationResourceSelection(integration, 'crm.entitlements.read', 'planIds') : []) : 'all'
          return { ...output, ...(await store.listProviderReceipts(workspaceId, { ...pagination(), orderId: command.orderId, entitlementId: command.entitlementId, state: command.state,
            ...(events === 'all' ? {} : { allowedEventIds: events }), ...(plans === 'all' ? {} : { allowedPlanIds: plans }) })) }
        }
        case 'retry_provider_receipt': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A workspace owner or admin is required to retry provider evidence.')
          }
          return { ...output, ...(await store.resolveProviderReceipt(workspaceId, command.receiptId, dbActor)) }
        }
        case 'list_membership_rescues': {
          requireFinanceReviewer()
          return { ...output, ...(await store.listMembershipRescues(workspaceId, { ...pagination(), contactId: command.contactId,
            planId: command.planId, status: command.status })) }
        }
        case 'create_membership_rescue': {
          requireFinanceReviewer()
          return { ...output, ...(await store.createMembershipRescue(workspaceId, command.rescue, dbActor)) }
        }
        case 'settle_membership_rescue': {
          requireFinanceReviewer()
          return { ...output, ...(await store.settleMembershipRescue(workspaceId, command.rescueId, command.settlement, dbActor)) }
        }
        case 'reverse_membership_rescue': {
          requireFinanceReviewer()
          return { ...output, ...(await store.reverseMembershipRescue(workspaceId, command.rescueId, command.reversal, dbActor)) }
        }
        case 'cancel_membership_rescue': {
          requireFinanceReviewer()
          return { ...output, ...(await store.cancelMembershipRescue(workspaceId, command.rescueId, command.cancellation, dbActor)) }
        }
        case 'create_order': return { ...output, ...(await store.createOrder(workspaceId, command.order, dbActor)) }
        case 'get_order': {
          const record = await store.getOrder(workspaceId, command.orderId, dbActor)
          if (!record) throw new AssociationError('not_found', 'order not found')
          return { ...output, record }
        }
        case 'list_orders':
        case 'module_blockers': {
          const selected = integration ? crmIntegrationResourceSelection(integration, 'association.read', 'eventIds') : 'all'
          const page = await store.listOrders(workspaceId, { ...pagination(),
            ...(command.kind === 'module_blockers' ? { status: 'pending' as const }
              : { eventId: command.eventId, status: command.status, contactId: command.contactId }),
            ...(selected === 'all' ? {} : { allowedEventIds: selected }),
          })
          return { ...output, items: page.items, nextCursor: page.nextCursor,
            ...(command.kind === 'module_blockers' ? { pendingOrders: page.total } : { financialSummary: page.financialSummary }) }
        }
        case 'expire_due_order': return { ...output, ...(await store.expireDueOrder(workspaceId,command.orderId,dbActor)) }
        case 'cancel_order': return { ...output, ...(await store.cancelOrder(workspaceId, command.orderId, dbActor)) }
        case 'confirm_free_order': return { ...output, ...(await store.confirmFreeOrder(workspaceId, command.orderId, dbActor)) }
        case 'bind_order_provider':
        case 'reconcile_provider_entitlement':
        case 'reconcile_provider_financial_event':
        case 'reconcile_provider_event': {
          if (!authority.canReconcileProvider || !['brain_key', 'oauth_token', 'integration_key', 'provider', 'system_job'].includes(context.actor.kind)) {
            throw new CrmOperationsError('not_authorized', 'Verified backend payment evidence is required; member and assistant commands cannot mark a checkout paid.')
          }
          if (context.actor.kind === 'provider' && (command.kind === 'bind_order_provider' || context.actor.provider !== command.event.provider || context.actor.eventId !== command.event.eventId)) {
            throw new CrmOperationsError('not_authorized', 'Provider evidence does not match the authenticated provider event.')
          }
          return { ...output, ...(command.kind === 'bind_order_provider'
            ? await store.bindOrderProvider(workspaceId, command.orderId, command.binding, dbActor)
            : command.kind === 'reconcile_provider_entitlement' ? await store.reconcileProviderEntitlement(workspaceId, command.event, dbActor)
            : command.kind === 'reconcile_provider_financial_event' ? await store.reconcileProviderFinancialEvent(workspaceId, command.orderId, command.event, dbActor)
            : await store.reconcileProviderEvent(workspaceId, command.orderId, command.event, dbActor)) }
        }
        case 'list_registrations': return { ...output, ...(await store.listEventRegistrations(workspaceId, command.eventId, { ...pagination(), status: command.status })) }
        case 'list_operational_roster': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A workspace owner or admin is required to export an operational event roster.')
          }
          return { ...output, ...(await store.listOperationalRoster(workspaceId, command.eventId, pagination())) }
        }
        case 'update_registration': {
          const management = await store.getRegistrationManagement(workspaceId, command.registrationId)
          if (!management) throw new AssociationError('not_found', 'registration not found')
          if (integration) requireCrmIntegrationResources(integration, operation, { eventIds: management.eventId ?? null })
          if (['commerce', 'source_order'].includes(management.sourceKind)) return { ...output, record: await store.updateRegistration(workspaceId, command.registrationId, command.update, dbActor) }
          const result = await options.crmService.execute(context, { kind: 'update_participation', participationId: command.registrationId,
            status: command.update.status === 'checked_in' ? 'attended' : 'cancelled' })
          const { contactId, metadata, ...rest } = result.record
          return { ...output, record: { workspaceId, ...rest, attendeeContactId: contactId ?? null,
            attendeeMetadata: metadata ?? {}, orderId: null, orderLineId: null, ticketId: null,
            reservationExpiresAt: null, status: command.update.status } }
        }
        case 'correct_check_in': {
          if (context.actor.kind !== 'user' || !authority.canConfigure || !['owner', 'admin'].includes(authority.role)) {
            throw new CrmOperationsError('not_authorized', 'A workspace owner or admin is required to correct a check-in.')
          }
          const management = await store.getRegistrationManagement(workspaceId, command.registrationId)
          if (!management) throw new AssociationError('not_found', 'registration not found')
          if (['commerce', 'source_order'].includes(management.sourceKind)) {
            if (command.correction.expectedStatus !== 'checked_in') throw new AssociationError('conflict', 'Commerce check-in correction expects checked_in.')
            return { ...output, record: await store.correctRegistrationCheckIn(workspaceId, command.registrationId, command.correction, dbActor) }
          }
          if (command.correction.expectedStatus !== 'attended') throw new AssociationError('conflict', 'Participation check-in correction expects attended.')
          const result = await options.crmService.execute(context, { kind: 'correct_participation_check_in', participationId: command.registrationId,
            expectedStatus: 'attended', reason: command.correction.reason })
          const { contactId, metadata, ...rest } = result.record
          return { ...output, record: { workspaceId, ...rest, attendeeContactId: contactId ?? null,
            attendeeMetadata: metadata ?? {}, orderId: null, orderLineId: null, ticketId: null,
            reservationExpiresAt: null, status: 'registered' } }
        }
      }
    },
  }
}
