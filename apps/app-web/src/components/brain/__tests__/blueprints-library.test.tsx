// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEETING_NOTES_STARTER, starterExtractionSpec, type CustomPageTemplateSummary } from "@use-brian/doc-model";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const mocks = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api/views", async (original) => ({
  ...await original<typeof import("@/lib/api/views")>(),
  createCustomPageTemplate: mocks.create,
}));
vi.mock("@/lib/brain-events", () => ({ requestBrainRefresh: mocks.refresh }));
vi.mock("@/components/brain/use-generate-from-brain", () => ({ useGenerateFromBrain: () => vi.fn() }));
import { BlueprintsLibrary } from "../blueprints-library";

let root: Root;
let container: HTMLDivElement;
const copy = en.brainPage.blueprints;
const installed = { id: "installed-blueprint" };
const existing = {
  id: "existing-blueprint", name: "Existing blueprint", description: "Our own contract",
  extraction: starterExtractionSpec(MEETING_NOTES_STARTER),
} as CustomPageTemplateSummary;

async function mount({
  blueprints = [] as CustomPageTemplateSummary[] | null,
  search = "", readOnly = false, workspaceId = "workspace", locale = "en" as "en" | "zh",
} = {}) {
  await act(async () => root.render(
    <StrictMode>
      <I18nProvider locale={locale} dict={locale === "zh" ? zh : en}>
        <BlueprintsLibrary key={workspaceId} workspaceId={workspaceId} blueprints={blueprints}
          search={search} readOnly={readOnly} onNewBlueprint={vi.fn()} onDeleteBlueprint={vi.fn()} />
      </I18nProvider>
    </StrictMode>,
  ));
}
function installButton(label = "Install Meeting notes") {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockReset().mockResolvedValue(installed);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("[COMP:web/blueprints-library] starter installation", () => {
  it.each([
    { blueprints: [], search: "" },
    { blueprints: [existing], search: "" },
    { blueprints: [existing], search: "no matching blueprint" },
    { blueprints: null, search: "" },
  ])("offers explicit installation regardless of roster or search: %j", async (props) => {
    await mount(props);
    expect(installButton()).toBeDefined();
    expect(installButton().disabled).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a complete editable copy, refreshes the workspace, and opens its editor", async () => {
    await mount({ blueprints: [existing] });
    await act(async () => installButton().click());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith("workspace", expect.objectContaining({
      name: en.recordings.starterName,
      description: en.recordings.starterDescription,
      category: "meeting",
      extraction: starterExtractionSpec(MEETING_NOTES_STARTER),
    }));
    const input = mocks.create.mock.calls[0][1];
    expect(input.blocks).toHaveLength(MEETING_NOTES_STARTER.blocks.length);
    expect(input.blocks.map((b: { id: string }) => b.id)).not.toEqual(MEETING_NOTES_STARTER.blocks.map((b) => b.id));
    expect(mocks.refresh).toHaveBeenCalledWith("workspace");
    expect(mocks.push).toHaveBeenCalledWith("/w/workspace/brain/blueprints/installed-blueprint");
  });

  it("stores the localized starter name and description", async () => {
    await mount({ locale: "zh" });
    await act(async () => installButton(zh.brainPage.blueprints.starterInstall.replace("{name}", zh.recordings.starterName)).click());
    expect(mocks.create).toHaveBeenCalledWith("workspace", expect.objectContaining({
      name: zh.recordings.starterName, description: zh.recordings.starterDescription,
    }));
  });

  it("blocks repeated clicks and shows pending feedback until the write finishes", async () => {
    let resolve!: (value: typeof installed) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    await mount();
    const button = installButton();
    await act(async () => { button.click(); button.click(); });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(installButton(copy.starterInstalling).disabled).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => resolve(installed));
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("disables installation for offline/read-only content", async () => {
    await mount({ readOnly: true });
    expect(installButton().disabled).toBe(true);
    await act(async () => installButton().click());
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reports failure without navigation or refresh and allows an explicit retry", async () => {
    mocks.create.mockRejectedValueOnce(new Error("unavailable"));
    await mount();
    await act(async () => installButton().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(copy.starterInstallFailed);
    expect(installButton().disabled).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => installButton().click());
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("does not navigate back to the previous workspace when installation finishes late", async () => {
    let resolve!: (value: typeof installed) => void;
    mocks.create.mockReturnValue(new Promise((done) => { resolve = done; }));
    await mount();
    await act(async () => installButton().click());
    await mount({ workspaceId: "other-workspace" });
    await act(async () => resolve(installed));
    expect(mocks.refresh).toHaveBeenCalledWith("workspace");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(installButton().disabled).toBe(false);
  });
});
