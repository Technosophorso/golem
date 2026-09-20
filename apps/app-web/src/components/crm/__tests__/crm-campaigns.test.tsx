import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
vi.mock("@/lib/auth-fetch", () => ({ authFetch: vi.fn() }));
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { CrmCampaignAttribution } from "../crm-campaign-attribution";

describe("[COMP:app-web/crm-campaigns] CRM campaign acquisition panel", () => {
  it("shows verified evidence, limitations, and a Feed deep link without exposing another contact", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={en as unknown as Dictionary}>
        <CrmCampaignAttribution workspaceId="00000000-0000-4000-8000-000000000001"
          contactId="00000000-0000-4000-8000-000000000002" initialAttribution={{
            state: "available", limitation: "Observed attribution only.", conversions: [{
              id: "conversion-1", conversionKind: "enquiry_submitted", occurredAt: "2026-09-20T00:00:00.000Z",
              conversionEvidence: "crm_committed", campaignId: "00000000-0000-4000-8000-000000000003",
              campaignName: "Example launch", channel: "linkedin", placementKey: "body",
              destination: "https://example.com/offer", attribution: {},
            }],
          }} />
      </I18nProvider>,
    );
    expect(html).toContain("Example launch");
    expect(html).toContain(en.crmPage.campaignAttribution.verified);
    expect(html).toContain(en.crmPage.campaignAttribution.limitation);
    expect(html).toContain("/feed/campaigns?campaignId=");
    expect(html).not.toContain("00000000-0000-4000-8000-000000000002");
    expect(html).toContain("mt-4");
  });

  it("states honestly when the CRM record has no attributed outcomes", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={en as unknown as Dictionary}>
        <CrmCampaignAttribution workspaceId="workspace" contactId="contact"
          initialAttribution={{ state: "empty", limitation: "Observed attribution only.", conversions: [] }} />
      </I18nProvider>,
    );
    expect(html).toContain(en.crmPage.campaignAttribution.empty);
  });
});
