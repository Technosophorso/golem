/** [COMP:app-web/auth-sessions] Settings -> Account device-session controls. */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/runtime-public-config", () => ({
  publicRuntimeConfig: () => ({ apiUrl: "http://localhost:4000" }),
}));
vi.mock("@/lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => false),
}));

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { DevicesSection } from "../account-section";

describe("[COMP:app-web/auth-sessions] Devices section", () => {
  it("renders localized loading and account-wide revocation controls", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={en}>
        <DevicesSection />
      </I18nProvider>,
    );
    expect(html).toContain(en.settings.account.devices);
    expect(html).toContain(en.settings.account.devicesDesc);
    expect(html).toContain(en.settings.common.loading);
    expect(html).toContain(en.settings.account.logOutAllDevices);
  });
});
