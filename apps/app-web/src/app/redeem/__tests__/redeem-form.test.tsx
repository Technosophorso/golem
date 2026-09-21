// @vitest-environment jsdom
/**
 * [COMP:app-web/redeem] Redeem form — the Back link target, the
 * replace-confirmation flow for a longer-running promo code, and the
 * localized `not_longer` rejection. See docs/architecture/features/promo-codes.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  refreshUserCookie: vi.fn(),
  confirmDialog: vi.fn(),
}));

vi.mock("@/lib/auth-fetch", () => ({
  authFetch: testMocks.authFetch,
  refreshUserCookie: testMocks.refreshUserCookie,
  getAccessToken: () => null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmDialog: testMocks.confirmDialog,
}));

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { RedeemForm } from "../redeem-form";

const dict = en as unknown as Dictionary;
const t = en.redeem;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("[COMP:app-web/redeem] RedeemForm", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    testMocks.authFetch.mockReset();
    testMocks.refreshUserCookie.mockReset().mockResolvedValue(undefined);
    testMocks.confirmDialog.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderForm(targetWorkspaceId: string | null = "ws-1") {
    await act(async () => {
      root.render(
        <I18nProvider locale="en" dict={dict}>
          <RedeemForm targetWorkspaceId={targetWorkspaceId} prefilledCode="" />
        </I18nProvider>,
      );
    });
    await settle();
  }

  async function typeAndSubmit(code: string) {
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    // React tracks the native input's value setter to dedupe events, so a
    // plain `input.value = ...` assignment is invisible to its onChange —
    // go through the native setter so the dispatched event actually fires.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      nativeSetter.call(input, code);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = host.querySelector<HTMLButtonElement>("button[type='submit']")!;
    await act(async () => button.click());
    await settle();
  }

  it("renders the Back link pointing at the resolved workspace", async () => {
    await renderForm("ws-1");
    const link = host.querySelector<HTMLAnchorElement>("a[href='/w/ws-1/p']");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(t.back);
  });

  it("falls back to '/' for the Back link when no workspace resolved", async () => {
    await renderForm(null);
    const link = host.querySelector<HTMLAnchorElement>("a[href='/']");
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe(t.back);
  });

  it("opens the replace confirmation and re-POSTs with replace_existing on confirm", async () => {
    testMocks.confirmDialog.mockResolvedValueOnce(true);
    testMocks.authFetch
      .mockResolvedValueOnce(
        jsonResponse(409, {
          error: "replace_confirmation_required",
          reason: "replace_confirmation_required",
          current: { plan: "max_5x", expiresAt: "2026-10-01T00:00:00.000Z" },
          incoming: { plan: "max_10x", expiresAt: null },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { plan: "max_10x", planExpiresAt: null, replaced: true }),
      );

    await renderForm("ws-1");
    await typeAndSubmit("LONGER-CODE");

    expect(testMocks.confirmDialog).toHaveBeenCalledTimes(1);
    const confirmArgs = testMocks.confirmDialog.mock.calls[0][0];
    expect(confirmArgs.title).toBe(t.replaceTitle);
    expect(confirmArgs.confirmLabel).toBe(t.replaceConfirm);
    expect(confirmArgs.cancelLabel).toBe(t.replaceCancel);
    expect(confirmArgs.description).toContain("Max 5x");
    expect(confirmArgs.description).toContain("Max 10x");

    expect(testMocks.authFetch).toHaveBeenCalledTimes(2);
    const secondCall = testMocks.authFetch.mock.calls[1];
    const secondBody = JSON.parse(String((secondCall[1] as RequestInit).body));
    expect(secondBody).toEqual({
      workspace_id: "ws-1",
      code: "LONGER-CODE",
      replace_existing: true,
    });

    expect(host.textContent).toContain(t.replaced);
  });

  it("sends no second request when the user cancels the replace confirmation", async () => {
    testMocks.confirmDialog.mockResolvedValueOnce(false);
    testMocks.authFetch.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "replace_confirmation_required",
        reason: "replace_confirmation_required",
        current: { plan: "max_5x", expiresAt: "2026-10-01T00:00:00.000Z" },
        incoming: { plan: "max_10x", expiresAt: null },
      }),
    );

    await renderForm("ws-1");
    await typeAndSubmit("LONGER-CODE");

    expect(testMocks.authFetch).toHaveBeenCalledTimes(1);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.textContent).not.toContain(t.networkError);
  });

  it("shows the localized not_longer message with the current plan's end date", async () => {
    testMocks.authFetch.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "not as long",
        reason: "not_longer",
        current: { plan: "max_10x", expiresAt: "2026-10-01T00:00:00.000Z" },
      }),
    );

    await renderForm("ws-1");
    await typeAndSubmit("SHORTER-CODE");

    expect(testMocks.confirmDialog).not.toHaveBeenCalled();
    const expectedDate = new Date("2026-10-01T00:00:00.000Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    expect(host.textContent).toContain("Max 10x");
    expect(host.textContent).toContain(expectedDate);
    expect(host.textContent).not.toBe("not as long");
  });
});
