/** Literal brand-copy warnings shared by Feed review and UI. [COMP:feed/draft-review] */
import type { BrandRecord } from './brand/index.js'
export type BrandCopyFlag = {
  /** The phrase as the brand wrote it, for the operator to recognise. */
  phrase: string;
  kind: "restricted" | "avoid" | "claim";
};

/** Fold case, collapse whitespace, drop punctuation that varies by keyboard. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phrases shorter than this are skipped. A 4-character restricted term like
 * "best" matches inside "bestseller" and every other innocent word, and a
 * check that cries wolf is one the operator learns to ignore -- which costs
 * more than not having it.
 */
const MIN_PHRASE = 12;

/**
 * Literal, case-folded, exact-phrase containment. The same discipline as the
 * Office claim gate, and deliberately not fuzzy: this WARNS and never blocks
 * (D38), so a false positive is a cost with no upside. The operator is the
 * author, not the suspect.
 */
export function brandCopyFlags(
  brand: BrandRecord | null,
  text: string,
): BrandCopyFlag[] {
  if (!brand || !text.trim()) return [];
  const haystack = normalize(text);
  if (!haystack) return [];

  const candidates: BrandCopyFlag[] = [
    ...(brand.naming.restrictedTerms ?? []).map((phrase) => ({
      phrase,
      kind: "restricted" as const,
    })),
    ...(brand.messaging?.avoid ?? []).map((phrase) => ({
      phrase,
      kind: "avoid" as const,
    })),
    ...(brand.claims ?? [])
      .filter((c) => c.status === "prohibited")
      .map((c) => ({ phrase: c.text, kind: "claim" as const })),
  ];

  const seen = new Set<string>();
  const flags: BrandCopyFlag[] = [];
  for (const candidate of candidates) {
    const needle = normalize(candidate.phrase);
    if (needle.length < MIN_PHRASE) continue;
    if (seen.has(needle)) continue;
    if (haystack.includes(needle)) {
      seen.add(needle);
      flags.push(candidate);
    }
  }
  return flags;
}
