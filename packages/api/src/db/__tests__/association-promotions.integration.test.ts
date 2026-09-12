import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { getAppPool, getPool } from '../client.js'
import { createAssociationStore } from '../association-store.js'
import { createWorkspaceModulesStore } from '../workspace-modules-store.js'
import { EventInputSchema, MembershipInputSchema, OrderCreateSchema, PlanInputSchema, PromotionInputSchema, TicketInputSchema } from '../../association/domain.js'

const { assertLocalFixture } = await import(new URL('../../../../../scripts/crm/local-fixture.mjs', import.meta.url).href)
await assertLocalFixture()
const pool = getPool(), appPool = getAppPool(), modules = createWorkspaceModulesStore()
const promotionHmacKey = 'fictional-promotion-key-for-tests-only'
const commerce = createAssociationStore(pool, undefined, { promotionHmacKey })

async function fixture() {
  const workspaceId = randomUUID(), userId = randomUUID(), buyerId = randomUUID(), secondBuyerId = randomUUID()
  await pool.query('INSERT INTO users(id,auth_provider_id) VALUES($1::uuid,$1::text),($2::uuid,$2::text)', [userId, secondBuyerId])
  await pool.query("INSERT INTO workspaces(id,name,owner_user_id) VALUES($1,'Promotion fixture',$2)", [workspaceId, userId])
  await pool.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'owner')", [workspaceId, userId])
  for (const [id, name] of [[buyerId, 'Fictional buyer'], [secondBuyerId, 'Fictional second buyer']] as const) {
    await pool.query("INSERT INTO entities(id,workspace_id,kind,display_name,created_by_user_id,source) VALUES($1,$2,'person',$3,$4,'manual')",
      [id, workspaceId, name, userId])
  }
  await modules.act(workspaceId, userId, { action: 'enable', expectedVersion: 1 })
  const actor = { credentialKind: 'user' as const, credentialId: userId, actingUserId: userId }
  const event = await commerce.upsertEvent(workspaceId, EventInputSchema.parse({
    slug: `promotion-${workspaceId.slice(0, 8)}`, title: 'Promotion fixture', startsAt: '2099-01-01T12:00:00Z',
    endsAt: '2099-01-01T14:00:00Z', timezone: 'UTC', mode: 'venue', status: 'published', capacity: 100,
  }), actor)
  const eventId = String(event.record.id)
  const ticket = await commerce.upsertTicket(workspaceId, eventId, TicketInputSchema.parse({
    key: 'standard', name: 'Standard', currency: 'HKD', priceMinor: 1_000, memberPriceMinor: 800,
    status: 'on_sale', capacity: 100, perOrderLimit: 10,
  }), actor)
  const ticketId = String(ticket.record.id)
  const savePromotion = (patch: Record<string, unknown> = {}) => commerce.upsertPromotion(workspaceId, PromotionInputSchema.parse({
    key: 'example', name: 'Example promotion', code: 'Example-10', discountType: 'percentage',
    percentageBasisPoints: 1_000, targetKind: 'event', targetIds: [eventId], status: 'active', ...patch,
  }), actor)
  const order = (contactId = buyerId, key = randomUUID(), patch: Record<string, unknown> = {}) => commerce.createOrder(
    workspaceId,
    OrderCreateSchema.parse({ contactId, idempotencyKey: key, promotionCode: ' example-10 ', lines: [{
      ticketId, quantity: 1, attendees: [{ contactId, name: 'Fictional attendee' }],
    }], ...patch }),
    actor,
  )
  return { workspaceId, userId, buyerId, secondBuyerId, actor, eventId, ticketId, savePromotion, order }
}

describe('[COMP:crm/association-promotions] canonical discount authority', () => {
  afterAll(async () => { await pool.end(); await appPool.end() })

  it('prices a percentage code once, stores no plaintext and replays by normalized code identity', async () => {
    const f = await fixture(), promotion = await f.savePromotion(), key = randomUUID()
    const first = await f.order(f.buyerId, key)
    const replay = await f.order(f.buyerId, key, { promotionCode: 'EXAMPLE-10' })
    expect(first.record).toMatchObject({ subtotalMinor: '1000', discountMinor: '100', totalMinor: '900',
      promotionId: promotion.record.id, promotionSnapshot: { key: 'example', discountMinor: 100,
        applicableLines: [{ ticketId: f.ticketId, discountMinor: 100 }] } })
    expect(first.record).not.toHaveProperty('promotionCode')
    expect(replay.created).toBe(false)
    const stored = (await pool.query('SELECT code_digest FROM association_promotions WHERE workspace_id=$1', [f.workspaceId])).rows[0]
    expect(stored.code_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(first.record)).not.toContain('EXAMPLE-10')
    expect((await pool.query('SELECT state FROM association_promotion_uses WHERE workspace_id=$1', [f.workspaceId])).rows)
      .toEqual([{ state: 'reserved' }])
  })

  it('confirms a fully discounted order canonically and enforces the per-contact cap', async () => {
    const f = await fixture()
    await f.savePromotion({ discountType: 'full', percentageBasisPoints: undefined, maxUsesPerContact: 1 })
    const first = await f.order()
    expect(first.record).toMatchObject({ totalMinor: '0', discountMinor: '1000' })
    await commerce.confirmFreeOrder(f.workspaceId, String(first.record.id), f.actor)
    expect((await pool.query('SELECT state FROM association_promotion_uses WHERE order_id=$1', [first.record.id])).rows[0].state)
      .toBe('redeemed')
    await expect(f.order()).rejects.toMatchObject({ code: 'promotion_exhausted' })
  })

  it('applies approved buy-one-get-one terms only when quantity qualifies', async () => {
    const f = await fixture()
    await f.savePromotion({ discountType: 'buy_x_get_y', percentageBasisPoints: undefined, buyQuantity: 1, getQuantity: 1 })
    await expect(f.order()).rejects.toMatchObject({ code: 'promotion_not_applicable' })
    const order = await f.order(f.buyerId, randomUUID(), { lines: [{ ticketId: f.ticketId, quantity: 2,
      attendees: [{ contactId: f.buyerId, name: 'First' }, { contactId: f.secondBuyerId, name: 'Second' }] }] })
    expect(order.record).toMatchObject({ subtotalMinor: '2000', discountMinor: '1000', totalMinor: '1000' })
  })

  it('serializes the last global use and releases a cancelled reservation', async () => {
    const f = await fixture()
    await f.savePromotion({ maxUses: 1, maxUsesPerContact: null })
    const attempts = await Promise.allSettled([f.order(f.buyerId), f.order(f.secondBuyerId)])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected'))
      .toMatchObject([{ reason: { code: 'promotion_exhausted' } }])
    const accepted = attempts.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof f.order>>>
    await commerce.cancelOrder(f.workspaceId, String(accepted.value.record.id), f.actor)
    const replacement = await f.order(f.secondBuyerId)
    expect(replacement.created).toBe(true)
  })

  it('keeps member pricing separate and requires explicit combination', async () => {
    const f = await fixture()
    await f.savePromotion()
    const plan = await commerce.upsertPlan(f.workspaceId, PlanInputSchema.parse({
      key: 'member', name: 'Member', currency: 'HKD', feeMinor: 1_000, billingPeriod: 'annual', published: true,
    }), f.actor)
    await commerce.createMembership(f.workspaceId, MembershipInputSchema.parse({
      contactId: f.buyerId, planId: String(plan.record.id), idempotencyKey: randomUUID(), status: 'active',
      startsAt: '2020-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', renewalMode: 'none',
    }), f.actor)
    await commerce.upsertTicket(f.workspaceId, f.eventId, TicketInputSchema.parse({
      key: 'standard', name: 'Standard', currency: 'HKD', priceMinor: 1_000, memberPriceMinor: 800,
      eligiblePlanKeys: ['member'], eligibilityRequired: false, status: 'on_sale', capacity: 100, perOrderLimit: 10,
    }), f.actor)
    await expect(f.order(f.buyerId, randomUUID(), { lines: [{ ticketId: f.ticketId, quantity: 1,
      useMemberPrice: true, attendees: [{ contactId: f.buyerId, name: 'Fictional buyer' }] }] }))
      .rejects.toMatchObject({ code: 'promotion_not_applicable' })
    await f.savePromotion({ combinesWithMemberPrice: true })
    const combined = await f.order(f.buyerId, randomUUID(), { lines: [{ ticketId: f.ticketId, quantity: 1,
      useMemberPrice: true, attendees: [{ contactId: f.buyerId, name: 'Fictional buyer' }] }] })
    expect(combined.record).toMatchObject({ subtotalMinor: '1000', discountMinor: '280', totalMinor: '720' })
    const other = await commerce.upsertPromotion(f.workspaceId, PromotionInputSchema.parse({
      key: 'wrong-event', name: 'Wrong event', code: 'WRONG-EVENT', discountType: 'full', targetKind: 'event',
      targetIds: [randomUUID()], status: 'active',
    }), f.actor).catch(error => error)
    expect(other).toMatchObject({ code: 'not_found' })
  })
})
