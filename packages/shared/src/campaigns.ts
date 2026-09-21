/**
 * Portable native-campaign contracts shared by Feed, CRM, the collector, and
 * Brian tools. Keep this module browser-safe. [COMP:campaigns/contracts]
 */
import { z } from 'zod'

export const CAMPAIGN_CONTRACT_VERSION = 1 as const
export const CAMPAIGN_ATTRIBUTION_RULE_VERSION = 1 as const
export const CAMPAIGN_LIMITS = {
  version: 1,
  broadcastRecipients: 500,
  senderHandoffsPerMinute: 10,
  rawRetentionDays: 90,
  aggregateRetentionMonths: 13,
  attributionLookbackDays: 30,
  visitorLifetimeDays: 30,
  sessionInactivityMinutes: 30,
  eventBytes: 16 * 1024,
  metadataBytes: 8 * 1024,
  metadataKeys: 32,
  originsPerSite: 32,
  conversionDefinitionsPerSite: 32,
  personalizationFields: 16,
  urlCharacters: 2_048,
} as const

export const campaignUuidSchema = z.string().uuid()
export const campaignOpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/)
export const campaignStableKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,79}$/)
export const campaignHttpUrlSchema = z.string().max(CAMPAIGN_LIMITS.urlCharacters).url()
  .refine((value) => {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username && !url.password
      && !/[\u0000-\u001f\u007f]/.test(value)
  }, 'A credential-free HTTP(S) URL is required')

export const CAMPAIGN_CHANNELS = ['instagram', 'threads', 'twitter', 'xhs', 'linkedin', 'email'] as const
export const campaignChannelSchema = z.enum(CAMPAIGN_CHANNELS)
export type CampaignChannel = z.infer<typeof campaignChannelSchema>

export type CampaignChannelCapability = Readonly<{
  id: CampaignChannel
  label: string
  authoring: true
  delivery: 'manual_or_provider' | 'smtp'
  providerConnectionRequired: false
  supportsSubject: boolean
  supportsAudience: boolean
  supportsReplyTo: boolean
  utmSource: string
  utmMedium: 'organic_social' | 'email'
}>

export const CAMPAIGN_CHANNEL_CAPABILITIES: Readonly<Record<CampaignChannel, CampaignChannelCapability>> = {
  instagram: { id: 'instagram', label: 'Instagram', authoring: true, delivery: 'manual_or_provider', providerConnectionRequired: false, supportsSubject: false, supportsAudience: false, supportsReplyTo: false, utmSource: 'instagram', utmMedium: 'organic_social' },
  threads: { id: 'threads', label: 'Threads', authoring: true, delivery: 'manual_or_provider', providerConnectionRequired: false, supportsSubject: false, supportsAudience: false, supportsReplyTo: false, utmSource: 'threads', utmMedium: 'organic_social' },
  twitter: { id: 'twitter', label: 'X', authoring: true, delivery: 'manual_or_provider', providerConnectionRequired: false, supportsSubject: false, supportsAudience: false, supportsReplyTo: false, utmSource: 'twitter', utmMedium: 'organic_social' },
  xhs: { id: 'xhs', label: 'XHS', authoring: true, delivery: 'manual_or_provider', providerConnectionRequired: false, supportsSubject: false, supportsAudience: false, supportsReplyTo: false, utmSource: 'xhs', utmMedium: 'organic_social' },
  linkedin: { id: 'linkedin', label: 'LinkedIn', authoring: true, delivery: 'manual_or_provider', providerConnectionRequired: false, supportsSubject: false, supportsAudience: false, supportsReplyTo: false, utmSource: 'linkedin', utmMedium: 'organic_social' },
  email: { id: 'email', label: 'Email', authoring: true, delivery: 'smtp', providerConnectionRequired: false, supportsSubject: true, supportsAudience: true, supportsReplyTo: true, utmSource: 'newsletter', utmMedium: 'email' },
}

/** Compatibility adapter: URLs and storage keep `twitter`; display copy says X. */
export function campaignChannelFromWire(value: unknown): CampaignChannel | null {
  if (value === 'x') return 'twitter'
  const parsed = campaignChannelSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const campaignStateSchema = z.enum(['draft', 'active', 'completed', 'archived'])
export const campaignPlacementKindSchema = z.enum(['body', 'first_comment', 'profile', 'email_body'])
export const campaignConversionKindSchema = z.enum(['signup_completed', 'enquiry_submitted', 'activation_completed'])
export const campaignStorageModeSchema = z.enum(['none', 'first_party'])
export const campaignEvidenceSchema = z.enum(['browser_observed', 'server_trusted', 'crm_committed'])
export const campaignBotClassSchema = z.enum(['known_automated', 'unknown', 'observed_browser'])
export const campaignEventTypeSchema = z.enum(['page_view', 'cta_clicked', 'form_started', 'conversion_hint', 'redirect_request'])
export const campaignReportStateSchema = z.enum(['not_installed', 'disabled', 'unsupported', 'delayed', 'failed', 'empty', 'available'])

export const campaignUtmSchema = z.object({
  source: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  medium: z.string().trim().min(1).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  campaign: z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9_-]*$/),
  content: z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9_-]*$/),
  term: z.string().trim().min(1).max(200).regex(/^[a-z0-9][a-z0-9_-]*$/).optional(),
}).strict()
export type CampaignUtm = z.infer<typeof campaignUtmSchema>

const boundedMetadataSchema = z.record(z.string().max(80), z.union([
  z.string().max(2_000), z.number().finite(), z.boolean(), z.null(),
])).superRefine((value, ctx) => {
  if (Object.keys(value).length > CAMPAIGN_LIMITS.metadataKeys) {
    ctx.addIssue({ code: 'custom', message: 'Too many metadata fields' })
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > CAMPAIGN_LIMITS.metadataBytes) {
    ctx.addIssue({ code: 'custom', message: 'Metadata is too large' })
  }
})

export const campaignBrowserEventSchema = z.object({
  version: z.literal(CAMPAIGN_CONTRACT_VERSION),
  eventId: campaignOpaqueIdSchema,
  siteId: campaignOpaqueIdSchema,
  type: campaignEventTypeSchema.exclude(['redirect_request']),
  occurredAt: z.string().datetime({ offset: true }),
  linkId: campaignOpaqueIdSchema.optional(),
  sessionId: campaignOpaqueIdSchema.optional(),
  visitorId: campaignOpaqueIdSchema.optional(),
  pagePath: z.string().min(1).max(500).regex(/^\//),
  referrerOrigin: z.string().url().max(500).optional(),
  utm: campaignUtmSchema.partial().optional(),
  test: z.boolean().default(false),
  metadata: boundedMetadataSchema.default({}),
}).strict().superRefine((event, ctx) => {
  if (event.type === 'conversion_hint' && !event.metadata.conversion_kind) {
    ctx.addIssue({ code: 'custom', path: ['metadata', 'conversion_kind'], message: 'conversion_kind is required for a conversion hint' })
  }
  if ((event.sessionId === undefined) !== (event.visitorId === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Session and visitor continuity must be supplied together' })
  }
})
export type CampaignBrowserEvent = z.infer<typeof campaignBrowserEventSchema>

export const campaignAttributionContextSchema = z.object({
  version: z.literal(CAMPAIGN_CONTRACT_VERSION),
  linkId: campaignOpaqueIdSchema.optional(),
  siteId: campaignOpaqueIdSchema.optional(),
  sessionId: campaignOpaqueIdSchema.optional(),
  firstObservedAt: z.string().datetime({ offset: true }).optional(),
  latestObservedAt: z.string().datetime({ offset: true }).optional(),
  utm: campaignUtmSchema.partial().optional(),
}).strict()
export type CampaignAttributionContext = z.infer<typeof campaignAttributionContextSchema>

export const campaignTrustedConversionSchema = z.object({
  version: z.literal(CAMPAIGN_CONTRACT_VERSION),
  siteId: campaignOpaqueIdSchema,
  conversionKind: campaignConversionKindSchema,
  externalOutcomeId: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime({ offset: true }),
  attribution: campaignAttributionContextSchema.optional(),
  subject: z.object({ kind: z.enum(['contact', 'application_subject']), id: z.string().uuid() }).strict().optional(),
  valueMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  test: z.boolean().default(false),
  metadata: boundedMetadataSchema.default({}),
}).strict().refine((value) => (value.valueMinor === undefined) === (value.currency === undefined), {
  message: 'valueMinor and currency must be supplied together', path: ['valueMinor'],
})
export type CampaignTrustedConversion = z.infer<typeof campaignTrustedConversionSchema>

export const campaignAllowedOriginSchema = z.string().url().max(500).refine((value) => {
  const url = new URL(value)
  return ['http:', 'https:'].includes(url.protocol)
    && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash
}, 'An HTTP(S) origin without a path, query, credentials, or fragment is required')

export const campaignSiteSaveObjectSchema = z.object({
  siteId: campaignUuidSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(200),
  allowedOrigins: z.array(campaignAllowedOriginSchema).min(1).max(CAMPAIGN_LIMITS.originsPerSite),
  conversionDefinitions: z.array(z.object({
    key: campaignConversionKindSchema,
    label: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
  }).strict()).max(CAMPAIGN_LIMITS.conversionDefinitionsPerSite),
  storageMode: campaignStorageModeSchema,
  cookieDomain: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/).nullable().optional(),
  siteGroupKey: campaignStableKeySchema.nullable().optional(),
  rawRetentionDays: z.number().int().min(1).max(CAMPAIGN_LIMITS.rawRetentionDays).default(CAMPAIGN_LIMITS.rawRetentionDays),
  aggregateRetentionMonths: z.number().int().min(1).max(CAMPAIGN_LIMITS.aggregateRetentionMonths).default(CAMPAIGN_LIMITS.aggregateRetentionMonths),
}).strict()
export const campaignSiteSaveSchema = campaignSiteSaveObjectSchema.superRefine((value, ctx) => {
  if (value.storageMode === 'first_party' && value.cookieDomain && !value.siteGroupKey) {
    ctx.addIssue({ code: 'custom', path: ['siteGroupKey'], message: 'A shared cookie domain requires a site group key' })
  }
  if (new Set(value.allowedOrigins).size !== value.allowedOrigins.length) {
    ctx.addIssue({ code: 'custom', path: ['allowedOrigins'], message: 'Allowed origins must be unique' })
  }
  if (new Set(value.conversionDefinitions.map(item => item.key)).size !== value.conversionDefinitions.length) {
    ctx.addIssue({ code: 'custom', path: ['conversionDefinitions'], message: 'Conversion definitions must be unique' })
  }
})
export type CampaignSiteSave = z.infer<typeof campaignSiteSaveSchema>

export const CAMPAIGN_PERSONALIZATION_FIELDS = ['first_name', 'last_name', 'display_name', 'company_name'] as const
export const campaignPersonalizationFieldSchema = z.enum(CAMPAIGN_PERSONALIZATION_FIELDS)
export const campaignPersonalizationSpecSchema = z.object({
  field: campaignPersonalizationFieldSchema,
  required: z.boolean().default(false),
  fallback: z.string().max(500).optional(),
}).strict().refine((value) => !value.required || value.fallback === undefined, 'Required fields cannot have a fallback')

export const campaignEmailMetadataSchema = z.object({
  subject: z.string().trim().min(1).max(998).refine(value => !/[\r\n\0]/.test(value), 'Email subject cannot contain control lines'),
  preheader: z.string().max(500).refine(value => !/[\r\n\0]/.test(value), 'Email preheader cannot contain control lines').optional(),
  senderId: campaignUuidSchema,
  replyTo: z.string().email().max(320).optional(),
  audience: z.object({ segmentId: campaignUuidSchema, segmentVersion: z.number().int().positive() }).strict(),
  purposeKey: campaignStableKeySchema,
  personalization: z.array(campaignPersonalizationSpecSchema).max(CAMPAIGN_LIMITS.personalizationFields).default([]),
  tracking: z.object({ links: z.boolean().default(true), website: z.boolean().default(true) }).strict(),
}).strict()
export type CampaignEmailMetadata = z.infer<typeof campaignEmailMetadataSchema>

export const campaignSaveObjectSchema = z.object({
  campaignId: campaignUuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(5_000),
  timezone: z.string().trim().min(1).max(100),
  primaryConversion: campaignConversionKindSchema,
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
}).strict()
export const campaignSaveSchema = campaignSaveObjectSchema.refine(
  (value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt,
  'endsAt must be after startsAt',
)

export const campaignAttachContentSchema = z.object({
  campaignId: campaignUuidSchema,
  sessionId: campaignUuidSchema,
  channel: campaignChannelSchema,
  placementKind: campaignPlacementKindSchema,
  placementKey: campaignStableKeySchema,
}).strict()

export const campaignCreateLinkSchema = z.object({
  campaignId: campaignUuidSchema,
  placementId: campaignUuidSchema,
  destination: campaignHttpUrlSchema,
  utm: campaignUtmSchema,
  existingAttribution: z.enum(['reject', 'replace', 'retain']).default('reject'),
}).strict()

export const campaignManualPublicationSchema = z.object({
  placementId: campaignUuidSchema,
  permalink: campaignHttpUrlSchema,
  publishedAt: z.string().datetime({ offset: true }),
  approvedRevision: z.number().int().nonnegative(),
}).strict()

export const campaignSetLinkEnabledSchema = z.object({
  linkId: campaignUuidSchema,
  enabled: z.boolean(),
}).strict()

export const campaignCommandEnvelopeSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedVersion: z.number().int().positive().optional(),
}).strict()
export type CampaignCommandEnvelope = z.infer<typeof campaignCommandEnvelopeSchema>

export const campaignDispatchStateSchema = z.enum(['draft', 'ready', 'scheduled', 'sending', 'paused', 'completed', 'cancelled', 'needs_attention'])
export const campaignRecipientStateSchema = z.enum(['pending', 'suppressed', 'admitted', 'accepted', 'rejected', 'uncertain', 'cancelled'])

export const campaignPrepareDispatchSchema = z.object({
  campaignId: campaignUuidSchema,
  placementId: campaignUuidSchema,
  approvedRevision: z.number().int().nonnegative(),
  metadata: campaignEmailMetadataSchema,
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  recipients: z.array(z.object({
    contactId: campaignUuidSchema,
    address: z.string().email().max(320),
    personalization: z.record(z.string(), z.string().max(2_000)).default({}),
    eligibility: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(CAMPAIGN_LIMITS.broadcastRecipients),
}).strict()

export type CampaignReportMetric = Readonly<{
  redirectRequests: number
  pageViews: number
  sessions: number | null
  visitors: number | null
  verifiedConversions: number
  leads: number
  deals: number
  emailAccepted: number
}>

export type CampaignAttributionTouch = Readonly<{
  linkId: string | null
  siteId: string | null
  channel: CampaignChannel | null
  occurredAt: string
  evidence: 'browser_observed' | 'server_trusted' | 'crm_committed'
  internal: boolean
}>

export type CampaignAttributionSnapshot = Readonly<{
  version: typeof CAMPAIGN_ATTRIBUTION_RULE_VERSION
  lookbackDays: number
  conversionAt: string
  firstTouch: CampaignAttributionTouch | null
  lastTouch: CampaignAttributionTouch | null
  acquisitionEvidence: 'browser_observed' | 'server_trusted' | 'crm_committed' | 'none'
  conversionEvidence: 'server_trusted' | 'crm_committed'
  unattributed: boolean
}>
