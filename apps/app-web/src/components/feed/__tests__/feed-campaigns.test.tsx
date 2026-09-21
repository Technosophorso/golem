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
          initialResults={{ state: "not_installed", reason: en.feedPage.campaigns.trackingNotConnected }}
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

  it("shows native counts and names unavailable continuity instead of inventing a rate", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={dict}>
        <FeedCampaigns workspaceId="00000000-0000-4000-8000-000000000001" initialCampaigns={[{
          id: "00000000-0000-4000-8000-000000000010", name: "Measured campaign", objective: "Measure",
          state: "active", timezone: "UTC", primaryConversion: "enquiry_submitted", version: 1,
        }]} initialResults={{ state: "available", pageViews: 12, sessions: null, visitors: null,
          verifiedConversions: 2, denominator: "unavailable", limitations: [] }} />
      </I18nProvider>,
    );
    expect(html).toContain("12");
    expect(html).toContain(en.feedPage.campaigns.verifiedConversions);
    expect(html).toContain(en.feedPage.campaigns.smtpAccepted);
    expect(html).toContain(en.feedPage.campaigns.unavailable);
    expect(html).toContain(en.feedPage.campaigns.observedLimitation);
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

  it("offers Email beside social channels and opens the revisioned email review panel", () => {
    const html = renderToString(
      <I18nProvider locale="en" dict={dict}>
        <FeedCampaigns workspaceId="00000000-0000-4000-8000-000000000001" initialCampaigns={[{
          id: "00000000-0000-4000-8000-000000000010", name: "Email campaign", objective: "Send an update",
          state: "draft", timezone: "UTC", primaryConversion: "enquiry_submitted", version: 1,
          placements: [{ id: "00000000-0000-4000-8000-000000000011", sessionId: "00000000-0000-4000-8000-000000000012",
            channel: "email", placementKind: "email_body", placementKey: "email_body", approvedRevision: null,
            publicationReference: null, publishedAt: null }], links: [],
        }]} initialResults={{ state: "empty" }} />
      </I18nProvider>,
    );
    expect(html).toContain(en.feedPage.platformLabels.email);
    expect(html).toContain(en.feedPage.campaigns.email.title);
    expect(html).toContain(en.feedPage.campaigns.email.loading);
    expect(html).not.toContain(en.feedPage.campaigns.recordPublicationAction);
  });
});
