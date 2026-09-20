// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import {
  InternalLinkHandoff,
  isDesktopHandoffPlatform,
  resolveBrowserCanonicalPath,
} from "../internal-link-handoff";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(async () => true),
  resolve: vi.fn(async () => ({
    workspaceId: "workspace-1",
    pageId: "page-1",
    workspaceAlias: "product",
    pageAlias: "roadmap",
    canonicalPath: "/w/workspace-1/p/page-1",
    sharePath: "/s/product/roadmap",
    url: "http://localhost/s/product/roadmap",
  })),
}));

vi.mock("@/lib/api/internal-links", () => ({
  authorizeStableInternalLink: mocks.authorize,
  resolveInternalLink: mocks.resolve,
  InternalLinkApiError: class InternalLinkApiError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.authorize.mockClear();
  mocks.resolve.mockClear();
  history.replaceState({}, "", "/s/product/roadmap#b-block-1");
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Macintosh" });
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("[COMP:app-web/internal-link-handoff] public browser handoff", () => {
  it("attempts desktop once and does not retry on rerender or focus", async () => {
    let clickedHref = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
    });
    await act(async () => root.render(
      <I18nProvider locale="en" dict={en}>
        <InternalLinkHandoff input={{ kind: "aliases", workspaceAlias: "product", pageAlias: "roadmap" }} />
      </I18nProvider>,
    ));
    expect(click).toHaveBeenCalledOnce();
    expect(clickedHref).toContain("usebrian://open-url?v=1&url=");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      root.render(
        <I18nProvider locale="en" dict={en}>
          <InternalLinkHandoff input={{ kind: "aliases", workspaceAlias: "product", pageAlias: "roadmap" }} />
        </I18nProvider>,
      );
    });
    expect(click).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain(en.internalLinks.continueBrowser);
    click.mockRestore();
  });

  it("defaults mobile browsers to the website without a native attempt", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 iPhone Mobile" });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => root.render(
      <I18nProvider locale="en" dict={en}>
        <InternalLinkHandoff input={{ kind: "aliases", workspaceAlias: "product", pageAlias: "roadmap" }} />
      </I18nProvider>,
    ));
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("classifies desktop and touch iPad platforms explicitly", () => {
    expect(isDesktopHandoffPlatform({ userAgent: "Mozilla Linux x86_64", platform: "Linux", maxTouchPoints: 0 })).toBe(true);
    expect(isDesktopHandoffPlatform({ userAgent: "Mozilla Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(false);
  });

  it("keeps both actions touch-sized in a 390px viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => root.render(
      <I18nProvider locale="en" dict={en}>
        <InternalLinkHandoff input={{ kind: "aliases", workspaceAlias: "product", pageAlias: "roadmap" }} />
      </I18nProvider>,
    ));
    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.className.includes("min-h-11"))).toBe(true);
    expect(host.querySelector("section")?.className).toContain("max-w-lg");
  });

  it("resolves aliases after auth and rebuilds the stable local path with its block", async () => {
    const destination = {
      kind: "aliases" as const,
      sourceUrl: "https://brain.example/s/product/roadmap#b-block-1",
      appOrigin: "https://brain.example",
      workspaceAlias: "product",
      pageAlias: "roadmap",
      blockId: "block-1",
    };
    await expect(resolveBrowserCanonicalPath(destination, "https://brain.example"))
      .resolves.toBe("/w/workspace-1/p/page-1#b-block-1");
    expect(mocks.resolve).toHaveBeenCalledWith("product", "roadmap");
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("authorizes ID handoffs without calling the alias resolver", async () => {
    const destination = {
      kind: "ids" as const,
      sourceUrl: "https://brain.example/w/workspace-1/p/page-1",
      appOrigin: "https://brain.example",
      workspaceId: "workspace-1",
      pageId: "page-1",
    };
    await expect(resolveBrowserCanonicalPath(destination, "https://brain.example"))
      .resolves.toBe("/w/workspace-1/p/page-1");
    expect(mocks.authorize).toHaveBeenCalledWith(destination);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
