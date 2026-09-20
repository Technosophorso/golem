// @vitest-environment jsdom
/** [COMP:app-web/internal-link-controls] Workspace/page alias editor authority. */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { InternalLinkControl } from "../internal-link-control";

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  capabilities: vi.fn(),
  availability: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@/lib/api/internal-links", () => ({
  ensureInternalLink: mocks.ensure,
  getInternalLinkCapabilities: mocks.capabilities,
  checkInternalLinkAlias: mocks.availability,
  renameInternalLinkAlias: mocks.rename,
  InternalLinkApiError: class InternalLinkApiError extends Error {
    constructor(message: string, readonly status: number, readonly suggestion?: string) { super(message); }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const current = {
  workspaceId: "workspace-1",
  pageId: "page-1",
  workspaceAlias: "product",
  pageAlias: "roadmap",
  sharePath: "/s/product/roadmap",
  canonicalPath: "/w/workspace-1/p/page-1",
  url: "https://brain.example/s/product/roadmap",
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  mocks.capabilities.mockReset().mockResolvedValue({ internalLinkAliasesVersion: 1 });
  mocks.ensure.mockReset().mockResolvedValue(current);
  mocks.availability.mockReset().mockResolvedValue({ available: true });
  mocks.rename.mockReset().mockResolvedValue({ ...current, pageAlias: "launch-plan" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function renderControl(canManage: boolean) {
  await act(async () => {
    root.render(
      <I18nProvider locale="en" dict={en}>
        <InternalLinkControl workspaceId="workspace-1" pageId="page-1" canManage={canManage} />
      </I18nProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

describe("[COMP:app-web/internal-link-controls] alias editor", () => {
  it("lets a manager validate and save through the shared command", async () => {
    vi.useFakeTimers();
    await renderControl(true);
    expect(host.textContent).toContain(`${window.location.origin}/s/product/roadmap`);
    expect(host.textContent).toContain(en.internalLinks.aliasHistoryHint);

    const input = host.querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "launch-plan");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mocks.availability).toHaveBeenCalledWith({ kind: "page", id: "page-1", alias: "launch-plan" });

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === en.internalLinks.aliasSave);
    expect(save).not.toBeUndefined();
    await act(async () => { save!.click(); });
    expect(mocks.rename).toHaveBeenCalledWith({ kind: "page", id: "page-1", alias: "launch-plan" });
  });

  it("shows a readable member the confirmed preview without rename controls", async () => {
    await renderControl(false);
    expect(host.textContent).toContain(`${window.location.origin}/s/product/roadmap`);
    expect(host.querySelector("input")).toBeNull();
    expect(mocks.ensure).toHaveBeenCalledWith("workspace-1", "page-1");
  });

  it("renders nothing when the deployment has no alias capability", async () => {
    mocks.capabilities.mockResolvedValue({ pageLinkHandoffVersion: 1 });
    await renderControl(true);
    expect(host.innerHTML).toBe("");
    expect(mocks.ensure).not.toHaveBeenCalled();
  });
});
