import { describe, it, expect, vi } from 'vitest'
import { ProgrammeCatalogueDocumentSchema, programmeCopy, programmePublicationIssues, resolveProgrammeCatalogue } from '../programme-catalogue.js'
import { createAssociationTools } from '../tools.js'
const en = { name: 'Synthetic programme', tagline: 'A tagline', kicker: 'A kicker', summary: 'Summary', sections: [{ id: 'about', heading: 'About', paragraphs: ['Text'] }] }
export const document = () => ProgrammeCatalogueDocumentSchema.parse({ schemaVersion: 1,
  audiences: { corporates: { gallery: 'spacebiz-dialogues', order: ['synthetic'] }, schools: { gallery: 'space-exchange-tour', order: [] }, students: { gallery: 'young-marco-polo', order: [] } },
  programmes: [
    { slug: 'synthetic', audiences: ['corporates'], order: 1, gallery: 'spacebiz-dialogues', fee: { currency: 'HKD', amountMinor: 120000 }, i18n: { en: { ...en, feeUnit: 'per week' } } },
    { slug: 'retired-one', audiences: ['students'], order: 0, status: 'retired', i18n: { en } },
    { slug: 'elsewhere', audiences: ['students'], order: 2, href: '/ymp', i18n: { en: { ...en, sections: [] } } },
  ] })
describe('[COMP:crm/programme-catalogue] publication contract', () => {
  it('accepts English-only content with typed fees and resolves the site view without retired programmes', () => {
    const doc = document(); expect(programmePublicationIssues(doc)).toEqual([])
    const view = resolveProgrammeCatalogue(doc, 'oasa')
    expect(view.programmes.map(programme => programme.slug)).toEqual(['synthetic', 'elsewhere'])
    expect(resolveProgrammeCatalogue(doc, 'oasa', true).programmes).toHaveLength(3)
    expect(resolveProgrammeCatalogue(doc, 'sea').programmes).toEqual([])
    expect(view.programmes[0]!.fee).toEqual({ currency: 'HKD', amountMinor: 120000 })
  })
  it('falls back to English for a missing translation and says so', () => {
    const doc = document()
    expect(programmeCopy(doc.programmes[0]!, 'zh-Hant')).toMatchObject({ lang: 'en', copy: { name: 'Synthetic programme' } })
    doc.programmes[0]!.i18n['zh-Hant'] = { ...doc.programmes[0]!.i18n.en, name: '合成項目' }
    expect(programmeCopy(doc.programmes[0]!, 'zh-Hant')).toMatchObject({ lang: 'zh-Hant', copy: { name: '合成項目' } })
  })
  it('lets staff save incomplete drafts but blocks publication of half-written pages and translations', () => {
    const doc = document()
    doc.programmes[0]!.i18n['zh-Hant'] = { ...doc.programmes[0]!.i18n.en, name: '' }
    doc.programmes[0]!.i18n.en.feeUnit = ''
    doc.programmes[0]!.i18n.en.sections = []
    doc.programmes[0]!.i18n.en.links = [{ label: 'Missing', href: '/programmes/not-a-programme' }]
    expect(ProgrammeCatalogueDocumentSchema.safeParse(doc).success).toBe(true)
    const issues = programmePublicationIssues(doc).join(' ')
    expect(issues).toContain('synthetic/zh-Hant: name and summary required')
    expect(issues).toContain('fee unit')
    expect(issues).toContain('at least one section')
    expect(issues).toContain('unknown programme not-a-programme')
    const cover = document(); cover.programmes[0]!.cover = '/media/gallery/internship/internship-01.jpg'
    expect(programmePublicationIssues(cover).join(' ')).toContain('cover photo must belong to the chosen gallery')
  })
  it('rejects duplicate slugs, unknown galleries, bad cover paths, unknown audience order entries and executable links', () => {
    const doc = document(); doc.programmes.push({ ...doc.programmes[0]! }); expect(ProgrammeCatalogueDocumentSchema.safeParse(doc).success).toBe(false)
    const gallery = document(); (gallery.programmes[0] as { gallery: string }).gallery = 'not-a-gallery'; expect(ProgrammeCatalogueDocumentSchema.safeParse(gallery).success).toBe(false)
    const cover = document(); cover.programmes[0]!.cover = 'https://example.test/photo.jpg'; expect(ProgrammeCatalogueDocumentSchema.safeParse(cover).success).toBe(false)
    const order = document(); order.audiences.schools.order = ['ghost']; expect(ProgrammeCatalogueDocumentSchema.safeParse(order).success).toBe(false)
    const bad = document(); bad.programmes[0]!.i18n.en.links = [{ label: 'Bad', href: 'javascript:alert(1)' }]; expect(ProgrammeCatalogueDocumentSchema.safeParse(bad).success).toBe(false)
  })
  it('requires explicit AI confirmation to publish and exposes a preview/read before mutation', () => {
    const tools = createAssociationTools({ execute: vi.fn() })
    expect(tools.previewProgrammeCatalogue.isReadOnly).toBe(true)
    expect(tools.publishProgrammeCatalogue.requiresConfirmation).toBe(true)
    expect(tools.saveProgrammeCatalogueDraft.requiresCapability).toBe('configure')
    expect(tools.saveProgrammeCatalogueDraft.isReadOnly).toBe(false)
  })
})

describe('[COMP:crm/programme-catalogue] cover photos', () => {
  it('accepts a cover photo without a photo set, and rejects one from a different set', async () => {
    const { ProgrammeCatalogueDocumentSchema, programmePublicationIssues } = await import('../programme-catalogue.js')
    const en = { name: 'Synthetic', tagline: 'T', kicker: 'K', summary: 'S', sections: [{ id: 'about', heading: 'About', paragraphs: ['Text'] }] }
    const doc = (programme: Record<string, unknown>) => ProgrammeCatalogueDocumentSchema.parse({ schemaVersion: 1,
      audiences: { corporates: { gallery: 'spacebiz-dialogues', order: [] }, schools: { gallery: 'space-exchange-tour', order: [] }, students: { gallery: 'young-marco-polo', order: [] } },
      programmes: [{ slug: 'synthetic', audiences: ['schools'], order: 0, i18n: { en }, ...programme }] })
    expect(programmePublicationIssues(doc({ cover: '/media/gallery/annual-conference/annual-conference-06.jpg' }))).toEqual([])
    expect(programmePublicationIssues(doc({ gallery: 'internship', cover: '/media/gallery/annual-conference/annual-conference-06.jpg' })))
      .toEqual(['synthetic: cover photo must belong to the chosen gallery'])
  })
})

describe('[COMP:crm/programme-catalogue] library covers', () => {
  it('accepts a media library cover with English alt text, and refuses it alongside a gallery cover or without a description', async () => {
    const { ProgrammeCatalogueDocumentSchema, programmePublicationIssues } = await import('../programme-catalogue.js')
    const MEDIA = '11111111-1111-4111-8111-111111111111'
    const en = (coverAlt = '') => ({ name: 'Synthetic', tagline: 'T', kicker: 'K', summary: 'S', sections: [{ id: 'about', heading: 'About', paragraphs: ['Text'] }], coverAlt })
    const doc = (programme: Record<string, unknown>) => ProgrammeCatalogueDocumentSchema.parse({ schemaVersion: 1,
      audiences: { corporates: { gallery: 'spacebiz-dialogues', order: [] }, schools: { gallery: 'space-exchange-tour', order: [] }, students: { gallery: 'young-marco-polo', order: [] } },
      programmes: [{ slug: 'synthetic', audiences: ['schools'], order: 0, ...programme }] })
    expect(programmePublicationIssues(doc({ coverMediaId: MEDIA, i18n: { en: en('Students at a chapter meeting') } }))).toEqual([])
    expect(programmePublicationIssues(doc({ coverMediaId: MEDIA, i18n: { en: en() } }))).toEqual(['synthetic: describe the cover image in English'])
    expect(programmePublicationIssues(doc({ coverMediaId: MEDIA, cover: '/media/gallery/internship/internship-01.jpg', i18n: { en: en('Interns') } })))
      .toEqual(['synthetic: choose either a library image or a gallery photo as the cover, not both'])
    expect(() => doc({ coverMediaId: 'not-a-uuid', i18n: { en: en() } })).toThrow()
    // Existing documents without the new fields stay valid.
    expect(doc({ i18n: { en: { name: 'Synthetic', tagline: 'T', kicker: 'K', summary: 'S', sections: [{ id: 'about', heading: 'About', paragraphs: ['Text'] }] } } }).programmes[0].coverMediaId).toBeNull()
  })
})
