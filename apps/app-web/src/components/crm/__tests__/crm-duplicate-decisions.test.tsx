// @vitest-environment jsdom
/** [COMP:app-web/crm-duplicate-decisions] Explicit duplicate decisions. */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchCrmDuplicates: vi.fn(),
  fetchCrmSeparations: vi.fn(),
  keepCrmRecordsSeparate: vi.fn(),
  mergeCrmRecords: vi.fn(),
  reviewCrmSeparationAgain: vi.fn(),
  setCrmRecordArchived: vi.fn(),
  undoCrmMerge: vi.fn(),
}));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn() }));

vi.mock("@/lib/api/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/crm")>();
  return { ...actual, ...api };
});
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmDialog: dialogs.confirmDialog,
}));

import { DuplicatesDialog } from "../crm-actions";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import type { CrmDuplicateGroup } from "@/lib/api/crm";
import type { Dictionary } from "@/lib/i18n/dictionaries";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEFT = "00000000-0000-4000-8000-000000000010";
const RIGHT = "00000000-0000-4000-8000-000000000011";
const separation = {
  id: "00000000-0000-4000-8000-000000000030",
  workspaceId: "workspace-1",
  leftEntityId: LEFT,
  rightEntityId: RIGHT,
  leftName: "Jordan Kim",
  rightName: "Jordan Kim",
  reason: null,
  createdAt: "2026-08-25T00:00:00.000Z",
};
const groups = [{
  kind: "person" as const,
  reason: "name" as const,
  value: "jordan kim",
  records: [
    { id: LEFT, name: "Jordan Kim" },
    { id: RIGHT, name: "Jordan Kim" },
  ],
}];

let host: HTMLDivElement;
let root: Root;

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

beforeEach(async () => {
  vi.resetAllMocks();
  api.fetchCrmDuplicates.mockResolvedValueOnce(groups).mockResolvedValue([]);
  api.fetchCrmSeparations.mockResolvedValueOnce([]).mockResolvedValue([separation]);
  api.keepCrmRecordsSeparate.mockResolvedValue({ separation, idempotent: false });
  api.setCrmRecordArchived.mockResolvedValue(undefined);
  api.mergeCrmRecords.mockImplementation(async () => ({ mergeId: `merge-${api.mergeCrmRecords.mock.calls.length}`, undoUntil: "2099-01-01T00:00:00Z" }));
  api.undoCrmMerge.mockResolvedValue(undefined);
  dialogs.confirmDialog.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en" dict={en as unknown as Dictionary}>
        <DuplicatesDialog
          workspaceId="workspace-1"
          open
          onOpenChange={() => {}}
          onMerged={() => {}}
        />
      </I18nProvider>,
    );
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll("[data-base-ui-portal]").forEach((node) => node.remove());
});

describe("[COMP:app-web/crm-duplicate-decisions] duplicate review", () => {
  it("offers Merge, Keep separate and Archive for every non-survivor", () => {
    expect(document.body.textContent).toContain("Jordan Kim");
    expect(Array.from(document.body.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Merge",
    )).toBe(true);
    expect(Array.from(document.body.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Keep separate",
    )).toBe(true);
    expect(Array.from(document.body.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Archive",
    )).toBe(true);
  });

  it("archives the non-survivor without touching the record that is kept", async () => {
    // Archive exists for a record that is junk rather than the same person
    // twice: merging that one would fold its wrong attributes into the
    // survivor, so the survivor must be left completely alone.
    const archive = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Archive",
    );
    expect(archive).toBeTruthy();

    await act(async () => { archive!.click(); });
    await settle();

    expect(api.setCrmRecordArchived).toHaveBeenCalledTimes(1);
    expect(api.setCrmRecordArchived).toHaveBeenCalledWith("workspace-1", RIGHT, true);
    expect(api.mergeCrmRecords).not.toHaveBeenCalled();
  });

  it("asks before archiving, and does nothing when the confirm is declined", async () => {
    dialogs.confirmDialog.mockResolvedValueOnce(false);
    const archive = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Archive",
    );
    await act(async () => { archive!.click(); });
    await settle();

    expect(dialogs.confirmDialog).toHaveBeenCalled();
    expect(api.setCrmRecordArchived).not.toHaveBeenCalled();
  });

  it("removes a kept pair and exposes reversible Review again state", async () => {
    const keep = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Keep separate",
    );
    expect(keep).toBeTruthy();

    await act(async () => { keep!.click(); });
    await settle();

    expect(api.keepCrmRecordsSeparate).toHaveBeenCalledWith("workspace-1", LEFT, RIGHT);
    expect(document.body.textContent).toContain("Kept separate");
    expect(document.body.textContent).toContain("Kept separate (1)");
    expect(Array.from(document.body.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "Review again",
    )).toBe(true);
  });
});

const THIRD = "00000000-0000-4000-8000-000000000012";
const FOURTH = "00000000-0000-4000-8000-000000000013";

function button(text: string) {
  const result = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.textContent?.trim() === text);
  expect(result, `button ${text}`).toBeTruthy();
  return result!;
}

function checkbox(label: string) {
  const result = Array.from(document.body.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    .find((item) => item.getAttribute("aria-label") === label);
  expect(result, `checkbox ${label}`).toBeTruthy();
  return result!;
}

async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
  await settle();
}

function batchGroup(ids = [LEFT, RIGHT, THIRD, FOURTH]): CrmDuplicateGroup {
  return { ...groups[0], records: ids.map((id, index) => ({ id, name: index === 0 ? "Keep Example" : `Duplicate ${id.slice(-2)}` })) };
}

async function showGroups(nextGroups: CrmDuplicateGroup[] = [batchGroup()]) {
  api.fetchCrmDuplicates.mockReset().mockResolvedValueOnce(nextGroups).mockResolvedValue([]);
  api.fetchCrmSeparations.mockReset().mockResolvedValue([]);
  await act(async () => {
    root.render(<I18nProvider locale="en" dict={en as unknown as Dictionary}>
      <DuplicatesDialog key="batch-fixture" workspaceId="workspace-1" open onOpenChange={() => {}} onMerged={() => {}} />
    </I18nProvider>);
  });
  await settle();
}

describe("[COMP:app-web/crm-duplicate-decisions] bulk review", () => {
  it("starts empty, selects all shown, and honors a per-record exclusion with one confirmation", async () => {
    await showGroups();
    expect(button("Merge selected (0)").disabled).toBe(true);
    await click(button("Select all shown"));
    await click(checkbox("Include Duplicate 11 in merge into Keep Example"));
    await click(button("Merge selected (2)"));
    expect(dialogs.confirmDialog).toHaveBeenCalledTimes(1);
    expect(dialogs.confirmDialog.mock.calls[0][0].description).toContain("(2)");
    expect(api.mergeCrmRecords.mock.calls).toEqual([
      ["workspace-1", LEFT, THIRD], ["workspace-1", LEFT, FOURTH],
    ]);
    expect(document.body.textContent).toContain("Merged 2 of 2 selected records.");
    expect(button("Undo all merges (2)")).toBeTruthy();
  });

  it("selects only the chosen group and supports clearing selection", async () => {
    const second = { ...batchGroup([THIRD, FOURTH]), value: "second group" };
    await showGroups([batchGroup([LEFT, RIGHT]), second]);
    await click(checkbox("Select group: second group"));
    expect(button("Merge selected (1)").disabled).toBe(false);
    await click(button("Clear selection"));
    expect(button("Merge selected (0)").disabled).toBe(true);
    await click(checkbox("Select group: second group"));
    await click(button("Merge selected (1)"));
    expect(api.mergeCrmRecords).toHaveBeenCalledWith("workspace-1", THIRD, FOURTH);
    expect(api.mergeCrmRecords).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the batch confirmation is declined", async () => {
    await showGroups();
    dialogs.confirmDialog.mockResolvedValueOnce(false);
    await click(button("Select all shown"));
    await click(button("Merge selected (3)"));
    expect(api.mergeCrmRecords).not.toHaveBeenCalled();
    expect(button("Merge selected (3)").disabled).toBe(false);
  });

  it("executes repeated suggestions once and excludes conflicting overlap", async () => {
    await showGroups([
      batchGroup([LEFT, RIGHT]),
      { ...batchGroup([LEFT, RIGHT, THIRD]), reason: "email", value: "same@example.test" },
      { ...batchGroup([RIGHT, FOURTH]), value: "overlap" },
    ]);
    await click(button("Select all shown"));
    expect(document.body.textContent).toContain(en.crmPage.r2.bulkDuplicateOverlap);
    await click(button("Merge selected (2)"));
    expect(api.mergeCrmRecords.mock.calls).toEqual([
      ["workspace-1", LEFT, RIGHT], ["workspace-1", LEFT, THIRD],
    ]);
  });

  it("stops after a failed pair, retains successful Undo, and reloads before another batch", async () => {
    await showGroups();
    api.mergeCrmRecords
      .mockResolvedValueOnce({ mergeId: "first", undoUntil: "2099-01-01T00:00:00Z" })
      .mockRejectedValueOnce(new Error("Conflict: refresh required"));
    await click(button("Select all shown"));
    await click(button("Merge selected (3)"));
    expect(api.mergeCrmRecords).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Merged 1 of 3 selected records.");
    expect(document.body.textContent).toContain("Conflict: refresh required");
    expect(button("Select all shown").disabled).toBe(true);
    expect(button("Undo merge").disabled).toBe(false);
    api.fetchCrmDuplicates.mockResolvedValueOnce([batchGroup([LEFT, THIRD, FOURTH])]);
    await click(button("Retry"));
    expect(button("Merge selected (0)").disabled).toBe(true);
    expect(api.mergeCrmRecords).toHaveBeenCalledTimes(2);
    await click(button("Select all shown"));
    await click(button("Merge selected (2)"));
    expect(api.mergeCrmRecords.mock.calls.filter((call) => call[2] === RIGHT)).toHaveLength(1);
    expect(api.mergeCrmRecords.mock.calls[3]).toEqual(["workspace-1", LEFT, FOURTH]);
  });

  it("undoes newest first and retains unacknowledged receipts after an Undo failure", async () => {
    await showGroups();
    await click(button("Select all shown"));
    await click(button("Merge selected (3)"));
    api.undoCrmMerge.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Undo temporarily unavailable"));
    await click(button("Undo all merges (3)"));
    expect(api.undoCrmMerge.mock.calls).toEqual([["workspace-1", "merge-3"], ["workspace-1", "merge-2"]]);
    expect(button("Undo all merges (2)")).toBeTruthy();
    await click(button("Undo all merges (2)"));
    expect(api.undoCrmMerge.mock.calls).toEqual([
      ["workspace-1", "merge-3"], ["workspace-1", "merge-2"],
      ["workspace-1", "merge-2"], ["workspace-1", "merge-1"],
    ]);
    expect(document.body.textContent).not.toContain("Completed merges:");
  });

  it("locks repeated submissions and dismissal during confirmation and execution", async () => {
    await showGroups([batchGroup([LEFT, RIGHT])]);
    let confirm!: (value: boolean) => void;
    let merge!: (value: { mergeId: string; undoUntil: string }) => void;
    dialogs.confirmDialog.mockReturnValueOnce(new Promise<boolean>((resolve) => { confirm = resolve; }));
    api.mergeCrmRecords.mockReturnValueOnce(new Promise((resolve) => { merge = resolve; }));
    await click(button("Select all shown"));
    await click(button("Merge selected (1)"));
    expect(button("Merge selected (1)").disabled).toBe(true);
    expect(document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.disabled).toBe(true);
    await click(button("Merge selected (1)"));
    expect(dialogs.confirmDialog).toHaveBeenCalledTimes(1);
    await act(async () => { confirm(true); });
    await settle();
    expect(api.mergeCrmRecords).toHaveBeenCalledTimes(1);
    expect(button("Select all shown").disabled).toBe(true);
    await act(async () => { merge({ mergeId: "acknowledged", undoUntil: "2099-01-01T00:00:00Z" }); });
    await settle();
    expect(button("Undo merge").disabled).toBe(false);
  });

  it("retains completed Undo receipts when refreshing candidates fails", async () => {
    await showGroups([batchGroup([LEFT, RIGHT])]);
    api.fetchCrmDuplicates.mockRejectedValueOnce(new Error("Candidates unavailable"));
    await click(button("Select all shown"));
    await click(button("Merge selected (1)"));
    expect(document.body.textContent).toContain("Candidates unavailable");
    expect(document.body.textContent).not.toContain("No duplicate candidates.");
    expect(button("Undo merge").disabled).toBe(false);
  });

  it("retains Undo when reopened but resets receipts and selection when switching workspace", async () => {
    await showGroups();
    await click(button("Select all shown"));
    await click(button("Merge selected (3)"));
    const renderDialog = async (workspaceId: string, open: boolean) => {
      await act(async () => {
        root.render(<I18nProvider locale="en" dict={en as unknown as Dictionary}>
          <DuplicatesDialog key="batch-fixture" workspaceId={workspaceId} open={open} onOpenChange={() => {}} onMerged={() => {}} />
        </I18nProvider>);
      });
      await settle();
    };
    await renderDialog("workspace-1", false);
    await renderDialog("workspace-1", true);
    expect(button("Undo all merges (3)")).toBeTruthy();
    api.fetchCrmDuplicates.mockResolvedValueOnce([batchGroup()]);
    await renderDialog("workspace-2", true);
    expect(document.body.textContent).not.toContain("Undo all merges");
    expect(document.body.textContent).not.toContain("Completed merges");
    expect(button("Merge selected (0)").disabled).toBe(true);
    expect(api.fetchCrmDuplicates).toHaveBeenLastCalledWith("workspace-2");
  });

  it("stops unsent work if the dialog is unmounted during a request", async () => {
    await showGroups();
    let complete!: (value: { mergeId: string; undoUntil: string }) => void;
    api.mergeCrmRecords.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    await click(button("Select all shown"));
    await click(button("Merge selected (3)"));
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { complete({ mergeId: "first", undoUntil: "2099-01-01T00:00:00Z" }); });
    await settle();
    expect(api.mergeCrmRecords).toHaveBeenCalledTimes(1);
  });
});
