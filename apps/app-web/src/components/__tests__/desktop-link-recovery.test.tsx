// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import type { DesktopBridge, DesktopLinkNavigationState } from "@/lib/desktop-auth-source";
import { DesktopLinkRecovery } from "../desktop-link-recovery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.fn();
const state: DesktopLinkNavigationState = {
  requestId: "request-1234",
  phase: "choose-deployment",
  appOrigin: "https://team.example",
  sourceUrl: "https://team.example/s/product/roadmap#b-block-1",
  choices: [
    { key: "first", label: "team.example", detail: "https://api-a.example · 1" },
    { key: "second", label: "team.example", detail: "https://api-b.example · 2" },
  ],
  canRetry: false,
  canOpenBrowser: true,
  canCancel: true,
};

let root: Root;
let host: HTMLDivElement;

async function render(bridge: Partial<DesktopBridge>) {
  window.usebrianDesktop = {
    signIn: vi.fn(),
    getLinkNavigation: vi.fn().mockResolvedValue(state),
    onLinkNavigation: vi.fn().mockReturnValue(vi.fn()),
    onLinkNavigationDelivery: vi.fn().mockReturnValue(vi.fn()),
    onChooseDeployment: vi.fn().mockReturnValue(vi.fn()),
    onAccessAuthState: vi.fn().mockReturnValue(vi.fn()),
    listAccounts: vi.fn().mockResolvedValue({ accounts: [], canSwitch: true }),
    linkNavigationAction: actions.mockResolvedValue(true),
    ...bridge,
  };
  await act(async () => {
    root.render(<I18nProvider locale="en" dict={en}><DesktopLinkRecovery /></I18nProvider>);
  });
}

beforeEach(() => {
  actions.mockReset();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.usebrianDesktop;
});

describe("[COMP:app-web/desktop-link-recovery] bounded desktop recovery", () => {
  it("renders the scoped deployment chooser at 390px and sends only fixed actions", async () => {
    await render({});
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("https://team.example");
    expect(document.body.textContent).toContain("https://api-a.example · 1");

    const choice = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("api-b"));
    await act(async () => choice?.click());
    expect(actions).toHaveBeenCalledWith("request-1234", "choose", "second");

    const browser = [...document.querySelectorAll("button")].find((item) => item.textContent === en.internalLinks.openBrowser);
    await act(async () => browser?.click());
    expect(actions).toHaveBeenCalledWith("request-1234", "browser", undefined);
  });

  it("acknowledges route delivery only after the renderer subscription receives it", async () => {
    let deliver!: (requestId: string) => void;
    await render({
      onLinkNavigationDelivery: (callback) => { deliver = callback; return vi.fn(); },
    });
    expect(actions).not.toHaveBeenCalledWith("request-1234", "acknowledge");
    await act(async () => deliver("request-1234"));
    expect(actions).toHaveBeenCalledWith("request-1234", "acknowledge");
  });
});
