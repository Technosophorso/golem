/** Pure native-campaign attribution and metric semantics. [COMP:campaigns/attribution] */
import {
  CAMPAIGN_ATTRIBUTION_RULE_VERSION,
  CAMPAIGN_LIMITS,
  type CampaignUtm,
} from '@use-brian/shared/campaigns'

export type CampaignTouch = Readonly<{
  eventId: string
  linkId?: string
  siteId: string
  occurredAt: string
  utm?: Partial<CampaignUtm>
  acquisitionEvidence: 'browser_observed' | 'server_trusted' | 'crm_committed'
  internalNavigation?: boolean
  direct?: boolean
}>

export type CampaignAttributionSnapshot = Readonly<{
  ruleVersion: number
  lookbackDays: number
  conversionAt: string
  state: 'attributed' | 'unattributed'
  firstTouch: CampaignTouch | null
  lastTouch: CampaignTouch | null
  acquisitionEvidence: CampaignTouch['acquisitionEvidence'] | null
  limitation: string
}>

export function normalizeBrowserOccurredAt(input: string, receivedAt: Date): Date {
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) return receivedAt
  const futureLimit = receivedAt.getTime() + 5 * 60_000
  const pastLimit = receivedAt.getTime() - CAMPAIGN_LIMITS.rawRetentionDays * 24 * 60 * 60_000
  return new Date(Math.min(futureLimit, Math.max(pastLimit, parsed.getTime())))
}

export function classifyCampaignRequest(userAgent: string | undefined): 'known_automated' | 'unknown' | 'observed_browser' {
  if (!userAgent?.trim()) return 'unknown'
  if (/(bot|crawler|spider|preview|slackbot|discordbot|facebookexternalhit|linkedinbot|curl|wget)/i.test(userAgent)) {
    return 'known_automated'
  }
  if (/(mozilla\/|applewebkit|chrome\/|safari\/|firefox\/)/i.test(userAgent)) return 'observed_browser'
  return 'unknown'
}

export function selectCampaignAttribution(
  touches: readonly CampaignTouch[],
  conversionAtInput: string,
  lookbackDays = CAMPAIGN_LIMITS.attributionLookbackDays,
): CampaignAttributionSnapshot {
  const conversionAt = new Date(conversionAtInput)
  const oldest = conversionAt.getTime() - lookbackDays * 24 * 60 * 60_000
  const eligible = touches.filter((touch) => {
    const time = Date.parse(touch.occurredAt)
    return Number.isFinite(time)
      && time >= oldest
      && time <= conversionAt.getTime() + 5 * 60_000
      && !touch.internalNavigation
      && !touch.direct
      && Boolean(touch.linkId || touch.utm?.source)
  }).sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
  const firstTouch = eligible[0] ?? null
  const lastTouch = eligible.at(-1) ?? null
  return {
    ruleVersion: CAMPAIGN_ATTRIBUTION_RULE_VERSION,
    lookbackDays,
    conversionAt: conversionAt.toISOString(),
    state: firstTouch ? 'attributed' : 'unattributed',
    firstTouch,
    lastTouch,
    acquisitionEvidence: lastTouch?.acquisitionEvidence ?? firstTouch?.acquisitionEvidence ?? null,
    limitation: firstTouch
      ? 'Observed acquisition association; this is not proof of causal credit.'
      : 'No eligible external campaign evidence was observed within the lookback window.',
  }
}

export function campaignConversionRate(input: {
  verifiedConversions: number
  sessions: number | null
}): { value: number | null; denominator: 'sessions' | 'unavailable'; limitation?: string } {
  if (input.sessions === null) {
    return { value: null, denominator: 'unavailable', limitation: 'Session continuity is unavailable.' }
  }
  return { value: input.sessions === 0 ? 0 : input.verifiedConversions / input.sessions, denominator: 'sessions' }
}
