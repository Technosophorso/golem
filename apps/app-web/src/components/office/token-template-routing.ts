import { officeTemplateTokenTargets, type OfficeArtifactSnapshot, type OfficeTemplateField, type OfficeTemplateRoutingDraft } from "@use-brian/office-model";

/** Names and bindings come only from literal tokens, never editable mappings.
 * Preserve configuration by token name, not by the previous target object. */
export function reconcileTokenRouting(routing: OfficeTemplateRoutingDraft, snapshot: OfficeArtifactSnapshot, instruction: string): OfficeTemplateRoutingDraft {
  const existing = new Map(routing.fields.map((field) => [field.name, field]));
  const fields: OfficeTemplateField[] = [...officeTemplateTokenTargets(snapshot)].map(([name, targetIds]) => {
    const current = existing.get(name);
    if (current) return current.targetIds.length === targetIds.length && current.targetIds.every((id, i) => id === targetIds[i]) ? current : { ...current, targetIds };
    return { id: crypto.randomUUID(), name, label: name, type: "plainText", required: false, repeating: false, minItems: 0, maxItems: 1, maxLength: 100_000, targetIds, aiInstruction: instruction, locked: false };
  });
  if (!routing.slideRecipes.length && fields.length === routing.fields.length && fields.every((field, i) => field === routing.fields[i])) return routing;
  return { ...routing, fields, slideRecipes: [] };
}

/** Human-readable source locations; token names and source titles are content. */
export function tokenTargetLocations(snapshot: OfficeArtifactSnapshot, targetIds: string[]): string[] {
  const targets = new Set(targetIds);
  if (snapshot.family === "spreadsheet") return snapshot.worksheets.flatMap((sheet) => sheet.cells.filter((cell) => targets.has(cell.id)).map((cell) => `${sheet.name}!${cell.address}`));
  return [];
}
