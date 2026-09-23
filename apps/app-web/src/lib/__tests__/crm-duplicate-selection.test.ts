import { describe, expect, it } from "vitest";
import type { CrmDuplicateGroup } from "@/lib/api/crm";
import { canSelectCrmMergePair, crmDuplicatePairs, selectCrmMergePairs } from "../crm-duplicate-selection";

function group(ids: string[], reason: CrmDuplicateGroup["reason"] = "name"): CrmDuplicateGroup {
  return { kind: "person", reason, value: "example", records: ids.map((id) => ({ id, name: `Person ${id}` })) };
}

describe("[COMP:app-web/crm-duplicate-selection] explicit merge selection", () => {
  it("deduplicates repeated pair suggestions without inferring transitive merges", () => {
    const pairs = crmDuplicatePairs([group(["a", "b"]), group(["a", "b", "c"], "email"), group(["b", "d"])]);
    expect(pairs.map((pair) => pair.key)).toEqual(["a:b", "a:c", "b:d"]);
    expect(selectCrmMergePairs([], pairs).map((pair) => pair.key)).toEqual(["a:b", "a:c"]);
    expect(pairs.some((pair) => pair.key === "a:d")).toBe(false);
  });

  it("preserves the explicitly chosen group rather than replacing its survivor", () => {
    const pairs = crmDuplicatePairs([group(["a", "b"]), group(["b", "c"]), group(["d", "c"])]);
    const chosen = pairs[1];
    expect(selectCrmMergePairs([chosen], pairs)).toEqual([chosen]);
    expect(canSelectCrmMergePair(pairs[2], [chosen])).toBe(false);
  });

  it("allows independent groups and multiple duplicates sharing one survivor", () => {
    const pairs = crmDuplicatePairs([group(["a", "b", "c"]), group(["d", "e"])]);
    expect(selectCrmMergePairs([], pairs)).toEqual(pairs);
  });

  it("refuses direct and across-group Keep separate conflicts", () => {
    const pairs = crmDuplicatePairs([group(["a", "b"]), group(["a", "c"])]);
    expect(selectCrmMergePairs([], pairs, [{ leftEntityId: "a", rightEntityId: "b" }])).toEqual([pairs[1]]);
    expect(selectCrmMergePairs([], pairs, [{ leftEntityId: "c", rightEntityId: "b" }])).toEqual([pairs[0]]);
  });

  it("does not emit self merges or invent candidates for empty/single-record groups", () => {
    expect(crmDuplicatePairs([group([]), group(["a"]), group(["b", "b"])])).toEqual([]);
  });
});
