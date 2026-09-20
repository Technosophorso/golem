# Native campaigns and attribution

Use Brian includes native Feed campaigns, first-party web attribution, CRM
linkage, and approved SMTP email broadcasts. No analytics vendor, redirect
service, social OAuth connection, or marketing automation account is required.

## Install first-party tracking

1. In Feed, create a campaign and a site. Register every exact `http` or
   `https` origin that may send observations.
2. Create a site credential with `conversion:write` only for the backend that
   records successful business outcomes. The credential is shown once and is
   stored hashed.
3. Load the tracker from your own API and initialize it with the public site ID:

```html
<script src="https://YOUR_API/api/campaign-tracking/tracker.js"></script>
<script>
  BrianCampaign.init({
    collectUrl: "https://YOUR_API/api/campaign-tracking/collect",
    siteId: "YOUR_PUBLIC_SITE_ID",
    enabled: true,
    storageMode: "none",
    storageAllowed: false
  });
</script>
```

The tracker automatically records the first page view and SPA navigation made
with `history.pushState`, `history.replaceState`, or browser history. Record
bounded interactions with `BrianCampaign.track("cta_clicked", metadata)` and
`BrianCampaign.track("form_started", metadata)`. Never put form values in
metadata.

Storage defaults to `none`. To retain continuity for up to 30 days, set
`storageMode: "first_party"` and `storageAllowed: true` only after the host
site's existing preference flow grants storage. A shared cookie domain works
only for explicitly registered sibling sites in one site group. Calling
`BrianCampaign.disable()` stops events and clears Brian-owned continuity.

## Record a conversion

Browser events are observations, not verified outcomes. After a signup, order,
or enquiry commits, send a server-to-server request:

```http
POST /api/campaign-tracking/conversions
Authorization: Bearer sk_campaign_...
Content-Type: application/json

{"version":1,"siteId":"YOUR_PUBLIC_SITE_ID","conversionKind":"enquiry_submitted","externalOutcomeId":"enquiry-123","occurredAt":"2026-09-20T08:00:00Z","metadata":{}}
```

Use one stable `externalOutcomeId` and stable `occurredAt` for every retry.
Exact replay returns the original conversion as a duplicate. Reusing the same
identity with changed data returns a conflict. A site credential cannot assert
a CRM contact ID; CRM-linked outcomes use the committed CRM intake path.

## Tracked links and email

Tracked social links preserve unrelated query fields and fragments, and add
standard UTMs plus an opaque `brian_link`. A distributed link has an immutable
destination. Create another link if the destination changes. Manual LinkedIn
publication needs no provider connection; save the resulting permalink in
Feed. Provider impressions remain unavailable without provider evidence.

Email subject, preheader, body, audience, sender, and purpose share one Feed
revision and approval snapshot. Live email requires an authorized SMTP sender,
a public unsubscribe origin, and DKIM coverage before RFC 8058 one-click is
claimed. Every recipient gets a separate envelope. V1 allows 500 recipients
per broadcast and 10 SMTP handoffs per minute per sender.

## Privacy, retention, and recovery

The tracker records bounded paths and attribution fields. It does not collect
form values, full URLs, fingerprints, raw IP or user-agent strings, email
hashes, or open pixels. Raw observations default to 90 days; non-identifying
daily aggregates default to 13 calendar months. Test traffic is excluded from
production totals. Export and erasure include linked campaign records, tokens,
cached projections, and queued work.

Pause or cancel prevents only future recipient admission. Accepted email cannot
be recalled. A possible SMTP acceptance is marked `needs_reconciliation` and
is never resent automatically. GET on an unsubscribe URL is only a preview;
confirmed POST changes consent.

If tracking is unconfigured, disabled, blocked, or fails, a valid redirect,
signup, or enquiry still succeeds. Results report the limitation instead of
inventing continuity, conversions, inbox delivery, replies, bounces,
complaints, or social impressions.
