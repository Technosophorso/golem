import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/auth-fetch", () => ({ authFetch: vi.fn() }));

import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { FeedCampaigns } from "../feed-campaigns";

const dict = en as unknown as Dictionary;

describe("[COMP:app-web/feed-campaigns] native campaigns in Feed", () => {
  it("keeps manual social campaign work and honest native-result limitations reachable", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={dict}>
        <FeedCampaigns
          workspaceId="00000000-0000-4000-8000-000000000001"
          initialCampaigns={[{
            id: "00000000-0000-4000-8000-000000000010",
            name: "Example launch",
            objective: "Collect verified enquiries",
            state: "draft",
            timezone: "UTC",
            primaryConversion: "enquiry_submitted",
            version: 1,
            placements: [],
            links: [],
          }]}
        />
      </I18nProvider>,
    );
    expect(html).toContain("Example launch");
    expect(html).toContain(en.feedPage.campaigns.trackingNotConnected);
    expect(html).toContain(en.feedPage.campaigns.attachAction);
    expect(html).toContain(en.feedPage.campaigns.trackLinkAction);
    expect(html).toContain(en.feedPage.campaigns.recordPublicationAction);
    expect(html).toContain(en.feedPage.campaigns.manualHint);
    expect(html).not.toContain("OAuth");
    expect(html).toContain("lg:grid-cols");
  });

  it("renders the create path and an honest empty state", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={dict}>
        <FeedCampaigns workspaceId="00000000-0000-4000-8000-000000000001" initialCampaigns={[]} />
      </I18nProvider>,
    );
    expect(html).toContain(en.feedPage.campaigns.createAction);
    expect(html).toContain(en.feedPage.campaigns.empty);
  });
});
