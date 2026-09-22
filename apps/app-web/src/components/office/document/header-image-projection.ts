import type { Editor } from "@tiptap/core";

type DocumentHeaderImage = {
  resourceId: string;
  altText: string;
  decorative: boolean;
  widthPt: number;
  heightPt: number;
};

function positivePointValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readDocumentHeaderImage(value: unknown): DocumentHeaderImage | null {
  if (!value || typeof value !== "object") return null;
  const image = value as Record<string, unknown>;
  if (typeof image.resourceId !== "string") return null;
  return {
    resourceId: image.resourceId,
    altText: image.decorative ? "" : String(image.altText ?? ""),
    decorative: image.decorative === true,
    widthPt: positivePointValue(image.widthPt, 96),
    heightPt: positivePointValue(image.heightPt, 48),
  };
}

type DocumentHeaderImageProjection = DocumentHeaderImage & { displayWidthPt: number; displayHeightPt: number };

export function findDocumentHeaderImage(editor: Editor, sectionId: string): DocumentHeaderImageProjection | null {
  let image: DocumentHeaderImageProjection | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "officeSection" || node.attrs.id !== sectionId) return;
    const canonical = readDocumentHeaderImage(node.attrs.headerImage);
    if (!canonical) return false;
    const page = node.attrs.page;
    const margin = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 72;
    const availableHeight = margin(page?.marginTopPt);
    // The paper has two 1px borders (1.5pt total); reserve the 8pt text gap.
    const availableWidth = Math.max(0, positivePointValue(page?.widthPt, 612) - margin(page?.marginLeftPt) - margin(page?.marginRightPt) - 1.5 - 8);
    // Projection only: never resize the canonical image or consume body space.
    const scale = Math.min(1, availableHeight / canonical.heightPt, availableWidth / canonical.widthPt);
    image = { ...canonical, displayWidthPt: canonical.widthPt * scale, displayHeightPt: canonical.heightPt * scale };
    return false;
  });
  return image;
}
