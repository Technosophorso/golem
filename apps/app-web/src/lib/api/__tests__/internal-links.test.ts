// @vitest-environment jsdom
/** [COMP:app-web/internal-link-controls] Capability-gated internal share links. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  config: {
    apiUrl: "https://api.example.com",
    pageLinkHandoffVersion: 1 as const,
    internalLinkAliasesVersion: 1 as const,
  } as Record<string, unknown>,
}));

vi.mock("@/lib/auth-fetch", () => ({ authFetch: mocks.authFetch }));
vi.mock("@/lib/runtime-public-config", () => ({
  publicRuntimeConfig: () => mocks.config,
}));

import {
  bestInternalShareLink,
  resetInternalLinkCapabilityCache,
} from "../internal-links";

const aliasValue = {
  workspaceId: "workspace-1",
  pageId: "page-1",
  workspaceAlias: "product",
  pageAlias: "roadmap",
  sharePath: "/s/product/roadmap",
  canonicalPath: "/w/workspace-1/p/page-1",
  url: "https://brain.example/s/product/roadmap",
};

beforeEach(() => {
  mocks.config = {
    apiUrl: "https://api.example.com",
    pageLinkHandoffVersion: 1,
    internalLinkAliasesVersion: 1,
  };
  mocks.authFetch.mockReset();
  localStorage.clear();
  resetInternalLinkCapabilityCache();
});

afterEach(() => vi.unstubAllGlobals());

describe("[COMP:app-web/internal-link-controls] share-link capability ladder", () => {
  it("uses a server-confirmed alias, including the existing block anchor", async () => {
    mocks.authFetch.mockResolvedValue(new Response(JSON.stringify(aliasValue), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await bestInternalShareLink({
      workspaceId: "workspace-1",
      pageId: "page-1",
      blockId: "block-1",
    });

    expect(result.url).toBe(`${window.location.origin}/s/product/roadmap#b-block-1`);
    expect(mocks.authFetch).toHaveBeenCalledWith(
      "https://api.example.com/api/internal-links/ensure",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceId: "workspace-1", pageId: "page-1" }),
      }),
    );
  });

  it("uses the ID handoff when aliases are unavailable but the web handoff exists", async () => {
    mocks.config = { apiUrl: "https://api.example.com", pageLinkHandoffVersion: 1 };
    resetInternalLinkCapabilityCache();

    const result = await bestInternalShareLink({ workspaceId: "workspace-1", pageId: "page-1" });

    const url = new URL(result.url);
    expect(url.pathname).toBe("/open");
    expect(url.searchParams.get("path")).toBe("/w/workspace-1/p/page-1");
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it("keeps the canonical URL when the deployment advertises neither capability", async () => {
    mocks.config = { apiUrl: "https://api.example.com" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    resetInternalLinkCapabilityCache();

    const result = await bestInternalShareLink({ workspaceId: "workspace-1", pageId: "page-1" });

    expect(result.url).toBe(`${window.location.origin}/w/workspace-1/p/page-1`);
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it("uses only a previously confirmed cached alias when the ensure call is offline", async () => {
    mocks.authFetch.mockResolvedValueOnce(new Response(JSON.stringify(aliasValue), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    expect((await bestInternalShareLink({ workspaceId: "workspace-1", pageId: "page-1" })).url)
      .toBe(`${window.location.origin}/s/product/roadmap`);

    mocks.authFetch.mockRejectedValueOnce(new Error("offline"));
    expect((await bestInternalShareLink({ workspaceId: "workspace-1", pageId: "page-1" })).url)
      .toBe(`${window.location.origin}/s/product/roadmap`);
  });

  it("discovers browser capabilities once from the deployment route", async () => {
    mocks.config = { apiUrl: "https://api.example.com" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pageLinkHandoffVersion: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    resetInternalLinkCapabilityCache();

    await bestInternalShareLink({ workspaceId: "workspace-1" });
    await bestInternalShareLink({ workspaceId: "workspace-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
