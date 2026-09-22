/** Published programme content shared by staff, assistants and websites. No commerce record. [COMP:crm/programme-catalogue] */
import { z } from 'zod'
import { MembershipLocaleSchema, MembershipSiteSchema } from './membership-catalogue.js'

export const PROGRAMME_AUDIENCES = ['corporates', 'schools', 'students'] as const
/** Photo sets the websites own under public/media/gallery; a new set is a website release first. */
export const PROGRAMME_GALLERY_KEYS = ['spacebiz-dialogues', 'young-marco-polo', 'internship', 'space-exchange-tour', 'newspace-101', 'annual-conference'] as const
export const ProgrammeAudienceSchema = z.enum(PROGRAMME_AUDIENCES)
export const ProgrammeGallerySchema = z.enum(PROGRAMME_GALLERY_KEYS)
const text = z.string().trim().max(20_000)
const key = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/)
const href = z.string().max(2000).refine(value => !value.includes('\\') && (/^https:\/\/[^\s]+$/.test(value) || /^\/(?!\/)[^\s]*$/.test(value)), 'Use an HTTPS or site-relative link')
export const ProgrammeLinkSchema = z.object({ label: text, href }).strict()
const quote = z.object({ text, cite: text }).strict()
const subsection = z.object({ id: key, heading: text, paragraphs: z.array(text).max(100).default([]), bullets: z.array(text).max(100).default([]), numbered: z.array(text).max(100).default([]), quote: quote.optional() }).strict()
export const ProgrammeSectionSchema = subsection.extend({ subsections: z.array(subsection).max(40).default([]) }).strict()
export const ProgrammeCopySchema = z.object({
  name: z.string().trim().max(200), tagline: text.default(''), kicker: text.default(''), summary: text,
  audienceBlurbs: z.object({ corporates: text.optional(), schools: text.optional(), students: text.optional() }).strict().default({}),
  sections: z.array(ProgrammeSectionSchema).max(40).default([]),
  facts: z.array(z.object({ value: text, label: text }).strict()).max(12).default([]),
  steps: z.object({ title: text, items: z.array(z.object({ title: text, text }).strict()).max(20) }).strict().nullable().default(null),
  feeUnit: text.default(''), feeNotes: z.array(text).max(20).default([]),
  eligibility: z.array(z.object({ label: text, value: text }).strict()).max(20).default([]),
  contacts: z.array(z.object({ label: text, name: text.optional(), email: z.string().trim().email().max(320) }).strict()).max(10).default([]),
  links: z.array(ProgrammeLinkSchema).max(30).default([]),
  cta: z.object({ heading: text, text: text.default(''), href, label: text, secondary: ProgrammeLinkSchema.optional() }).strict().nullable().default(null),
}).strict()
export const WebsiteProgrammeSchema = z.object({
  slug: key, audiences: z.array(ProgrammeAudienceSchema).min(1).max(3), order: z.number().int().min(0).max(10000),
  sites: z.array(MembershipSiteSchema).min(1).max(2).default(['oasa']),
  status: z.enum(['live', 'coming-soon', 'retired']).default('live'),
  fee: z.object({ currency: z.literal('HKD'), amountMinor: z.number().int().min(0).max(100_000_000) }).strict().nullable().default(null),
  gallery: ProgrammeGallerySchema.nullable().default(null),
  cover: z.string().regex(/^\/media\/gallery\/[a-z0-9-]+\/[a-z0-9-]+\.jpg$/).nullable().default(null),
  href: href.nullable().default(null),
  i18n: z.object({ en: ProgrammeCopySchema, 'zh-Hant': ProgrammeCopySchema.optional(), 'zh-Hans': ProgrammeCopySchema.optional() }).strict(),
}).strict()
export const ProgrammeCatalogueDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  audiences: z.object({
    corporates: z.object({ gallery: ProgrammeGallerySchema, order: z.array(key).max(100).default([]) }).strict(),
    schools: z.object({ gallery: ProgrammeGallerySchema, order: z.array(key).max(100).default([]) }).strict(),
    students: z.object({ gallery: ProgrammeGallerySchema, order: z.array(key).max(100).default([]) }).strict(),
  }).strict(),
  programmes: z.array(WebsiteProgrammeSchema).max(200),
}).strict().superRefine((document, ctx) => {
  if (JSON.stringify(document).length > 2_000_000) ctx.addIssue({ code: 'custom', message: 'Catalogue exceeds 2 MB' })
  const slugs = new Set(document.programmes.map(programme => programme.slug))
  if (slugs.size !== document.programmes.length) ctx.addIssue({ code: 'custom', path: ['programmes'], message: 'Programme slugs must be unique' })
  for (const audience of PROGRAMME_AUDIENCES) for (const slug of document.audiences[audience].order) {
    if (!slugs.has(slug)) ctx.addIssue({ code: 'custom', path: ['audiences', audience, 'order'], message: `Unknown programme ${slug}` })
  }
})
export type ProgrammeCatalogueDocument = z.infer<typeof ProgrammeCatalogueDocumentSchema>
export type WebsiteProgramme = z.infer<typeof WebsiteProgrammeSchema>
export type ProgrammeCopy = z.infer<typeof ProgrammeCopySchema>
export type ProgrammeAudience = z.infer<typeof ProgrammeAudienceSchema>
export const ProgrammeDraftSaveSchema = z.object({ expectedVersion: z.number().int().nonnegative(), document: ProgrammeCatalogueDocumentSchema }).strict()
export const ProgrammePublishSchema = z.object({ expectedVersion: z.number().int().positive() }).strict()

function copyIssues(programme: WebsiteProgramme, locale: string, copy: ProgrammeCopy, slugs: Set<string>): string[] {
  const issues: string[] = []
  const label = `${programme.slug}/${locale}`
  if (!copy.name.trim() || !copy.summary.trim()) issues.push(`${label}: name and summary required`)
  if (locale === 'en' && (!copy.tagline.trim() || !copy.kicker.trim())) issues.push(`${label}: tagline and kicker required`)
  if (programme.status !== 'coming-soon' && !programme.href && copy.sections.length === 0) issues.push(`${label}: at least one section is required for a live programme page`)
  if (programme.fee && !copy.feeUnit.trim()) issues.push(`${label}: explain what the fee covers (fee unit)`)
  const ids = copy.sections.flatMap(section => [section.id, ...section.subsections.map(sub => `${section.id}/${sub.id}`)])
  if (new Set(ids).size !== ids.length) issues.push(`${label}: duplicate section`)
  for (const section of copy.sections) {
    if (!section.heading.trim()) issues.push(`${label}: section headings required`)
    for (const sub of section.subsections) if (!sub.heading.trim()) issues.push(`${label}: subsection headings required`)
  }
  for (const audience of Object.keys(copy.audienceBlurbs) as ProgrammeAudience[]) {
    if (copy.audienceBlurbs[audience] !== undefined && !programme.audiences.includes(audience)) issues.push(`${label}: audience blurb for ${audience} without that audience`)
  }
  const links = [...copy.links, ...(copy.cta ? [{ label: copy.cta.label, href: copy.cta.href }, ...(copy.cta.secondary ? [copy.cta.secondary] : [])] : [])]
  for (const link of links) {
    if (!link.label.trim()) issues.push(`${label}: link labels required`)
    const match = /^\/programmes\/([a-z0-9-]+)\/?(?:[?#].*)?$/.exec(link.href)
    if (match && !slugs.has(match[1]!)) issues.push(`${label}: link to unknown programme ${match[1]}`)
  }
  if (copy.cta && !copy.cta.heading.trim()) issues.push(`${label}: call-to-action heading required`)
  if (copy.contacts.some(contact => !contact.label.trim())) issues.push(`${label}: contact labels required`)
  return issues
}

/** Drafts may be incomplete. Publication requires complete English copy; a translation, when present, must be complete too. */
export function programmePublicationIssues(document: ProgrammeCatalogueDocument): string[] {
  const issues: string[] = []
  const slugs = new Set(document.programmes.map(programme => programme.slug))
  for (const programme of document.programmes) {
    for (const locale of MembershipLocaleSchema.options) {
      const copy = programme.i18n[locale]
      if (copy) issues.push(...copyIssues(programme, locale, copy, slugs))
    }
    if (programme.cover && programme.gallery && !programme.cover.startsWith(`/media/gallery/${programme.gallery}/`)) issues.push(`${programme.slug}: cover photo must belong to the chosen gallery`)
    if (programme.cover && !programme.gallery) issues.push(`${programme.slug}: choose the gallery the cover photo belongs to`)
    if (programme.href && /^\/programmes\/[a-z0-9-]+\/?$/.test(programme.href)) issues.push(`${programme.slug}: a programme cannot redirect to another programme page`)
  }
  return [...new Set(issues)]
}

export type ProgrammeSite = z.infer<typeof MembershipSiteSchema>
export function resolveProgrammeCatalogue(document: ProgrammeCatalogueDocument, site: ProgrammeSite, includeHidden = false) {
  return {
    audiences: document.audiences,
    programmes: document.programmes.filter(programme => programme.sites.includes(site) && (includeHidden || programme.status !== 'retired'))
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)),
  }
}

/** Copy for a locale, falling back to English; `lang` says which language the text is in. */
export function programmeCopy(programme: WebsiteProgramme, locale: z.infer<typeof MembershipLocaleSchema>): { copy: ProgrammeCopy; lang: 'en' | 'zh-Hant' | 'zh-Hans' } {
  const copy = programme.i18n[locale]
  return copy ? { copy, lang: locale } : { copy: programme.i18n.en, lang: 'en' }
}
