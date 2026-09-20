# Native campaigns, email, and attribution

**Status:** Locked for one-shot implementation. Product scope and v1 defaults below are the execution contract; §15 defines local acceptance and the production handoff. Schema additions are implemented and proved in Phase 0, not already present. Nothing in this document claims the feature is implemented.
**Date:** 2026-09-20
**Placement:** Complete product capability in the open `use-brian/` repository. Platform documentation and first-party marketing-site instrumentation are separate integration changes.
**Dependency decision:** No required external analytics, campaign-management, link-shortening, or marketing-automation service.

## 1. Outcome and product decisions

A workspace can prepare a campaign in Feed, draft social posts and email, generate tracked links, measure website conversions, and connect results to canonical CRM records. Brian can perform and explain the same operations through its tools.

| Decision | Contract |
|---|---|
| Product home | Extend Feed. Do not create another Home mini app. |
| Channel navigation | Email is a peer of LinkedIn, X, Threads, Instagram, and XHS. The user-facing selector becomes **Channels**. Preserve existing platform identifiers and URLs. |
| Campaign scope | A workspace-level campaign groups content across channels. It can be opened from Feed, a CRM record/segment, or Brian chat. |
| Feed ownership | Campaign objective, content, drafts, tracked links, review, publication/send scheduling, and results. |
| CRM ownership | People, companies, deals, segments, identity proof, consent, suppression, eligibility, recipient history, and follow-up. |
| Native measurement | Brian's API, PostgreSQL, a small website tracker, and trusted conversion calls provide the baseline. No PostHog, GA, external redirect service, or remote tracking SDK is needed. |
| Email infrastructure | Sending requires a configured SMTP transport, which may be self-hosted. Brian does not become a mail-transfer server or silently borrow its authentication/invitation sender. |
| First useful release | Manually published social posts can produce attributed website visits and conversions before Email sending is enabled. |

The first release supports one email broadcast per approved dispatch. A campaign can contain several separately approved broadcasts. Automated drip sequences, A/B allocation, paid-ad management, session replay, and external analytics integrations are later work.

“No external tools” means no new SaaS account or connector is required for campaign records, link generation, collection, attribution, or reporting. Existing Brian runtime/database infrastructure remains necessary. Email transport and the recipient's mail system remain necessary to deliver mail; a local SMTP test sink proves the workflow without a SaaS account. Assisted drafting uses the workspace's existing model configuration; manual drafting and measurement do not require an additional model service.

## 2. Existing implementation to reuse

Paths below are relative to the open repository unless explicitly marked platform-side.

| Existing seam | Reuse and required extension |
|---|---|
| `apps/app-web/src/lib/feed-nav.ts` | Already distinguishes draftable targets from provider-connected targets. Add Email authoring without requiring connection; add capability-driven email delivery controls. |
| `packages/api/src/db/content-planning-store.ts` and `routes/content-planning.ts` | Existing draft/session persistence and manual posted state. Associate campaigns and placements without replacing draft identity. |
| `packages/shared/src/feed-composition.ts`, `packages/doc-model/src/feed/`, `packages/api/src/content-planning/` | Canonical composition, revisions, comments, suggestions, confirmation, and Brian collaboration. Extend these for typed email metadata and rendering. |
| `apps/app-web/src/components/feed/feed-insights.tsx` | Current social-provider insights require a connected profile. Native campaign results must also work for unconnected/manual channels and are not gated by this profile requirement. |
| `packages/api/src/crm-operations/service.ts` | Canonical intake, segments, consent, suppression, domain events, and identity operations. Campaigns invoke this authority rather than write CRM tables directly. |
| `packages/api/src/crm-operations/delivery-service.ts` and `delivery-policy.ts` | Durable per-message receipts, current sender authority, final delivery admission, and uncertain-outcome recovery. Reuse these for campaign delivery. |
| `packages/api/src/mailbox/smtp.ts` | Existing MIME composition and SMTP transport behind CRM admission. Extend through the existing delivery adapter, keeping campaign-specific headers/rendering governed. |
| Existing `crm_email_drafts` and revisions | Existing direct-contact email drafts remain canonical for that workflow. Feed campaign compositions are reusable broadcast content; do not create independently editable copies in both systems. |
| `packages/api/src/routes/crm-intake.ts` | Existing server-only, scoped intake credential and idempotent submission boundary. Extend to accept bounded attribution references alongside the successful submission. |
| `packages/api/src/boot.ts` | Shared OSS/hosted mounting and workers. Public collection, redirect, and unsubscribe routes must precede broad authenticated `/api` guards. |
| Platform `apps/web` and `apps/studio` | First-party integration clients of the open collector and conversion API. They do not own campaign storage or the only working tracker. |

CRM operations currently excludes campaign authoring and bulk scheduling from its generic core. This plan preserves that boundary: Feed owns the campaign domain and calls CRM services. Existing product/operational `analytics_events` is not the customer-facing marketing-event database; keep attribution retention, permissions, and query load separate.

The platform currently mirrors target lists in `packages/api-platform/src/db/feed-store.ts`. When Email ships, derive the relevant hosted target vocabulary from the open contract; do not create a second campaign implementation. Existing hosted social OAuth/publishing boundaries are unchanged.

## 3. User journeys and interface

### 3.1 Social post and website conversion

1. Create a campaign in Feed with a name, objective, primary conversion, reporting timezone, and optional date range.
2. Attach an existing draft or create a draft in a selected channel. A draft need not belong to a campaign.
3. Choose **Track link**, enter a destination, and select a placement such as post body, first comment, or profile. Brian generates a stable link and shows the tags.
4. Review the exact final content, including generated links, through the existing Feed review flow.
5. Publish through an available adapter or copy and publish manually. Save the external permalink and publication time. Manual posting must not require social OAuth.
6. Feed shows observed visits and trusted conversions by campaign, post, and link. A linked CRM lead/deal shows its recorded acquisition source.

Website reporting starts when the tracker or server integration is installed. A link can be generated before installation, but Results must say **Tracking not connected**, not display a misleading zero-conversion success state.

### 3.2 Email broadcast

1. Select **Email** in Feed, or choose **Create email campaign** on an authorized CRM segment.
2. Select the campaign, sender, purpose, and CRM audience. Review eligible, excluded, and unresolved counts with reasons.
3. Draft subject, optional preheader, and body with the same Brian refinement, comments, and version history used elsewhere in Feed.
4. Preview HTML and plain text, including resolved personalization, tracked links, and unsubscribe information. Send a test to explicitly selected test recipients.
5. Approve the exact revision, sender, recipient snapshot, tracking settings, and send time. Send now or schedule that approved dispatch.
6. Inspect individual send outcomes, campaign results, and related CRM activity. Pause/cancel affects only recipients not yet handed to SMTP.

The CRM segment action opens the same Feed campaign object, not a separate campaign editor. Ordinary one-to-one CRM correspondence stays in its existing CRM workflow.

### 3.3 Navigation and reporting

- Keep Plan and brand voice at Feed's shared level. Add a shared **Campaigns** view; a campaign detail contains content from all its channels.
- The channel selector includes Email. Within Email, use **Emails**, **Send**, and **Recipients** where social-channel copy would say **Posts**, **Publish**, or **Followers**.
- Put results on post/email detail and campaign detail. Native campaign results are available without a provider connection; provider social metrics remain an optional separate data source.
- In CRM, show acquisition details and links to the campaign/content on contacts and deals. Aggregate campaign access must not grant access to restricted contacts.
- Follow existing responsive, surface-cache, workspace-event, component, and locale conventions. New product strings cover all four app-web dictionaries.

## 4. Domain model and mutation authority

Introduce an open campaign domain with one typed command service used by Brian, Brain MCP, REST, UI, and workers. Reuse Feed's composition authority and CRM's relationship/delivery authority rather than duplicating their transactions.

New storage contracts to implement (migration numbers are allocated at execution time):

| Record | Durable meaning |
|---|---|
| `campaigns` | Workspace, owner, name, objective, state (`draft`, `active`, `completed`, `archived`), timezone, primary conversion definition, optional dates. |
| `campaign_placements` | Campaign, existing draft/session, channel, sending account if relevant, placement kind, approved revision, publication/dispatch reference. One draft can have several explicit placements. |
| `campaign_links` | Opaque public link ID, placement, fixed destination, immutable normalized UTM snapshot, creation actor, enabled state. |
| `campaign_sites` | Workspace-owned site, explicit allowed origins, conversion definitions, public collection ID, private integration credentials, storage mode, retention settings. |
| `campaign_events` | Validated event envelope, origin/evidence level, link/site/session references, timestamps, test/bot classification, bounded metadata. No content transcripts. |
| `campaign_subject_links` | Evidence-backed association of anonymous attribution context to a canonical CRM contact or application subject. Source, time, purpose, and erasure coverage are explicit. |
| `campaign_conversions` | Trusted conversion identity, type, event time, attribution snapshot/version, canonical subject/outcome references, optional value and currency. |
| `campaign_email_dispatches` | Frozen approved campaign/email revision, sender/purpose, audience snapshot, schedule, actor/authority, and dispatch state. |
| `campaign_email_recipients` | Frozen contact/address snapshot, personalization snapshot, eligibility evidence, stable delivery ID, and reference to the existing CRM delivery receipt. |

Add conversion-definition and aggregate storage only where required by the read path; raw traffic should not become one brain entity or memory per visit. Brian reads bounded reports and explicit summaries with evidence links.

All foreign references validate workspace ownership. Ordinary reads use membership/resource permissions and RLS. Worker bypasses are narrowly scoped to a previously authorized workspace/job and recheck current authority. Writes carry a stable idempotency key and canonical request fingerprint; conflicting reuse fails visibly. Editing content uses Feed revisions and commands, not a second campaign text-update endpoint.

Campaign archive preserves already distributed links and historical attribution. It does not authorize sends. Link disable is separate and does not silently retarget an old URL. A destination change creates a new link/version and requires review before another send/publication.

## 5. Native links and collection

### 5.1 Link format and UTM policy

Default to a direct destination URL carrying standard UTMs plus a non-secret, opaque `brian_link` ID:

```text
https://www.example.com/?utm_source=linkedin&utm_medium=organic_social&utm_campaign=launch_2026_09&utm_content=p001_body&brian_link=<opaque-link-id>
```

- Generate lowercase source/medium values from the channel catalog; Email uses `utm_medium=email`, with a stable workspace-defined source such as `newsletter`.
- Campaign display names may change; published campaign identifiers and link tags stay stable. Reusing the same draft in another campaign or placement creates a new link.
- Preserve unrelated destination query parameters and fragments. Existing attribution parameters must be shown and explicitly replaced or retained, never silently double-appended.
- Registered link IDs are the stable reporting join. UTMs without a recognized link are recorded as external/unmapped acquisition evidence, not guessed into an existing campaign.
- Never put recipient email addresses, names, CRM IDs, access credentials, or reusable authentication tokens in UTMs.
- Internal links between a workspace's registered sites preserve the incoming context rather than create a fresh campaign touch.

Offer a native redirect URL for click-request measurement, hosted on the deployment's public origin, with an optional site-owned reverse-proxy path. Resolve only a stored destination; never accept arbitrary `?url=` redirects. Redirect IDs must be unguessable, destinations limited to approved HTTP(S) policy, and credentials/control characters rejected. Browser destinations are not fetched by the server.

Use a non-cacheable temporary redirect so repeated requests reach the measurement boundary. Failure to store analytics must not break a valid redirect; destination lookup failure is an honest unavailable response. A direct tagged link keeps working even if the collector is down.

### 5.2 Event collection contract

Ship a small first-party browser asset plus a typed server integration. Neither loads a remote SDK. The tracker has an explicit initialization API and manual event hooks; no input autocapture, form scraping, replay, or session recording.

Routes to implement:

| Boundary | Contract |
|---|---|
| `GET /api/campaign-tracking/tracker.js` | Versioned browser asset served by Brian; self-host/reverse-proxy supported. |
| `POST /api/campaign-tracking/collect` | Public, write-only, bounded browser observations. Publishable site ID is not a credential. |
| `GET /r/:linkId` | Native redirect plus raw request observation. |
| `POST /api/campaign-tracking/conversions` | Backend-only, scoped site credential; trusted conversion event with stable business idempotency key. |
| Existing CRM intake boundary | Atomically persist bounded attribution context with a successful intake; emit one committed outcome for conversion projection. |

Browser events include `page_view`, `cta_clicked`, and `form_started`. Conversion definitions include `signup_completed`, `enquiry_submitted`, and `activation_completed`, but only an authoritative backend/CRM event can enter the **verified conversions** metric. Optional client conversion hints remain explicitly unverified.

Require an event ID, schema version, site ID, event type, event/receipt time, and bounded allowlisted fields. Apply server receive time and clock-skew rules; browser timestamps cannot rewrite first touch indefinitely. Duplicate event IDs do not increment counts; conversion deduplication also uses `(workspace, site, conversion kind, external outcome ID)`.

Public collection checks configured origins and schemas, rate/byte limits, and quotas. CORS, Origin, and a publishable site ID reduce accidental misuse but do not authenticate a person or prove conversion. Public payloads cannot supply a trusted CRM identity, deal value, or sender authority. Server keys never enter the browser, URLs, or logs; store hashed credentials with narrow grants and rotation/revocation support.

Mount public routes in open boot before broad JWT middleware. Preserve this ordering in both editions. Installation documentation must include CSP and optional same-origin proxy setup; ad-blocker or network failures remain measurable limitations, not something to bypass covertly.

### 5.3 Metric definitions

| Metric | Definition and limitation |
|---|---|
| Redirect requests | Requests reaching a redirect, including unknown scanners. Not synonymous with people or visits. |
| Page views | Accepted instrumented page-load/SPA-navigation events, deduplicated by event ID. Installation must not double-count hydration plus navigation. |
| Sessions | A permitted first-party identifier with a 30-minute inactivity boundary. Without continuity evidence, show page views and session count unavailable. |
| Visitors | Distinct pseudonymous browser IDs where permitted; never call this a verified count of people or sum it across disconnected identity scopes. |
| Verified conversions | Successful backend/CRM outcomes recorded once by business identity. A button click, email submission attempt, or verification-code request is not completion. |
| Leads and deals | Canonical CRM records actually linked by an authorized operation, counted once per report definition. |
| Email accepted | SMTP transport accepted the message; not proof of inbox delivery, reading, or human engagement. |

Use conservative local bot/scanner classification with `known_automated`, `unknown`, and observed-browser categories. Retain the classification version and separate raw from filtered counts. Do not market filtered traffic as proven human. Test events have an explicit marker and stay out of production totals.

## 6. Identity, attribution, and website integration

### 6.1 Browser storage and subdomains

Two modes ship with explicit installation behavior:

- `none`: default integration mode until the site supplies its permitted storage state. Capture allowed observations without a persistent visitor cookie or fingerprint. Only retain context in the current page/SPA memory; reloads and later visits may not connect.
- `first_party`: the site's existing preference/consent flow permits a pseudonymous first-party identity and bounded attribution context. Maximum lifetime is 30 days, configurable shorter. Withdrawal stops persistence and clears Brian-owned browser state.

The tracker offers enable/disable hooks; absence of cookie permission is not automatically permission to collect events. A site's existing tracking preference can disable collection entirely. Do not add a competing consent manager or claim that one setting satisfies every jurisdiction.

For an apex and sibling subdomains, the site may explicitly configure a validated common cookie domain and shared site group. Only trusted registered siblings may join; ordinary localStorage is origin-specific. Match browser identity scope, site ownership, and backend attribution scope. Never reuse authentication cookies or widen auth-cookie domains to solve analytics.

Unrelated registrable domains and different browsers remain separate in v1. No fingerprinting, email-hash identification, or covert cross-domain linking. Track only the continuity the visitor's browser and the application's authenticated evidence support. Cookie scope behavior follows the [browser cookie contract](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

### 6.2 Attribution rules

Store first observed acquisition separately from the latest eligible external campaign touch. Default conversion lookback is 30 days and is versioned with every attribution snapshot. Direct visits and navigation among registered internal sites do not overwrite a known external campaign. A later explicit external campaign can update last touch.

On a trusted conversion, freeze the eligible first/last touches, source evidence level, lookback, conversion time, and rule version. If there is no eligible evidence, show **Unattributed**. The reporting rule describes observed attribution, not causal credit for a sale.

A signed/server-held context can prevent field tampering, but cannot prove that a browser really arrived from LinkedIn. Keep `conversion_evidence` separate from `acquisition_evidence`. A successful backend conversion with self-reported UTMs remains a verified conversion with client-observed source.

Associate a visitor with a CRM contact only through verified application identity, successful canonical intake resolution, or an authorized explicit link. A public `identify(contactId)` call and an email-link click are insufficient. Forwarded mail can be opened by someone other than the intended recipient.

Persist attribution at the successful business boundary and use a transaction/outbox projection into campaign results. A failed collector must not fail a signup or enquiry. Replayed intake/outbox events must not create a second lead or conversion. Privacy-erased links cannot be reconstructed from a stale queued event.

### 6.3 First-party launch integration

The platform marketing and Studio sites will consume the same documented open tracker as any customer site. Integrate page views and meaningful CTA events, plus successful signup and verified enquiry outcomes. If signup completes on a third first-party app/auth surface, carry the bounded context through the existing auth handoff and emit completion from its authoritative backend.

For Studio, distinguish demo/consultation interaction, email verification, and a successfully accepted enquiry. The first-party rollout enables verified signup and enquiry outcomes. Product activation stays unavailable until an operator configures an explicit successful user-value event through the conversion-definition contract; do not label the first page view or token spend as activation. Supporting that contract is in scope; choosing a product activation event is not a prerequisite for this build.

Acceptance examples in the public repository use `example.com`, `studio.example.com`, and fabricated contacts. Deployment configuration supplies real origins and workspace IDs.

## 7. Reporting and CRM linkage

Native results support date range, campaign, channel, placement, destination/site, conversion type, test exclusion, and attribution model. Default to last eligible external touch, with first touch selectable. Never add first-touch and last-touch totals together as if they were separate conversions.

Start with indexed PostgreSQL queries and a bounded daily aggregate worker only when needed. No separate stream processor, Redis deployment, warehouse, or analytics subscription is required. Store UTC event times and use the campaign timezone for display/day boundaries.

Show both conversion counts and denominators. Conversion rates use the same attributable cohort/window; where identifiable sessions are unavailable, display counts instead of inventing session rates. Native tracking cannot infer LinkedIn impressions or click-through rate; imported/provider metrics display their source and freshness separately.

CRM activity links to a campaign and a concrete conversion/dispatch, while preserving canonical contact/deal permissions. Campaign rows can reference canonical deal outcomes; pipeline value and won revenue remain separate, and currencies are not silently combined. Changing a deal does not mutate the historical signup/enquiry conversion.

Brian must be able to answer “Which posts brought verified enquiries?” with the date window, model, numerator, evidence, and limitations, and open the relevant records. A campaign review does not automatically activate new brand rules; existing decision-learning confirmation remains authoritative.

## 8. Email as a native Feed channel

### 8.1 Authoring and capability model

Introduce a shared channel capability catalog used by draft APIs, UI, rendering, validation, and sending. Preserve legacy `platform` wire keys and the `twitter` identifier through a compatibility adapter. Update schema CHECKs/title parsing/serialization and hosted target mirrors together, without routing Email into social OAuth adapters.

Email has typed subject, preheader, body composition, sender reference, reply-to, audience reference, purpose, personalization field catalog, and tracking options. Keep subject/preheader changes in the same atomic revision history as body changes. Canonical Feed composition remains authoritative; HTML and plain text are derived output. Do not maintain an editable HTML copy and a separate editable Feed body.

Reuse safe MIME and rendering primitives, extending them for preheader and list headers where necessary. One initial email layout is sufficient. Preserve the established brand source for branded defaults; do not invent a second template/editor system or visual brand in this engineering plan.

Personalization uses an enumerable allowlist with typed fallback behavior. Freeze the approved values or approved source snapshot at dispatch approval. Missing required values block that recipient before dispatch. Private CRM context must not enter public-channel generation or shared public brand memory; campaign tools combine Feed permission with explicit CRM audience access.

### 8.2 Audience snapshot and approval

At approval, snapshot segment identity/query revision, exact eligible contact/address set, excluded reasons, message revision, sender/account identity, purpose, personalization values, link set, schedule, and tracking options. Deduplicate addresses within one broadcast. Never send a bulk To/Cc/Bcc envelope; each recipient receives a separate message.

Resolve current eligibility through `evaluateCrmSendability` and final CRM delivery admission. `blocked` and `unknown` never count as permission. A changing segment may remove sendable recipients at final admission, but must not add newly matching recipients to an already approved dispatch. Address/sender/purpose/content changes require a new reviewed dispatch; the worker must not substitute them silently.

Campaign draft approval is distinct from authorization to send. A calendar slot alone never schedules publication. Send/schedule approval binds an immutable dispatch snapshot and the acting principal's current grants, with a durable audit trail. Tests and previews do not authorize a live audience send.

### 8.3 Dispatch and recovery

Use a PostgreSQL-backed leased outbox on the existing worker infrastructure. Send jobs hold stable dispatch/recipient/delivery IDs, bounded concurrency, and sender rate limits. V1 defaults: at most 500 recipients per broadcast and 10 transport handoffs per minute per sender; limits can be lowered and must honor the configured transport's limits. These are application limits, not a deliverability promise.

Campaign dispatch states are `draft`, `ready`, `scheduled`, `sending`, `paused`, `completed`, `cancelled`, and `needs_attention`. Recipient rows reference canonical CRM delivery receipts instead of inventing competing provider-result state.

Reuse `createCrmDeliveryService` for claim-before-send, current authority, and idempotent replay. Recheck sendability immediately before each handoff, under the existing CRM admission mechanism. A revoked sender grant, changed account, privacy action, or unsubscribe prevents subsequent unadmitted messages.

Do not promise exactly-once SMTP delivery. If the process crashes or the connection fails after a potentially accepted handoff, preserve the existing `needs_reconciliation` behavior; do not retry automatically. Definitive pre-handoff transient failures may use bounded retries. A human reconciliation action must record evidence and never relabel an uncertain message as unsent without proof.

Pause/cancel stops future admissions. Messages already accepted by SMTP cannot be recalled. Report accepted, rejected, suppressed, pending, and uncertain counts separately, following [SMTP responsibility semantics](https://www.rfc-editor.org/rfc/rfc5321).

### 8.4 Transport, unsubscribe, and replies

Support the existing authorized SMTP mailbox path, including a self-hosted SMTP server. If receive-side IMAP setup is currently mandatory, make SMTP-only campaign sending an explicit supported capability through that same transport authority. Do not require a new marketing SaaS connector or expose credentials to Feed tools/browser code.

Keep `email/smtp-client.ts` service/authentication mail separate. Campaign sender configuration must establish the authorized From identity, TLS/credential handling, reply-to, limits, and public unsubscribe origin. The operator remains responsible for its sending domain/SMTP configuration; native campaign software does not itself establish domain reputation.

Every live marketing email includes a visible native unsubscribe link. A GET renders a confirmation page so link scanners do not mutate consent. The user-confirmed POST records withdrawal for the campaign's declared marketing purpose through CRM; it does not disable unrelated service mail. Provide an explicit all-marketing choice through the CRM purpose catalog.

Use opaque purpose/recipient-bound tokens, no raw personal identifiers, no login requirement, and no dependence on analytics cookies. Repeated requests are idempotent and cannot disclose contact records. Also support the standard one-click POST endpoint and headers, including the required DKIM coverage of those headers; validate the configured SMTP signing path before claiming one-click support. See [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058).

Native click collection can reference the intended email delivery using an opaque redirect token, but records a link request, not the recipient's identity or proof of human reading. Strip recipient-level tracking tokens before destination navigation; only a non-personal placement ID may reach the destination. Do not upgrade this token into authenticated website identity.

No open pixels in v1. Show replies only when an existing mailbox sync or explicit recorded outcome supplies evidence matched to message/thread IDs. Show downstream delivery/bounce/complaint status only when the configured transport/mailbox path supplies it; unsupported metrics are unavailable. Apply confirmed bounces/complaints through existing CRM suppression commands. SMTP-only setups remain usable with accepted/rejected/uncertain results and native link/conversion tracking.

## 9. Privacy, reliability, and bounded operation

- Public tracking never reads CRM or reveals campaign configuration. Browser collection is untrusted observation; private conversion credentials have site-specific write scope only.
- Do not store full query strings, fragments, form fields, chat text, email bodies, or raw recipient addresses in campaign traffic events. Allowlist UTM fields and configurable sanitized page-path templates; paths/referrers may contain personal data too.
- Raw IPs and user-agent strings are not retained in marketing events. Abuse controls may use short-lived, rotating request keys in the existing limiter; do not turn them into visitor identity.
- Retention defaults: 90 days for raw traffic, 13 calendar months for non-identifying daily aggregates. CRM-linked outcomes, delivery evidence, and suppression follow existing workspace retention and privacy policy. Hashing an identifier does not exempt it from erasure.
- Integrate new personal-data rows, snapshots, credentials, and caches into subject export, erasure, workspace flush, retention previews, and worker admission. Preserve necessary non-identifying counts only where permitted by the existing policy.
- Withdrawing marketing consent and withdrawing website tracking preference are different operations; neither silently changes the other.
- Quotas apply per site/workspace. Tracking overload cannot starve chat, CRM, or mail workers. Drop/throttle untrusted observations visibly, while durable successful business conversions project from an outbox.
- Validate all link destinations without server-side fetching, prevent header injection, protect sender configuration, and avoid open redirects. Unsubscribe mutations accept only the narrowly scoped capability token.
- Reports distinguish empty, not installed, not supported, collection disabled, delayed, and failed states. Tracking failure never changes the customer-facing success of a valid business operation.

## 10. API, Brian tools, and implementation placement

Member API operations live under `/api/campaigns` and its site-configuration routes; public routes are listed in §5. Implement the operations below through the existing discovery/capability registries before prompts mention them.

| Tool group | Required operations |
|---|---|
| Campaigns | `listCampaigns`, `getCampaign`, `saveCampaign`, `archiveCampaign`, `attachCampaignContent`. |
| Links/sites | `createCampaignLink`, `listCampaignLinks`, `getCampaignTrackingSetup`, `verifyCampaignTracking`. |
| Results | `getCampaignResults`, `getCampaignAttribution`, bounded drill-down through existing CRM reads. |
| Email | Existing Feed draft/edit tools with Email capabilities; `previewCampaignAudience`, `previewCampaignEmail`, `sendCampaignTest`, `prepareCampaignDispatch`, `scheduleCampaignDispatch`, `pauseCampaignDispatch`, `cancelCampaignDispatch`. |

Each safe semantic mutation is available through Brian and the first-party UI using the same command. Consequential sends/configuration use the existing confirmation/proposal authority. An assistant cannot use a public collector to bypass a missing campaign/CRM grant. Tool inputs resolve enumerated channel/site/conversion/purpose/segment/sender IDs and return actionable errors for unavailable resources.

Code placement:

| Open path | Responsibility |
|---|---|
| `packages/shared/src/campaigns.ts` and shared Feed contracts | Schemas, channel capabilities, portable IDs and event envelopes. |
| `packages/core/src/campaigns/` | Pure attribution rules, tool contracts, capability policy, and service ports. |
| `packages/api/src/campaigns/` | Canonical campaign service, collection, aggregation, and dispatch orchestration. |
| `packages/api/src/db/campaign-*.ts` and `packages/api/migrations/` | Owned storage, RLS, idempotency, retention, and leased jobs. |
| `packages/api/src/routes/campaigns.ts` and `campaign-tracking.ts` | Authenticated and public adapters mounted by open boot. |
| Existing `packages/api/src/crm-operations/` and `mailbox/` | CRM attribution intake/outbox extension and delivery adapter reuse. |
| `apps/app-web/src/components/feed/` and Feed routes | Campaign UI, Email target, results, recipient review, and installation diagnostics. |
| `apps/app-web/src/components/crm/` | Campaign entry points, acquisition/activity panels, and deep links. |
| `packages/api/src/campaigns/browser/` | Small self-hosted browser asset source and its served build artifact. |

These are new paths to create where no existing component owns the behavior; inspect existing exports/build recipes before adding components. No new application deployment or Home app registry entry is required.

Hosted wiring consumes the open implementation. Its only necessary additions are deployment configuration, narrowly scoped composition wiring, and tracker/conversion integration for platform-owned sites. Do not place the only collector, campaign UI, SMTP worker, or report in `packages/api-platform` or `apps/admin`.

## 11. Implementation phases and barriers

### Phase 0: contracts and transaction proof

- Promote reviewed decisions to the relevant architecture specs; update paired knowledge entries and component-map rows as implementation begins.
- Define shared schemas, campaign/placement/link/site ownership, capability catalogs, collection trust levels, attribution rules, and idempotency contracts.
- Allocate migrations from the current cross-repository sequence; do not reserve a number in this plan.
- Prove workspace isolation, replay conflicts, link immutability, migration execution, and authorized tool/UI parity against a disposable database before enabling public collection.

### Phase 1: campaigns and links for manual social publishing

- Add campaign CRUD and draft associations in Feed, Brian tools, tagged direct links, native redirects, and manual permalink recording.
- Keep existing social drafting/publishing intact; no OAuth is required for manual LinkedIn content.
- Ship link/setup diagnostics and explicit test traffic separation.

**Barrier:** An OSS workspace can create a campaign and obtain working links without any third-party analytics credentials.

### Phase 2: native measurement and CRM attribution

- Add the browser asset, public ingestion, trusted conversion API, scoped credentials, first-party continuity, retention, reporting, and canonical CRM intake/outbox linkage.
- Add first/last-touch results, unattributed outcomes, metrics definitions, and privacy/export/erasure coverage.
- Prove an instrumented apex/subdomain journey and replayed conversion on a local fixture site.

**Barrier:** One verified enquiry is recorded once and linked to the correct campaign and canonical CRM record. Disabled persistence, missing tags, and internal navigation produce the defined honest results.

This phase is the minimum launch-ready campaign-tracking product and can ship before Email.

### Phase 3: Email drafting and audience review in Feed

- Add Email beside social channels, shared typed capabilities, versioned metadata, safe HTML/plain-text projection, and personalization previews.
- Add CRM audience selection, explainable eligibility preview, sender setup, and explicitly scoped test-send flow.
- Preserve direct-contact CRM drafting and every existing Feed revision/review path.

**Barrier:** Operators and Brian can prepare the same reviewed email revision and recipient snapshot; editing that revision invalidates a pending send approval.

### Phase 4: approved broadcasts and native email results

- Add immutable dispatch approval, native unsubscribe/one-click endpoints, SMTP adapter capability, leased per-recipient jobs, cancellation, and durable CRM receipt reuse.
- Add native click results, trusted website conversions, and CRM activity; leave unavailable provider metrics visibly unavailable.
- Prove unsubscribe races, revoked access, worker restarts, uncertain SMTP outcomes, and non-resending reconciliation using a local SMTP test sink.

**Barrier:** No live audience send is enabled until recipient eligibility, approval binding, unsubscribe handling, and ambiguous-delivery recovery pass end to end.

### Phase 5: first-party rollout and operational acceptance

- Implement collector configuration, tracker hooks, and successful business-event integrations for the platform marketing and Studio sites; configure synthetic local sites for this execution.
- Walk a tagged social visit across the registered local first-party sites into a test enquiry/signup, then an approved test email through click and conversion using a loopback SMTP sink.
- Review reports in Feed and attribution in CRM using explicit test markers; verify production totals exclude these runs.
- Document installation, limits, retention, sender configuration, and recovery. Hand back production configuration, live acceptance, and enablement through the existing deployment and operator controls as owed items (§15.4).

Later work: recurring/drip sequences, cross-domain handoff, external analytics import/export, provider delivery/complaint adapters, experimentation, and paid-ad spend. None is required for Phases 1-4 to work.

## 12. Acceptance matrix

| Scenario | Required evidence |
|---|---|
| No analytics vendor configured | Create campaign, draft/link, collect, verify a conversion, and report successfully in OSS. Network inspection shows no analytics SaaS requests. |
| Manual LinkedIn post | Tracked link and saved permalink work without a LinkedIn account connection. Social impressions remain unavailable. |
| Existing URL with query/fragment | Generated URL preserves unrelated fields, handles attribution conflicts visibly, and reaches the expected destination. |
| Two placements in one post | Body/comment links report separately and roll up without double-counting the same trusted conversion. |
| Apex to sibling subdomain | With authorized first-party storage, identity/context survives; internal navigation does not overwrite acquisition. |
| Storage or collection disabled | No disallowed storage/events; reports expose the measurement limitation instead of inventing continuity. |
| Duplicate browser/backend events | Exact replay is counted once; changed payload with the same idempotency identity conflicts. |
| Forged public conversion/contact ID | Cannot create verified conversions, link a CRM identity, or read another workspace. |
| CRM intake retry / projection restart | Successful business outcome survives tracker failure; one conversion and one canonical lead remain after retries. |
| Forwarded email / scanner | Link request does not authenticate the intended recipient; automated/unknown activity stays distinct from verified conversion. |
| Email authoring | Subject/preheader/body share revision and approval history; text/HTML previews correspond to the approved version. |
| Dynamic audience after approval | Newly matching contacts are not added; withdrawn/suppressed recipients are excluded at final admission. |
| Sender or member grant revoked | The queued dispatch cannot use stale authority or another account's credentials. |
| SMTP crash after possible acceptance | Receipt requires reconciliation; a worker restart does not blindly resend. |
| Pause/cancel/unsubscribe race | Unadmitted recipients stop; accepted messages remain honestly recorded. GET preview does not unsubscribe. |
| SMTP-only self-host | Native campaign works with a local SMTP server and public unsubscribe endpoint; unsupported inbox-delivery/reply metrics are unavailable. |
| Erasure and retention | Subject/workspace export and erasure cover new records, cached projections, tokens, and queued jobs without resurrection. |
| UI and Brian parity | Same authorized commands/results through tools and UI, with reachable review/recovery on phone and desktop. |

Use synthetic fixtures and a disposable PostgreSQL database. Migration/RLS tests must execute real writes and cross-workspace reads; mock-only string assertions do not prove these boundaries. Capture actual MIME/SMTP payloads for approved content, recipient isolation, headers, and delivery behavior. Browser verification covers SPA navigation, mobile layout, installation, and first-party cookies under realistic local hostnames.

Before implementation handoff, run the repository's Node 22 checks: `pnpm test`, `pnpm smoke`, and platform `pnpm check`, plus full typechecks in both trees, affected builds, and the explicit database/browser/SMTP scenarios above (§15.3). Unit tests alone do not establish installation or send safety. Record existing unrelated failures separately; do not change invariant baselines to hide new violations.

## 13. Documentation and repository handoff

This plan is canonical in `use-brian/docs/plans/` and indexed from the platform `docs/INDEX.md`. Planning does not change current architecture claims or authorize deployment/publication/sending.

At implementation time, update platform architecture docs for Feed navigation/composition, a new campaign/attribution feature spec, CRM integration contracts, database schema, and the component map, with paired `brian-kb` entries as repository policy requires. Update public integration docs and the agent-docs mirror when the new external API becomes available.

Keep application source, tools, tests, routes, migrations, and native campaign UI in the open repository. Platform-owned site hooks and hosted vocabulary/composition wiring land as separately scoped integration changes. Preserve unrelated work and do not advance the `use-brian` gitlink as a side effect.

The retention, attribution, sender-throughput, and broadcast-size defaults stated above are locked for this implementation. Future launch evidence may justify a separate change; do not reopen them or defer later phases during this execution. The core product decisions in §1 remain the design boundary.

## 14. Design references

- [Feed operator surface](../../../docs/architecture/feed/operator-app.md) and [composition/collaboration](../../../docs/architecture/feed/draft-collaboration.md).
- [CRM](../../../docs/architecture/features/crm.md), [CRM operations](../../../docs/architecture/features/crm-operations.md), and [open-core placement](../../../docs/architecture/foundation/open-core-placement.md).
- [Database schema](../../../docs/architecture/platform/database-schema.md) and [testing conventions](../../../docs/workflow/testing.md).
- [Existing Feed navigation](../../apps/app-web/src/lib/feed-nav.ts), [content planning store](../../packages/api/src/db/content-planning-store.ts), and [composition contracts](../../packages/shared/src/feed-composition.ts).
- [CRM delivery service](../../packages/api/src/crm-operations/delivery-service.ts), [final admission](../../packages/api/src/crm-operations/delivery-policy.ts), and [SMTP adapter](../../packages/api/src/mailbox/smtp.ts).

Platform-relative references above resolve in the combined `brian-platform/use-brian` checkout; the plan itself, public source references, and implementation requirements remain readable in a standalone OSS checkout.

## 15. One-shot execution contract

### 15.1 Locked scope, order, and starting points

Implement all six phases in §11, in order. Phase 2 is a useful release boundary, not permission to stop before Email. Phase 5 includes the platform integration code and local acceptance; production configuration and live operation are handed back under §15.4. The v1 defaults in §§5-9 are settled, and the optional activation metric remains gated as specified in §6.3. No product decision within this scope needs another planning round. Internal function names, indexes, and finite collector-limit constants are engineering choices to document and test during Phase 0.

The production-side names in examples are configuration, never fixtures. Use synthetic contacts, local origins, and a loopback SMTP sink. Local acceptance must exercise the real SMTP/MIME path without contacting a recipient's mail server or using real model credentials. Demonstrate one-click headers and DKIM coverage with a local signing fixture; qualification of an operator's SMTP signing path remains owed.

Start Phases 0-2 at the shared contracts, campaign storage/routes, `packages/api/src/boot.ts`, and CRM intake seams in §§2 and 10. Start Phase 3 at `apps/app-web/src/lib/feed-nav.ts`, `packages/shared/src/feed-composition.ts`, and `packages/api/src/content-planning/`; Phase 4 starts at `packages/api/src/crm-operations/delivery-service.ts`, `packages/api/src/crm-operations/delivery-policy.ts`, and `packages/api/src/mailbox/smtp.ts`. These paths are OSS-relative.

For Phase 5, start at platform `apps/web/src/app/layout.tsx`, `apps/web/src/app/api/auth/email/verify/route.ts`, `apps/studio/src/app/layout.tsx`, `apps/studio/src/app/api/consultation/route.ts`, and `apps/studio/src/lib/consultation-intake.ts`; trace actual account creation through open `packages/api/src/routes/auth.ts`. Bind conversion emission to committed signup/intake identities, including retry after a later notification failure. A successful returning-user login or email verification alone must not create another signup/enquiry conversion. Supply optional configuration and explicit unconfigured states; do not require production credentials to build or test these clients.

The §11 phase barriers are cumulative. In particular, **audience sending stays disabled until the Phase 4 admission/recovery proof passes**, because a stale approval or uncertain SMTP handoff can otherwise send unauthorized or duplicate mail. Phase 0 database/RLS proof precedes public collection even when the UI is developed earlier behind disabled capabilities.

Tripwires: if manual social tracking seems to require OAuth or an analytics subscription, the capability boundary is wrong. If Email seems to need another editable body, CRM contact store, delivery receipt, or direct SMTP bypass, ownership is wrong (§§2, 8). If a platform-only collector or another Home app seems necessary, placement is wrong (§§1, 10). If browser-supplied identity or clicks seem sufficient for verified conversions, the trust boundary is wrong (§§5-6).

### 15.2 Test inventory and evidence

Create the following suites during their owning phases. Paths are OSS-relative unless marked platform. Each tag gets a platform `docs/workflow/component-map.md` row linking its architecture spec, actual source, and tests; extend existing component rows for reused components. Additional components require their own rows as usual.

| Phase | COMP tag | Required suite / evidence |
|---|---|---|
| 0 | `campaigns/contracts` | `packages/shared/src/__tests__/campaigns.test.ts`: channel compatibility, typed commands, bounded envelopes, configured limits. |
| 0-1 | `campaigns/store` | `packages/api/src/db/__tests__/campaigns.integration.test.ts`: executed migrations, non-bypass RLS, cross-workspace references, immutable links, replay/conflict, UI/tool authority. |
| 1 | `campaigns/links` | `packages/api/src/campaigns/__tests__/links.test.ts`: URL preservation/conflicts, immutable destinations, placement isolation, safe redirects, collector failure. |
| 1-2 | `api/campaign-tracking` | `packages/api/src/routes/__tests__/campaign-tracking.test.ts`: both-edition public mount order, origins, bounds/quotas, scoped credentials, forged conversion/identity refusal. |
| 2 | `campaigns/attribution` | `packages/core/src/campaigns/__tests__/attribution.test.ts`: first/last touch, lookback/skew, internal navigation, missing evidence, scanner classification, report denominators. |
| 2 | `campaigns/tracking` | `packages/api/src/db/__tests__/campaigns-tracking.integration.test.ts`: event deduplication/conflict, committed intake and outbox replay, failed collection, report counts and subject linkage. |
| 3 | `campaigns/email` | `packages/api/src/content-planning/__tests__/email.test.ts`: atomic metadata/body revisions, HTML/text projection, personalization, audience snapshots and approval invalidation. |
| 4 | `campaigns/dispatch` | `packages/api/src/db/__tests__/campaigns-dispatch.integration.test.ts`: actual loopback SMTP/MIME, recipient isolation, frozen audience, revoked authority, worker restart, pause/cancel/unsubscribe races, uncertain receipt with zero automatic resends, signed one-click headers. |
| 2, 4 | `campaigns/privacy` | `packages/api/src/db/__tests__/campaigns-privacy.integration.test.ts`: export, erasure, retention, token/credential revocation, queued projection and dispatch cannot resurrect erased data. |
| 1-5 | `app-web/feed-campaigns`, `app-web/crm-campaigns` | `apps/app-web/src/components/feed/__tests__/feed-campaigns.test.tsx` and `apps/app-web/src/components/crm/__tests__/crm-campaigns.test.tsx`: authorized entry points, results/limitations, review/recovery, locale coverage. |
| 5 | Existing first-party component tags | Extend platform `apps/studio/src/app/api/consultation/route.test.ts` and affected signup/auth suites; record browser evidence of the actual local marketing, Studio, Feed and CRM paths. |

Use the existing `scripts/crm/local-fixture.mjs` to create isolated PostgreSQL 18 with `pgvector` and `pg_trgm`. New database suites call its `assertLocalFixture` before connecting and use the non-bypass app role for RLS checks. Keep tests targeted; the integration configuration otherwise falls back to the ambient development database. Run the campaign DB suites against both open-only migrations and open plus platform-overlay migrations.

Maintain `docs/plans/native-campaigns-and-attribution-evidence/acceptance.md` in the OSS tree, with one entry for every §12 scenario. Record the test file/assertion or browser step, command, result (`passed`, `failed`, `blocked`, `not_run`), relevant commit/working-tree state, and sanitized evidence location. Add desktop and phone walkthroughs for tool/UI parity, installation, SPA page views, first-party cookie continuity, and SMTP click-to-conversion. Inspect network requests for the no-analytics-vendor case. A skipped suite, unavailable prerequisite, mock-only SMTP proof, or screenshot without the asserted state is not a passing case.

### 15.3 Repository obligations and verification commands

Run from the combined platform checkout under Node 22. Inventory dirty files in each touched repository and preserve unrelated work. Before implementation, run platform-root `pnpm test` and `pnpm check` once; record exits and identifiable pre-existing failures. Snapshot other required checks before their affected code changes. Existing unrelated failures are not this task's scope; new failures and missing feature tests must be fixed without adding baseline entries.

Update architecture before code: create platform `docs/architecture/features/native-campaigns-and-attribution.md`, update the affected §14 Feed/CRM specs and `docs/architecture/platform/database-schema.md`, and pair them with the same relative entries in canonical sibling `../brian-kb/`. Update public API/tracker/self-host documentation, relevant indexes/`llms.txt`, and canonical sibling `../agent-docs/` for the newly exposed contracts. New mirror files follow each repository's authoring instructions. These sibling paths are relative to the platform root, not the OSS root; the optional platform `brian-kb/` snapshot is not the authoring target.

Use current branches and pair conventional commits by phase across repositories. Open source/tests/migrations live in `use-brian/`; platform specs and the explicitly assigned hosted/site integration changes have separate commits. Never stage the OSS gitlink. The kickoff's **do not push** applies to the sibling mirrors too: commit their updates locally in the same session and return pushes as owed work. Do not edit manuals or skills as a shortcut around checks.

Allocate new migration numbers only after inspecting both `use-brian/packages/api/migrations/` and `packages/api-platform/migrations/`; no number in this plan is reserved. Never renumber applied files. Register campaign tables in RLS, privacy, retention and flush coverage. Any changed package manifest requires the corresponding OSS and platform lockfile updates. New shared exports must build for both editions. Product copy follows the four existing app-web dictionaries (`en`, `ja`, `zh`, `zh-cn`) and each touched platform app's locale conventions.

Required final commands from the **platform root**:

```sh
pnpm test
pnpm smoke
pnpm check
pnpm typecheck
pnpm --filter @use-brian/api-server... build
pnpm --filter ./apps/web build
pnpm --filter ./apps/studio build
```

Required final commands from **`use-brian/`**:

```sh
pnpm test
pnpm smoke
pnpm typecheck
pnpm --filter @use-brian/api-open... build
pnpm --filter ./apps/app-web build
node scripts/crm/local-fixture.mjs -- pnpm --filter @use-brian/api exec vitest run --config vitest.integration.config.ts src/db/__tests__/campaigns.integration.test.ts src/db/__tests__/campaigns-tracking.integration.test.ts src/db/__tests__/campaigns-dispatch.integration.test.ts src/db/__tests__/campaigns-privacy.integration.test.ts
node scripts/crm/local-fixture.mjs --migration-dir packages/api/migrations --migration-dir ../packages/api-platform/migrations -- pnpm --filter @use-brian/api exec vitest run --config vitest.integration.config.ts src/db/__tests__/campaigns.integration.test.ts src/db/__tests__/campaigns-tracking.integration.test.ts src/db/__tests__/campaigns-dispatch.integration.test.ts src/db/__tests__/campaigns-privacy.integration.test.ts
```

The fixture accepts `--pg-bin DIR` before `--` if PostgreSQL 18 is not on PATH. OSS has no `pnpm check`; that command belongs to the platform. Full `pnpm typecheck` in both trees is required because channel/Feed types cross the edition boundary. Record exact browser commands and local hostname setup in the evidence file. Run required checks once after the final relevant edits; repeat only for subsequent changes, failures, or unresolved concerns. Never treat a pre-existing failure as permission to skip new campaign assertions.

### 15.4 Final handoff and owed work

Return phase commits by repository, the §15.2 acceptance record, command exits and baseline differences, updated spec/mirror paths, and an owner checklist. Separate proven local engineering behavior from production readiness. If a required local prerequisite is blocked, identify the unproven criterion; do not mark the Goal complete.

**Out of scope and owed:** pushes (including KB and agent-docs), gitlink advancement, deployments, production migrations, remote/live QA, real audience sends or social publication, production origin/credential/domain/DKIM configuration and qualification, live tracking/send enablement, and product activation-event selection. The later-work list at the end of §11 remains deferred. Local disposable migrations, synthetic browser journeys, SMTP captures, and all Phase 5 integration code are in scope.

## Goal

**Outcome.** Implement §§1-11 so every §12 acceptance scenario passes with the local evidence required by §15.2, with production work explicitly owed under §15.4.

**Scope.** Execute §11 in order, using §§2, 10 and 15.1 for source anchors:

1. Phase 0: architecture/contracts, migrations, isolated transaction and authority proof (§§4, 15.2-15.3).
2. Phase 1: Feed campaigns, placements, manual publishing and tracked links (§§3.1, 5.1).
3. Phase 2: collection, verified conversions, attribution, CRM linkage and privacy (§§5-7, 9).
4. Phase 3: Email channel, revisioned previews, CRM audiences and test sends (§§3.2, 8.1-8.2).
5. Phase 4: approved dispatch, SMTP, unsubscribe, recovery and results (§§8.3-8.4).
6. Phase 5: first-party integration code and local browser/SMTP acceptance (§§6.3, 15.1-15.2).

**Hold to.** Locked §§1-10 and all §11 barriers; especially Phase 4 proof before audience sending, because stale approval and uncertain delivery can send unauthorized or duplicate mail. Follow §15.1 tripwires and §15.3 doc/KB/agent-docs pairing, global migration numbering, both-tree typechecks, phase commits and no-push/no-gitlink boundaries.

**Done when.** Every §15.2 named suite exists, passes and has a component-map row; every §12 scenario has passing evidence; all §15.3 commands introduce no failures beyond the recorded baseline, with no new invariant baselines; paired docs/mirrors are committed and §15.4 handoff is written. Blocked/skipped feature proofs are not completion.

**Out of scope:** pushes, gitlink advancement, production migrations/deploys, live QA/sends/publication, production configuration/enablement, activation-event selection, and §11 later work; return the full §15.4 list as owed.
