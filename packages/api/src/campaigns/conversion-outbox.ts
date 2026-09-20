/** Durable projection from committed CRM outcomes into campaign conversions. [COMP:campaigns/tracking] */
import { randomUUID } from 'node:crypto'
import { getPool } from '../db/client.js'
import { createCampaignTrackingStore } from '../db/campaign-tracking-store.js'
import { acquireCrmPrivacyWriterAdmission } from '../crm-operations/privacy-admission.js'
import type { CampaignAttributionContext } from '@use-brian/shared/campaigns'

type Lease = { id: string; workspaceId: string; leaseToken: string; attempts: number }
type ProjectionPayload = {
  version: 1
  siteId: string
  conversionKind: 'enquiry_submitted'
  externalOutcomeId: string
  occurredAt: string
  attribution?: CampaignAttributionContext
  contactId: string
  test: boolean
}

export function createCampaignConversionOutboxWorker(options: {
  intervalMs?: number
  onError?: (error: unknown, lease?: Lease) => void
} = {}) {
  const tracking = createCampaignTrackingStore()
  let timer: ReturnType<typeof setInterval> | null = null
  let running: Promise<number> | null = null

  async function leaseOne(): Promise<Lease | null> {
    const leaseToken = randomUUID()
    const result = await getPool().query<Lease>(
      `WITH candidate AS (
         SELECT id FROM campaign_conversion_outbox
          WHERE ((state IN('pending','failed') AND available_at<=clock_timestamp())
             OR (state='leased' AND lease_expires_at<clock_timestamp()))
            AND attempts<20
          ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE campaign_conversion_outbox o
          SET state='leased',lease_token=$1,lease_expires_at=clock_timestamp()+interval '60 seconds',
              attempts=o.attempts+1,updated_at=clock_timestamp(),last_error=NULL
         FROM candidate c WHERE o.id=c.id
       RETURNING o.id,o.workspace_id AS "workspaceId",o.lease_token AS "leaseToken",o.attempts`,
      [leaseToken],
    )
    return result.rows[0] ?? null
  }

  async function project(lease: Lease): Promise<'completed' | 'cancelled' | 'skipped'> {
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await acquireCrmPrivacyWriterAdmission(client, lease.workspaceId)
      const row = await client.query<{ payload: ProjectionPayload }>(
        `SELECT payload FROM campaign_conversion_outbox
          WHERE id=$1 AND workspace_id=$2 AND state='leased' AND lease_token=$3
            AND attempts=$4 AND lease_expires_at>clock_timestamp() FOR UPDATE`,
        [lease.id, lease.workspaceId, lease.leaseToken, lease.attempts],
      )
      const payload = row.rows[0]?.payload
      if (!payload) { await client.query('COMMIT'); return 'skipped' }
      const subject = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM entities WHERE workspace_id=$1 AND id=$2 AND kind='person'
          AND valid_to IS NULL AND retracted_at IS NULL) AS exists`,
        [lease.workspaceId, payload.contactId],
      )
      if (!subject.rows[0]?.exists) {
        await client.query(
          `UPDATE campaign_conversion_outbox SET state='cancelled',payload='{"erased":true}'::jsonb,
             lease_token=NULL,lease_expires_at=NULL,last_error='subject_erased',updated_at=clock_timestamp()
           WHERE id=$1 AND lease_token=$2`, [lease.id, lease.leaseToken],
        )
        await client.query('COMMIT')
        return 'cancelled'
      }
      await tracking.recordCommittedConversion(client, lease.workspaceId, {
        sitePublicId: payload.siteId,
        conversionKind: payload.conversionKind,
        externalOutcomeId: payload.externalOutcomeId,
        occurredAt: payload.occurredAt,
        contactId: payload.contactId,
        attribution: payload.attribution,
        test: payload.test,
      })
      await client.query(
        `UPDATE campaign_conversion_outbox SET state='completed',lease_token=NULL,lease_expires_at=NULL,
           last_error=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2`,
        [lease.id, lease.leaseToken],
      )
      await client.query('COMMIT')
      return 'completed'
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }

  async function fail(lease: Lease): Promise<void> {
    const delay = Math.min(3_600, Math.max(5, 2 ** Math.min(lease.attempts, 11)))
    await getPool().query(
      `UPDATE campaign_conversion_outbox SET state='failed',lease_token=NULL,lease_expires_at=NULL,
         available_at=clock_timestamp()+($3::int*interval '1 second'),last_error='projection_failed',updated_at=clock_timestamp()
       WHERE id=$1 AND state='leased' AND lease_token=$2`,
      [lease.id, lease.leaseToken, delay],
    )
  }

  async function runTick(): Promise<number> {
    let processed = 0
    for (let index = 0; index < 25; index += 1) {
      const lease = await leaseOne()
      if (!lease) break
      try { await project(lease) }
      catch (error) {
        await fail(lease).catch(() => {})
        options.onError?.(error, lease)
      }
      processed += 1
    }
    return processed
  }

  const tick = () => {
    if (running) return running
    running = runTick().finally(() => { running = null })
    return running
  }
  return {
    tick,
    start() {
      if (timer) return
      timer = setInterval(() => void tick().catch(error => options.onError?.(error)), Math.max(1_000, options.intervalMs ?? 5_000))
      timer.unref?.()
      void tick().catch(error => options.onError?.(error))
    },
    stop() { if (timer) clearInterval(timer); timer = null },
  }
}
