/** Frozen, authorized source manifests for all five Feed Review checks. [COMP:feed/draft-review] */
import type { AccessContext } from '@use-brian/core'
import { FEED_REVIEW_DIMENSIONS, FEED_EDITORIAL_LIMITS, type FeedReviewContext, type FeedReviewSource, type FeedReviewCoverage, type FeedReviewDimension } from '@use-brian/shared'
import { projectFeed, walkFeed } from '@use-brian/doc-model'
import { type FeedActor, type FeedScope, type FeedReader, type StructuredFeedContent, readFeedCopy, requireFeedComposition, FeedCollaborationError, withFeedTransaction } from '../db/feed-collaboration-store.js'
import { query } from '../db/client.js'
import { feedEditorialHash } from '../db/feed-editorial-runs-store.js'
import { createContentPlanStore, parseMonthRange } from '../db/content-plan-store.js'
import { getGoalById } from '../db/goals.js'
import { getBrandStore } from '../db/brand-store.js'
import { listMemories } from '../db/memories.js'
import { listActivePlaybookRulesForActor } from '../db/playbook-store.js'
import { loadDecisionPlaybookContext } from '../decision-learning/playbook-context.js'
import { readFeedPostHistory } from './post-history.js'
const source = (id: string, kind: FeedReviewSource['kind'], title: string, value: unknown): FeedReviewSource => { const body = typeof value === 'string' ? value : JSON.stringify(value); return { id, kind, title, body, hash: feedEditorialHash(body) } }
const coverage = (count = 0, state: FeedReviewCoverage['state'] = count ? 'checked' : 'unavailable', limits: string[] = []): FeedReviewCoverage => ({ state, eligible: count, retrieved: count, reviewed: 0, limits })
export function boundFeedReviewSources(sources: FeedReviewSource[], initial: FeedReviewCoverage) {
  let characters = 0; const kept: FeedReviewSource[] = []; const limits = [...initial.limits]
  for (const entry of sources) {
    if (entry.body.length > FEED_EDITORIAL_LIMITS.sourceCharacters || characters + entry.body.length > FEED_EDITORIAL_LIMITS.inputCharacters || kept.length >= FEED_EDITORIAL_LIMITS.sourcesPerCheck) { if (!limits.includes('whole_source_input_limit')) limits.push('whole_source_input_limit'); continue }
    characters += entry.body.length; kept.push(entry)
  }
  return { sources: kept, coverage: { ...initial, retrieved: kept.length, state: kept.length < sources.length ? 'partial' as const : initial.state, limits } }
}
export async function loadFeedReviewContext(actor: FeedActor, options: { month?: string; historyCursor?: number; source?: { revision: number; content: StructuredFeedContent }; now?: Date; additionalHistorySql?: string } = {}): Promise<FeedReviewContext> {
  // Release the session lock before loaders use the ordinary query pool.
  // Otherwise concurrent requests waiting for that lock could consume every
  // connection while the lock holder waits for a source-loader connection.
  const authorized = await withFeedTransaction(actor, async (client, scope) => {
    const copy = options.source ?? await readFeedCopy(client, actor.sessionId)
    if (!copy) throw new FeedCollaborationError(409, 'working_copy_required')
    return { scope, source: { revision: copy.revision, content: requireFeedComposition(copy.content) } }
  })
  return readFeedReviewContext({ query }, authorized.scope, actor, { ...options, source: authorized.source })
}
async function readFeedReviewContext(client: FeedReader, scope: FeedScope, actor: FeedActor, options: { month?: string; historyCursor?: number; source?: { revision: number; content: StructuredFeedContent }; now?: Date; additionalHistorySql?: string } = {}): Promise<FeedReviewContext> {
  const copy = options.source ?? await readFeedCopy(client, actor.sessionId)
  if (!copy) throw new FeedCollaborationError(409, 'working_copy_required')
  const content = requireFeedComposition(copy.content)
  const session = (await client.query(`SELECT s.title,u.timezone,(SELECT scheduled_for::text FROM content_plan_slots WHERE assistant_id=$2 AND session_id=$1 ORDER BY scheduled_for LIMIT 1) AS scheduled FROM sessions s JOIN users u ON u.id=$3 WHERE s.id=$1`, [actor.sessionId, actor.assistantId, actor.userId])).rows[0]
  const platform = /^\[([^\]]+)\]/.exec(session.title)?.[1] ?? 'threads'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: session.timezone || 'UTC', year: 'numeric', month: '2-digit' }).format(options.now ?? new Date())
  const month = options.month ?? content.reviewMonth ?? session.scheduled?.slice(0, 7) ?? today
  if (!parseMonthRange(month)) throw new FeedCollaborationError(400, 'invalid_review_month')
  const dimensions = Object.fromEntries(FEED_REVIEW_DIMENSIONS.map(key => [key, { sources: [], coverage: coverage() }])) as unknown as FeedReviewContext['dimensions']
  const composition = source(`composition:${actor.sessionId}:${copy.revision}`, 'composition', content.title, projectFeed(content.composition).text)
  const hasImages = walkFeed(content.composition).some(item => item.node.type === 'image')
  dimensions.content = { sources: [composition], coverage: coverage(1, hasImages ? 'partial' : 'checked', ['external_facts_unverified', ...(hasImages ? ['image_visuals_not_checked'] : [])]) }
  const members = (await client.query<{ userId: string; clearance: AccessContext['clearance']; compartments: string[] | null }>('SELECT user_id AS "userId",clearance,compartments FROM workspace_members WHERE workspace_id=$1 FOR SHARE', [scope.workspaceId])).rows
  let brandId: string | null = null
  try {
    const brand = await getBrandStore().get(actor.userId, scope.workspaceId)
    const ranks = ['public', 'internal', 'confidential', 'restricted']
    if (brand?.activeRecord && members.every(member => ranks.indexOf(member.clearance ?? 'internal') >= ranks.indexOf(brand.sensitivity)) && ranks.indexOf(scope.clearance) >= ranks.indexOf(brand.sensitivity)) {
      brandId = brand.id
      dimensions.memory.sources.push(source(`brand:${brand.id}:${brand.activeVersionId}`, 'brand', brand.name, brand.activeRecord))
    }
  } catch { dimensions.memory.coverage = coverage(0, 'partial', ['brand_read_failed']) }
  // The existing brand binding is the approved workspace default. Without it,
  // do not assume that another Feed assistant represents this same brand.
  const historyAssistantIds = brandId ? (await client.query<{ id: string }>(`SELECT id FROM assistants WHERE workspace_id=$1 AND kind='app' AND app_type='distribution' AND (id=$2 OR EXISTS (SELECT 1 FROM assistant_capabilities ac WHERE ac.assistant_id=assistants.id AND ac.capability='brand' AND ac.revoked_at IS NULL)) ORDER BY id`, [scope.workspaceId, actor.assistantId])).rows.map(row => row.id) : [actor.assistantId]
  const tasks: [FeedReviewDimension, () => Promise<void>][] = [
    ['monthly_plan', async () => {
      const store = createContentPlanStore(); const brief = await store.getBrief(actor.assistantId, month); const slots = await store.listSlots({ assistantId: actor.assistantId, month })
      const sources = [...(brief && (brief.brief || brief.themes.length) ? [source(`plan:${actor.assistantId}:${month}`, 'plan', month, brief)] : []), ...slots.map(slot => ({ ...source(`slot:${slot.id}`, 'plan', slot.title, slot), date: slot.scheduledFor, state: slot.status === 'posted' ? 'published' as const : 'planned' as const }))]
      dimensions.monthly_plan = { sources, coverage: coverage(sources.length) }
    }],
    ['post_goal', async () => {
      if (!content.goalId) { dimensions.post_goal.coverage = coverage(0, 'unavailable', ['no_linked_goal']); return }
      const goal = await getGoalById(actor.userId, content.goalId)
      if (!goal || goal.workspaceId !== scope.workspaceId) { dimensions.post_goal.coverage = coverage(0, 'unavailable', ['linked_goal_unavailable']); return }
      dimensions.post_goal = { sources: [source(`goal:${goal.id}`, 'goal', goal.outcome, goal)], coverage: coverage(1) }
    }],
    ['post_history', async () => { dimensions.post_history = await readFeedPostHistory(client, { workspaceId: scope.workspaceId, assistantIds: historyAssistantIds, sessionId: actor.sessionId, text: composition.body, cursor: options.historyCursor, additionalHistorySql: options.additionalHistorySql }); if (!brandId) dimensions.post_history.coverage.limits.push('brand_unbound_current_feed_only') }],
    ['memory', async () => {
      const contexts = members.map(member => ({ workspaceId: scope.workspaceId, userId: member.userId, assistantId: actor.assistantId, assistantKind: 'app' as const, clearance: member.clearance, compartments: member.compartments }))
      contexts.push({ workspaceId: scope.workspaceId, userId: actor.userId, assistantId: actor.assistantId, assistantKind: 'app', clearance: scope.clearance as AccessContext['clearance'], compartments: scope.compartments })
      const lists = await Promise.all(contexts.map(ctx => listMemories(ctx, { limit: FEED_EDITORIAL_LIMITS.sourcesPerCheck })))
      const visible = lists[0]!.memories.filter(memory => !memory.retractedAt && lists.every(list => list.memories.some(other => other.id === memory.id)))
      const rules = await listActivePlaybookRulesForActor({ assistantId: actor.assistantId, actorUserId: actor.userId, externalPrincipal: false })
      const sharedRules = rules.filter(rule => (rule.appliesToUserId === null || members.every(member => member.userId === rule.appliesToUserId)) && ['public', 'internal', 'confidential', 'restricted'].indexOf(rule.decisionSensitivity) <= Math.min(...members.map(member => ['public', 'internal', 'confidential', 'restricted'].indexOf(member.clearance ?? 'internal'))))
      const playbook = await loadDecisionPlaybookContext({ workspaceId: scope.workspaceId, assistantId: actor.assistantId, actorUserId: actor.userId, externalPrincipal: false, allowedRuleIds: sharedRules.map(rule => rule.id), recordApplication: false, applicability: { kind: 'tool', key: `feed:${platform}` }, operationKind: 'feed_review', operationId: actor.sessionId, logLabel: 'feed-review' })
      const selectedRules = sharedRules.filter(rule => playbook.playbookRules.includes(rule.rule.trim()))
      dimensions.memory.sources.push(...visible.map(memory => source(`memory:${memory.id}`, 'memory', memory.summary, { summary: memory.summary, detail: memory.detail, tags: memory.tags })), ...selectedRules.map(rule => source(`playbook:${rule.id}`, 'playbook', 'Approved preference', rule.rule)))
      const limits = [...dimensions.memory.coverage.limits]; if (lists.some(list => list.total > visible.length) || selectedRules.length < rules.length) limits.push('private_or_bounded_sources_omitted')
      dimensions.memory.coverage = { ...coverage(dimensions.memory.sources.length, limits.length ? 'partial' : dimensions.memory.sources.length ? 'checked' : 'unavailable', limits), eligible: dimensions.memory.sources.length }
    }],
  ]
  await Promise.all(tasks.map(async ([key, read]) => { try { await read() } catch { dimensions[key] = { sources: [], coverage: coverage(0, 'failed', ['source_read_failed']) } } }))
  for (const key of FEED_REVIEW_DIMENSIONS) dimensions[key] = boundFeedReviewSources(dimensions[key].sources, dimensions[key].coverage)
  const context = { historyCursor: options.historyCursor ?? 0, version: 1 as const, revision: copy.revision, composition: content.composition, platform, month, goalId: content.goalId ?? null, brandId, historyAssistantIds, dimensions }
  return { ...context, contextHash: feedEditorialHash(context) }
}

export type FeedReviewContextLoader = typeof loadFeedReviewContext
export function createFeedReviewContextLoader(additionalHistorySql?: string): FeedReviewContextLoader {
  return (actor, options = {}) => loadFeedReviewContext(actor, { ...options, additionalHistorySql })
}
