/**
 * Pure mappers from the approved brand record onto what the Feed renders
 * (feed-revamp-depth D36-D38).
 *
 * All pure and all null-tolerant, because every Feed brand consumer is
 * optional: a workspace with no brand, or one whose brand is still a draft,
 * must render exactly what it rendered before this existed.
 *
 * [COMP:app-web/feed-brand]
 */

import type { BrandRecord } from "@use-brian/shared/brand";

export type BrandPreviewIdentity = {
  /** The name a platform would show. */
  displayName: string | null;
  /**
   * The real handle, or null. Deliberately nullable: before this, the preview
   * INVENTED one by lowercasing the assistant name, so a workspace whose real
   * handle differed saw a confident lie on the one surface whose job is
   * showing how the post will look in public. No handle now renders no handle.
   */
  handle: string | null;
  /** `workspace_files` id of the logo to use as the avatar, or null. */
  logoFileId: string | null;
};

export function brandPreviewIdentity(
  brand: BrandRecord | null,
): BrandPreviewIdentity {
  if (!brand) return { displayName: null, handle: null, logoFileId: null };
  const naming = brand.naming;
  const handle = naming.handles?.[0]?.trim() ?? "";
  return {
    displayName: naming.publicName?.trim() || naming.name?.trim() || null,
    handle: handle ? handle.replace(/^@/, "") : null,
    logoFileId: brandLogoFileId(brand),
  };
}

/**
 * The compact logo if the brand has one, else the primary. A preview avatar is
 * a 36px circle; a full lockup is unreadable there, which is exactly what the
 * `compact` variant exists for.
 */
export function brandLogoFileId(brand: BrandRecord | null): string | null {
  if (!brand) return null;
  const variants = brand.logoVariants ?? [];
  const pick =
    variants.find((v) => v.variant === "compact" && v.fileId) ??
    variants.find((v) => v.variant === "primary" && v.fileId) ??
    variants.find((v) => v.fileId);
  return pick?.fileId ?? null;
}

// ── Brand check (D38) ───────────────────────────────────────────────────────

export { brandCopyFlags } from '@use-brian/shared'

/** The read-only voice block on `/feed/voice` (D37). */
export function brandVoiceSummary(brand: BrandRecord | null): {
  traits: { trait: string; means: string; avoid: string }[];
  toneNotes: string[];
  capitalization: string | null;
} | null {
  if (!brand?.messaging) return null;
  const traits = brand.messaging.voice ?? [];
  const toneNotes = brand.messaging.toneNotes ?? [];
  const capitalization = brand.naming.capitalization?.trim() || null;
  if (traits.length === 0 && toneNotes.length === 0 && !capitalization) {
    return null;
  }
  return { traits, toneNotes, capitalization };
}

/** Message pillars, offered as one-click month themes in the Plan rail. */
export function brandPillarLabels(brand: BrandRecord | null): string[] {
  if (!brand?.messaging?.pillars) return [];
  return brand.messaging.pillars
    .map((p) => p.title.trim())
    .filter(Boolean);
}
