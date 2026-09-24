import { z } from 'zod'
import {
  OfficeArtifactSnapshotSchema,
  OfficeFamilySchema,
  OfficeResourceRefSchema,
  OfficeSensitivitySchema,
  OfficeUuidSchema,
  type PresentationObject,
  type OfficeArtifactSnapshot,
  type OfficeRichTextRun,
} from './model.js'

export const OfficeTemplateFieldSchema = z
  .object({
    id: OfficeUuidSchema,
    name: z.string().regex(/^(?:[a-z][a-z0-9_.-]{1,127}|[A-Z][A-Z0-9_]{0,127})$/),
    label: z.string().min(1).max(200),
    type: z.enum(['plainText', 'richText', 'image', 'date', 'number', 'bulletList', 'table', 'chartData', 'video']),
    required: z.boolean(),
    repeating: z.boolean(),
    minItems: z.number().int().min(0).max(10_000).default(0),
    maxItems: z.number().int().min(1).max(10_000).default(1),
    maxLength: z.number().int().min(1).max(1_000_000).optional(),
    targetIds: z.array(OfficeUuidSchema).min(1),
    aiInstruction: z.string().min(1).max(4_000),
    locked: z.boolean().default(false),
  })
  .strict()
  .refine((field) => field.maxItems >= field.minItems, { message: 'maxItems must be >= minItems' })

export const OfficeTemplateSlideRoleSchema = z.enum([
  'cover',
  'agenda',
  'section',
  'narrative',
  'comparison',
  'metrics',
  'timeline',
  'process',
  'caseStudy',
  'team',
  'quote',
  'closing',
  'appendix',
])

/**
 * Conservative planning capacity for template-bound presentation text.
 * The renderer remains authoritative for the actual glyph mix and wrapping.
 */
export function presentationTextCapacity(object: PresentationObject): number | undefined {
  const runs = object.kind === 'text' ? object.runs : object.kind === 'shape' ? object.text : undefined
  if (!runs?.length) return undefined
  const maximumFontSizePt = Math.max(1, ...runs.map((run) => run.style.fontSizePt))
  const lineCount = Math.max(1, Math.floor(object.geometry.heightPt / (maximumFontSizePt * 1.15)))
  const charactersPerLine = Math.max(1, Math.floor(object.geometry.widthPt / (maximumFontSizePt * 0.5)))
  return Math.min(4_000, lineCount * charactersPerLine)
}

export const OfficeTemplateSlideRecipeSchema = z
  .object({
    id: OfficeUuidSchema,
    slideId: OfficeUuidSchema,
    name: z.string().min(1).max(200),
    role: OfficeTemplateSlideRoleSchema,
    whenToUse: z.string().min(1).max(2_000),
    whenNotToUse: z.string().max(2_000).default(''),
    enabled: z.boolean().default(true),
    repeatable: z.boolean().default(false),
    minUses: z.number().int().min(0).max(100).default(0),
    maxUses: z.number().int().min(1).max(100).default(1),
    fieldIds: z.array(OfficeUuidSchema).max(1_000),
    confidence: z.number().min(0).max(1),
    inference: z.string().min(1).max(2_000),
    reviewed: z.boolean().default(false),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (recipe.maxUses < recipe.minUses) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxUses'], message: 'maxUses must be >= minUses' })
    if (!recipe.repeatable && recipe.maxUses !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxUses'], message: 'A non-repeatable slide recipe must have maxUses = 1' })
    if (!recipe.enabled && recipe.minUses !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minUses'], message: 'A disabled slide recipe must have minUses = 0' })
    if (new Set(recipe.fieldIds).size !== recipe.fieldIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldIds'], message: 'Slide recipe fieldIds must be unique' })
  })

export const OfficeTemplateRoutingDraftSchema = z.object({
  source: z.enum(['upload', 'guided', 'scratch', 'promote']).default('scratch'),
  fields: z.array(OfficeTemplateFieldSchema).max(10_000),
  slideRecipes: z.array(OfficeTemplateSlideRecipeSchema).max(10_000),
}).strict()

export const OfficeTemplateBundleSchema = z
  .object({
    id: OfficeUuidSchema,
    workspaceId: OfficeUuidSchema,
    family: OfficeFamilySchema,
    version: z.number().int().positive(),
    status: z.enum(['draft', 'admitted', 'deprecated', 'trash']),
    name: z.string().min(1).max(255),
    description: z.string().min(1).max(4_000),
    tags: z.array(z.string().min(1).max(100)).max(100),
    locales: z.array(z.string().min(2).max(35)).min(1),
    whenToUse: z.array(z.string().min(1).max(1_000)).min(1),
    whenNotToUse: z.array(z.string().min(1).max(1_000)).min(1),
    exampleRequests: z.array(z.string().min(1).max(1_000)).min(1),
    fields: z.array(OfficeTemplateFieldSchema).max(10_000).default([]),
    slideRecipes: z.array(OfficeTemplateSlideRecipeSchema).max(10_000).default([]),
    snapshot: OfficeArtifactSnapshotSchema,
    resources: z.array(OfficeResourceRefSchema).max(20_000),
    lockedObjectIds: z.array(OfficeUuidSchema),
    allowedRepeatTargetIds: z.array(OfficeUuidSchema),
    requiredEvidence: z.array(z.string().min(1).max(500)),
    sensitivity: OfficeSensitivitySchema,
    visibilityUserIds: z.array(OfficeUuidSchema),
    capabilityVersion: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    if (bundle.snapshot.family !== bundle.family) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['snapshot', 'family'], message: 'Template family must match snapshot family' })
    }
    const names = new Set<string>()
    const fieldIds = new Set<string>()
    for (const [index, field] of bundle.fields.entries()) {
      if (names.has(field.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', index, 'name'], message: 'Template field names must be unique' })
      names.add(field.name)
      if (fieldIds.has(field.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', index, 'id'], message: 'Template field IDs must be unique' })
      fieldIds.add(field.id)
    }
    if (bundle.family === 'document' && bundle.slideRecipes.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes'], message: 'Document templates cannot contain slide recipes' })
    }
    // Empty routing remains readable for presentation versions admitted before
    // recipe selection existed. Generation deterministically materializes that
    // legacy shape in memory; any non-empty catalogue is validated strictly.
    if (bundle.family === 'presentation' && bundle.snapshot.family === 'presentation' && bundle.slideRecipes.length > 0) {
      const slides = new Set(bundle.snapshot.slides.map((slide) => slide.id))
      const recipeIds = new Set<string>()
      const recipeSlides = new Set<string>()
      const assignedFields = new Set<string>()
      for (const [index, recipe] of bundle.slideRecipes.entries()) {
        if (recipeIds.has(recipe.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes', index, 'id'], message: 'Slide recipe IDs must be unique' })
        recipeIds.add(recipe.id)
        if (!slides.has(recipe.slideId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes', index, 'slideId'], message: 'Slide recipe must target a source slide in the template snapshot' })
        if (recipeSlides.has(recipe.slideId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes', index, 'slideId'], message: 'A source slide can have only one slide recipe' })
        recipeSlides.add(recipe.slideId)
        for (const fieldId of recipe.fieldIds) {
          if (!fieldIds.has(fieldId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes', index, 'fieldIds'], message: `Slide recipe references missing field ${fieldId}` })
          if (assignedFields.has(fieldId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes', index, 'fieldIds'], message: `Template field ${fieldId} belongs to more than one slide recipe` })
          assignedFields.add(fieldId)
        }
      }
      for (const [index, slide] of bundle.snapshot.slides.entries()) {
        if (!recipeSlides.has(slide.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slideRecipes'], message: `Source slide ${index + 1} must have one slide recipe` })
      }
      for (const [index, field] of bundle.fields.entries()) {
        if (!assignedFields.has(field.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', index, 'id'], message: 'Every presentation field must belong to one slide recipe' })
      }
    }
  })

export type OfficeTemplateField = z.infer<typeof OfficeTemplateFieldSchema>
export type OfficeTemplateSlideRole = z.infer<typeof OfficeTemplateSlideRoleSchema>
export type OfficeTemplateSlideRecipe = z.infer<typeof OfficeTemplateSlideRecipeSchema>
export type OfficeTemplateRoutingDraft = z.infer<typeof OfficeTemplateRoutingDraftSchema>
export type OfficeTemplateBundle = z.infer<typeof OfficeTemplateBundleSchema>

/** Literal placeholder inventory. Never crosses rich-text container boundaries. */
export function officeTemplateTokenTargets(snapshot: OfficeArtifactSnapshot): Map<string, string[]> {
  const targets = new Map<string, string[]>()
  const collect = (id: string, text: string) => {
    for (const match of text.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) {
      const name = match[1]!
      const ids = targets.get(name) ?? []
      if (!ids.includes(id)) ids.push(id)
      targets.set(name, ids)
    }
  }
  if (snapshot.family === 'document') {
    for (const section of snapshot.sections) {
      collect(section.id, section.header.map((run) => run.text).join(''))
      collect(section.id, section.footer.map((run) => run.text).join(''))
      for (const node of section.nodes) {
        if (node.kind === 'paragraph' || node.kind === 'heading') collect(node.id, node.runs.map((run) => run.text).join(''))
        if (node.kind === 'list') for (const item of node.items) collect(item.id, item.runs.map((run) => run.text).join(''))
        if (node.kind === 'table') for (const row of node.rows) for (const cell of row.cells) collect(cell.id, cell.runs.map((run) => run.text).join(''))
      }
    }
  } else if (snapshot.family === 'spreadsheet') {
    for (const sheet of snapshot.worksheets) for (const cell of sheet.cells) {
      if (!cell.formula && cell.valueType === 'string' && typeof cell.value === 'string') collect(cell.id, cell.value)
    }
  }
  return targets
}

/** Shared admission/runtime binding contract; empty metadata is legacy only. */
export function officeTemplateTokenDiagnostics(snapshot: OfficeArtifactSnapshot, fields: readonly OfficeTemplateField[]): string[] {
  const targets = officeTemplateTokenTargets(snapshot)
  const errors: string[] = []
  if (!targets.size) errors.push('Template contains no fillable fields')
  for (const name of officeTemplateLockedTokenNames(snapshot, fields)) errors.push(`Field ${name} targets locked content; locked token replacement is not supported`)
  const names = new Set<string>()
  const ids = new Set<string>()
  for (const field of fields) {
    if (names.has(field.name) || ids.has(field.id)) errors.push(`Duplicate field ${field.name}`)
    names.add(field.name)
    ids.add(field.id)
    const expected = targets.get(field.name)
    if (!expected || expected.length !== field.targetIds.length || new Set(field.targetIds).size !== field.targetIds.length || expected.some((id) => !field.targetIds.includes(id))) errors.push(`Field ${field.name} must target exactly its token containers`)
    if (!['plainText', 'number', 'date'].includes(field.type)) errors.push(`Field ${field.name} has unsupported type ${field.type}`)
    if (field.repeating) errors.push(`Field ${field.name} cannot repeat`)
    if (!field.label.trim() || !field.aiInstruction.trim()) errors.push(`Field ${field.name} requires a nonblank label and instruction`)
  }
  for (const name of targets.keys()) if (!names.has(name)) errors.push(`Missing configuration for ${name}`)
  return errors
}

/** Fail closed: tokens cannot override field, cell, or inherited container locks. */
export function officeTemplateLockedTokenNames(snapshot: OfficeArtifactSnapshot, fields: readonly OfficeTemplateField[] = [], lockedObjectIds: readonly string[] = []): string[] {
  const locks = new Set(lockedObjectIds)
  const names = new Set<string>()
  const collect = (text: string) => {
    for (const match of text.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) names.add(match[1]!)
  }
  const inspectRuns = (runs: readonly OfficeRichTextRun[], inherited: boolean) => {
    const text = runs.map((run) => run.text).join('')
    if (inherited) return collect(text)
    let offset = 0
    const spans = runs.map((run) => {
      const start = offset
      offset += run.text.length
      return { start, end: offset, locked: locks.has(run.id) }
    })
    for (const match of text.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) {
      const start = match.index!
      if (spans.some((span) => span.locked && span.start < start + match[0].length && span.end > start)) names.add(match[1]!)
    }
  }
  if (snapshot.family === 'document') for (const section of snapshot.sections) {
    const sectionLocked = locks.has(section.id)
    inspectRuns(section.header, sectionLocked)
    inspectRuns(section.footer, sectionLocked)
    for (const node of section.nodes) {
      const nodeLocked = sectionLocked || locks.has(node.id)
      if (node.kind === 'paragraph' || node.kind === 'heading') inspectRuns(node.runs, nodeLocked)
      if (node.kind === 'list') for (const item of node.items) inspectRuns(item.runs, nodeLocked || locks.has(item.id))
      if (node.kind === 'table') for (const row of node.rows) for (const cell of row.cells) inspectRuns(cell.runs, nodeLocked || locks.has(row.id) || locks.has(cell.id))
    }
  }
  if (snapshot.family === 'spreadsheet') for (const sheet of snapshot.worksheets) for (const cell of sheet.cells) {
    if (!cell.formula && cell.valueType === 'string' && typeof cell.value === 'string' && (cell.locked || locks.has(sheet.id) || locks.has(cell.id))) collect(cell.value)
  }
  const targets = officeTemplateTokenTargets(snapshot)
  for (const field of fields) if (field.locked && targets.has(field.name)) names.add(field.name)
  return [...names]
}
