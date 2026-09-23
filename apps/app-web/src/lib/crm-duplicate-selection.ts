import type { CrmDuplicateGroup, CrmSeparation } from "@/lib/api/crm";

/** Explicit review pairs, never transitive identity inference. */
export type CrmMergePair = {
  key: string;
  kind: CrmDuplicateGroup["kind"];
  survivor: CrmDuplicateGroup["records"][number];
  duplicate: CrmDuplicateGroup["records"][number];
};

export function crmDuplicatePairs(groups: readonly CrmDuplicateGroup[]): CrmMergePair[] {
  const pairs = new Map<string, CrmMergePair>();
  for (const group of groups) {
    const survivor = group.records[0];
    if (!survivor) continue;
    for (const duplicate of group.records.slice(1)) {
      if (duplicate.id === survivor.id) continue;
      const key = `${survivor.id}:${duplicate.id}`;
      if (!pairs.has(key)) pairs.set(key, { key, kind: group.kind, survivor, duplicate });
    }
  }
  return [...pairs.values()];
}

type Separation = Pick<CrmSeparation, "leftEntityId" | "rightEntityId">;

function separated(a: string, b: string, separations: readonly Separation[]): boolean {
  return separations.some((pair) => (pair.leftEntityId === a && pair.rightEntityId === b)
    || (pair.leftEntityId === b && pair.rightEntityId === a));
}

export function canSelectCrmMergePair(
  pair: CrmMergePair,
  selected: readonly CrmMergePair[],
  separations: readonly Separation[] = [],
): boolean {
  return pair.survivor.id !== pair.duplicate.id
    && !separated(pair.survivor.id, pair.duplicate.id, separations)
    && selected.every((other) =>
    pair.key === other.key || (
      pair.duplicate.id !== other.duplicate.id
      && pair.duplicate.id !== other.survivor.id
      && pair.survivor.id !== other.duplicate.id
      && (pair.survivor.id !== other.survivor.id || !separated(pair.duplicate.id, other.duplicate.id, separations))
    ),
  );
}

/** Preserve explicit choices, then add compatible visible pairs in review order. */
export function selectCrmMergePairs(
  selected: readonly CrmMergePair[],
  candidates: readonly CrmMergePair[],
  separations: readonly Separation[] = [],
): CrmMergePair[] {
  const result: CrmMergePair[] = [];
  const keys = new Set<string>();
  for (const pair of [...selected, ...candidates]) {
    if (keys.has(pair.key) || !canSelectCrmMergePair(pair, result, separations)) continue;
    result.push(pair);
    keys.add(pair.key);
  }
  return result;
}
