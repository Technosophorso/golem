// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { invalidateSurfaceCache } from "@/lib/surface-cache";
import { FeedActionPermissions } from "../feed-action-permissions";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), governance: vi.fn() }));
vi.mock("@/lib/i18n/client", () => ({ useT: () => en }));
vi.mock("@/lib/auth-fetch", () => ({ authFetch: (...args: unknown[]) => mocks.fetch(...args), getAccessToken: () => null }));
vi.mock("@/contexts/feed-profiles-context", () => ({ useFeedWorkspace: () => ({ workspaceId: "workspace", profiles: [], assistants: [{ id: "writer", name: "Writer" }] }) }));
vi.mock("@/components/connectors/connector-tool-governance", () => ({ ConnectorToolGovernance: (props: { tools: { currentPolicy: string }[]; onPolicyChange: (name: string, policy: string) => void }) => {
  mocks.governance(props);
  return <div data-policy>{props.tools[0]?.currentPolicy}<button onClick={() => props.onPolicyChange("writeExample", "allow")}>Allow</button><button onClick={() => props.onPolicyChange("writeExample", "ask")}>Ask</button></div>;
} }));
let root: Root, host: HTMLDivElement, policy: string;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  vi.resetAllMocks(); invalidateSurfaceCache("feed-permissions:"); policy = "ask";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.fetch.mockImplementation(async (url, init) => {
    if (init?.method === "POST") { policy = JSON.parse(init.body).policy; return json({ ok: true }); }
    if (String(url).endsWith("/connectors")) return json({ connectors: [{ id: "example", name: "Example", connected: true, enabled: true, scope: "personal" }] });
    return json({ serverName: "Example server", tools: [{ name: "writeExample", classification: "write", effectivePolicy: policy, appPolicy: "allow" }] });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); invalidateSurfaceCache("feed-permissions:"); });
async function mount() { await act(async () => root.render(<FeedActionPermissions />)); }
describe("[COMP:app-web/feed-action-permissions] Feed action preferences", () => {
  it("loads the Feed assistant without a platform connection and saves Allow then Ask to the canonical policy", async () => {
    await mount();
    expect(host.textContent).toContain("Writer");
    expect(host.querySelector("[data-policy]")?.textContent).toContain("ask");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-policy] button")!.click());
    const write = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(write[0]).toMatch(/assistants\/writer\/connectors\/example\/tools\/policy$/);
    expect(JSON.parse(write[1].body)).toEqual({ serverName: "Example server", toolName: "writeExample", policy: "allow" });
    expect(host.querySelector("[data-policy]")?.textContent).toContain("allow");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-policy] button:nth-of-type(2)")!.click());
    expect(host.querySelector("[data-policy]")?.textContent).toContain("ask");
  });
  it("retains the saved preference and shows a failed write", async () => {
    await mount(); mocks.fetch.mockResolvedValueOnce(json({}, 403));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-policy] button")!.click());
    expect(host.textContent).toContain(en.feedPage.actionPermissions.saveError);
    expect(host.querySelector("[data-policy]")?.textContent).toContain("ask");
  });
  it("shows failed reads with a working retry", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline")); await mount();
    expect(host.textContent).toContain(en.feedPage.actionPermissions.loadError);
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === en.feedPage.tuningChat.retry)!.click());
    expect(host.textContent).toContain("Example");
  });
  it("passes workspace scope and policy floors to the existing governance controls", async () => {
    mocks.fetch.mockImplementation(async url => String(url).endsWith("/connectors")
      ? json({ connectors: [{ id: "example:instance", providerId: "example", name: "Team Example", connected: true, enabled: true, scope: "team-native", instanceId: "instance" }] })
      : json({ serverName: "example", tools: [{ name: "writeExample", classification: "write", effectivePolicy: "ask", appPolicy: "ask" }] }));
    await mount();
    expect(mocks.governance).toHaveBeenLastCalledWith(expect.objectContaining({ assistantId: "writer", connectorId: "example", governanceId: "example:instance", scope: "team-native", workspaceId: "workspace", instanceId: "instance", tools: [expect.objectContaining({ currentPolicy: "ask", minStrictness: "ask" })] }));
  });
  it("revalidates preferences when returning from another surface", async () => {
    await mount(); policy = "block";
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector("[data-policy]")?.textContent).toContain("block");
  });
});
