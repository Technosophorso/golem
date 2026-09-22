// @vitest-environment jsdom

import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedDock } from "@/lib/api/home-dock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const sidebar = vi.hoisted(() => ({
  dock: null as ResolvedDock | null,
  dockLoading: true,
  studioSetupIncomplete: false,
  reloadDock: vi.fn(),
  setDock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/i18n/client", async () => {
  const { en: dict } = await import("@/lib/i18n/dictionaries/en");
  return { useLocale: () => "en", useT: () => dict };
});

vi.mock("@/components/assistant-avatar", () => ({
  AssistantAvatar: ({ name }: { name: string }) => (
    <span data-assistant-avatar={name}>{name}</span>
  ),
}));

vi.mock("@/components/doc/suggested-file-drop", () => ({
  SuggestedFileDrop: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/api/views", () => ({
  listWorkspaceAssistants: vi.fn().mockResolvedValue([
    {
      id: "assistant-primary",
      name: "Brian",
      iconSeed: 1,
      kind: "primary",
      appType: null,
    },
    {
      id: "assistant-specialist",
      name: "Researcher",
      iconSeed: 2,
      kind: "standard",
      appType: null,
    },
  ]),
}));

vi.mock("@/lib/api/home-dock", () => ({
  refreshHomeDock: vi.fn(),
  pendingApprovalTotal: (dock: ResolvedDock | null) =>
    Math.max(
      0,
      dock?.needsYou.find((need) => need.kind === "approvals")?.count ?? 0,
    ),
}));

vi.mock("../doc-sidebar-data", () => ({
  useSidebarData: () => ({
    dock: sidebar.dock,
    dockLoading: sidebar.dockLoading,
    studioSetupIncomplete: sidebar.studioSetupIncomplete,
    reloadDock: sidebar.reloadDock,
    setDock: sidebar.setDock,
  }),
}));

import { takeChatHandoff } from "@/lib/chat-handoff";
import { SuggestedView } from "../suggested-view";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  nav.push.mockReset();
  sidebar.dock = null;
  sidebar.dockLoading = true;
  sidebar.studioSetupIncomplete = false;
  window.localStorage.clear();
  sidebar.reloadDock.mockReset();
  sidebar.setDock.mockReset();
  window.sessionStorage.clear();
  takeChatHandoff("workspace-1", Date.now());
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("[COMP:app-web/home-suggested] Personal-chat launcher", () => {
  it("chooses an assistant and hands the prompt to a fresh Personal chat", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SuggestedView
          workspaceId="workspace-1"
          assistantId="assistant-primary"
          userName="You"
        />,
      );
    });

    const researcher = container
      .querySelector('[data-assistant-avatar="Researcher"]')
      ?.closest("button");
    expect(researcher).toBeTruthy();
    act(() => researcher?.click());

    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Ask anything"]',
    );
    expect(input).toBeTruthy();
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        input,
        "  Compare this week's pipeline  ",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        ?.querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(nav.push).toHaveBeenCalledWith(
      "/w/workspace-1/chat?v=personal&assistant=assistant-specialist",
    );
    expect(takeChatHandoff("workspace-1", Date.now())).toMatchObject({
      workspaceId: "workspace-1",
      assistantId: "assistant-specialist",
      text: "Compare this week's pipeline",
    });
  });

  it("leads an empty workspace with editable chat starters and optional setup", async () => {
    sidebar.dockLoading = false;
    sidebar.studioSetupIncomplete = true;
    sidebar.dock = {
      source: "default", generatedAt: null, note: null, needsYou: [],
      pickUp: [], comingUp: [],
      brain: { entryCount: 0, growth7d: 0, sparkline: [], hasConnector: false },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <SuggestedView workspaceId="workspace-1" assistantId="assistant-primary" />,
    ));
    expect(container.querySelector("h1")?.textContent).toBe("What would you like to work on?");
    expect(container.textContent).not.toContain("No scheduled runs");
    expect(container.textContent).not.toContain("Your brain");
    expect(container.querySelectorAll("aside a")).toHaveLength(3);
    expect(container.querySelector("aside a")?.getAttribute("href")).toBe("/w/workspace-1/studio/connectors");

    const starter = [...container.querySelectorAll("button")].find(b => b.textContent === "Help me plan my week")!;
    act(() => starter.click());
    const input = container.querySelector("textarea")!;
    expect(input.value).toBe("Help me plan my week");
    expect(document.activeElement).toBe(input);
    expect(nav.push).not.toHaveBeenCalled();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    expect(nav.push).not.toHaveBeenCalled();

    act(() => container?.querySelector<HTMLButtonElement>('[aria-label="Dismiss the setup checklist"]')?.click());
    expect(container.querySelector("aside section")).toBeNull();
    expect(window.localStorage.getItem("doc:studio-checklist-dismissed:workspace-1")).toBe("1");
    expect(input.value).toBe("Help me plan my week");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(takeChatHandoff("workspace-1", Date.now())).toMatchObject({ text: "Help me plan my week", assistantId: "assistant-primary" });
    expect(nav.push).toHaveBeenCalledWith("/w/workspace-1/chat?v=personal&assistant=assistant-primary");
  });

  it("renders pending approvals as four live groups and opens the queue", async () => {
    const onOpenPanel = vi.fn();
    sidebar.dockLoading = false;
    sidebar.dock = {
      source: "default",
      generatedAt: null,
      note: null,
      needsYou: [{ kind: "approvals", count: 10, caption: null }],
      approvalGroups: {
        externalActions: 4,
        contentReview: 1,
        systemImprovements: 3,
        questionsAndAccess: 2,
      },
      pickUp: [],
      comingUp: [],
      brain: {
        entryCount: 0,
        growth7d: 0,
        sparkline: [],
        hasConnector: true,
      },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <SuggestedView
          workspaceId="workspace-1"
          assistantId="assistant-primary"
          onOpenPanel={onOpenPanel}
        />,
      );
    });

    expect(container.textContent).toContain("Actions to approve");
    expect(container.textContent).toContain("Content to review");
    expect(container.textContent).toContain("Improvements to apply");
    expect(container.textContent).toContain("Questions and access");
    expect(container.textContent).toContain("10");

    const approvalButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Open approvals"),
    );
    expect(approvalButton).toBeTruthy();
    act(() => approvalButton?.click());
    expect(onOpenPanel).toHaveBeenCalledWith("approvals");
  });
});
