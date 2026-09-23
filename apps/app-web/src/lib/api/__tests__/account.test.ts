/** [COMP:api/account-avatar] app-web account avatar wire contract. */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-fetch", () => ({ authFetch: vi.fn() }));

import { authFetch } from "@/lib/auth-fetch";
import {
  listAccountSessions,
  planProfileRefresh,
  revokeAccountSession,
  revokeAllAccountSessions,
  revokeCurrentAccountSession,
  uploadAvatar,
} from "../account";

const mockAuthFetch = vi.mocked(authFetch);

beforeEach(() => {
  vi.resetAllMocks();
  mockAuthFetch.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("[COMP:api/account-avatar] app-web account API", () => {
  it("sends the active workspaceId with the avatar multipart upload", async () => {
    const file = new File([new Uint8Array([0x89, 0x50])], "me.png", { type: "image/png" });

    expect(await uploadAvatar(file, "ws-active")).toBe(true);

    const init = mockAuthFetch.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("workspaceId")).toBe("ws-active");
    expect(form.get("file")).toBe(file);
  });

  it("round-trips hosted profile changes through the primary auth site", () => {
    const plan = planProfileRefresh(
      "https://usebrian.ai",
      "https://app.usebrian.ai/w/ws-active/p/page-1",
    );

    expect(plan.kind).toBe("redirect");
    if (plan.kind !== "redirect") throw new Error("expected redirect plan");
    const url = new URL(plan.url);
    expect(url.origin).toBe("https://usebrian.ai");
    expect(url.pathname).toBe("/api/auth/refresh-and-return");
    expect(url.searchParams.get("next")).toBe(
      "https://app.usebrian.ai/w/ws-active/p/page-1",
    );
  });

  it("refreshes the profile cookie in place for dev and OSS", () => {
    expect(
      planProfileRefresh(null, "http://localhost:3003/w/ws-active/p/page-1"),
    ).toEqual({ kind: "local" });
  });

  it("lists and revokes account device sessions through scoped endpoints", async () => {
    mockAuthFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      sessions: [{ id: "session-1", deviceLabel: "Browser", current: true }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(listAccountSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1", current: true }),
    ]);

    mockAuthFetch.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(revokeAccountSession("session/1")).resolves.toBe(true);
    await expect(revokeCurrentAccountSession()).resolves.toBe(true);
    await expect(revokeAllAccountSessions()).resolves.toBe(true);

    expect(mockAuthFetch.mock.calls.slice(1).map(([url, init]) => [url, init?.method])).toEqual([
      [expect.stringContaining("/api/account/sessions/session%2F1"), "DELETE"],
      [expect.stringContaining("/api/account/sessions/current"), "DELETE"],
      [expect.stringMatching(/\/api\/account\/sessions$/), "DELETE"],
    ]);
  });
});
