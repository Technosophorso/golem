// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { authFetch } from "@/lib/auth-fetch";
import { getWorkspaceRole } from "@/lib/api/workspaces";
import { setUserInfoCache } from "@/lib/user";
import Page from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "workspace-one" }),
  usePathname: () => "/w/workspace-one/studio/mini-apps",
}));
vi.mock("@/lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("@/lib/api/home-apps", () => ({ listCustomHomeApps: async () => [] }));
vi.mock("@/components/studio/custom-apps-section", () => ({ CustomAppsSection: () => null }));
vi.mock("@/components/association/module-controls", () => ({ AssociationModuleControls: () => null }));
vi.mock("@/components/doc/operator-app-bar", async () => {
  const { Puzzle } = await import("lucide-react");
  return { APP_ICON: new Proxy({}, { get: () => Puzzle }) };
});

const fetchMock = vi.mocked(authFetch);
let root: Root;
let host: HTMLDivElement;
let role: unknown;
let order: string[];
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const handles = () => [...host.querySelectorAll<HTMLButtonElement>('[data-action="reorder"]')];
const render = async () => act(async () => {
  root.render(<I18nProvider locale="en" dict={en}><Page /></I18nProvider>);
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setUserInfoCache(null);
  for (const cookie of document.cookie.split(";")) {
    document.cookie = `${cookie.split("=")[0].trim()}=; max-age=0; path=/`;
  }
  role = "owner";
  order = ["feed", "chat", "page"];
  fetchMock.mockReset().mockImplementation(async (_url, init) => {
    if (init?.method === "PATCH") order = JSON.parse(String(init.body)).homeApps;
    // The API's own role is authoritative even without a member-list identity.
    return response({ role, homeApps: order, members: [] });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setUserInfoCache(null);
});

describe("[COMP:app-web/studio-mini-apps] authenticated editing permissions", () => {
  it.each(["owner", "admin"])("enables dragging and saves changes for a cookieless %s session", async (value) => {
    role = value;
    expect(document.cookie).toBe("");
    await render();
    expect(handles()).toHaveLength(3);
    expect(handles().every((handle) => !handle.disabled)).toBe(true);
    const toggle = host.querySelector<HTMLButtonElement>('[data-app="feed"] [data-action="toggle-app"]')!;
    await act(async () => toggle.click());
    expect(order).toEqual(["chat", "page"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/workspaces/workspace-one"),
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ homeApps: ["chat", "page"] }) }),
    );
  });

  it.each(["member", null, "administrator"])("keeps a %s response read-only, even with a cached owner profile", async (value) => {
    role = value;
    setUserInfoCache({ id: "previous-owner", name: "Previous account", email: "previous@example.com" });
    await render();
    expect(handles()).toHaveLength(3);
    expect(handles().every((handle) => handle.disabled)).toBe(true);
    expect(host.textContent).toContain(en.studioPage.miniAppsPage.readOnlyNote);
  });

  it.each([403, 500])("keeps a failed role response (%s) read-only", async (status) => {
    fetchMock.mockResolvedValue(new Response("{}", { status }));
    expect(await getWorkspaceRole("workspace-one")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps transport and malformed response failures read-only", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await getWorkspaceRole("workspace-one")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("invalid json"));
    expect(await getWorkspaceRole("workspace-one")).toBeNull();
  });
});
