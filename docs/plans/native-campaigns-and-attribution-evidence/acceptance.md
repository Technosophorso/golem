# Native campaigns and attribution acceptance evidence

This ledger covers every scenario in §12 of `native-campaigns-and-attribution.md`. All identities, origins, credentials, content, recipients, and SMTP traffic are synthetic. PostgreSQL clusters and the SMTP server are loopback-only and disposable.

## Baseline and phase state

- Pre-implementation platform `pnpm test`: passed.
- Pre-implementation platform `pnpm check`: failed only on the pre-existing `packages/api/migrations/537_saved_views_scope_guc_casts.sql` transaction-wrapper finding. No baseline was changed.
- Phase 0: OSS `629b91cb`, platform `2e66e59e`, KB `ef00519`.
- Phase 1: OSS `11911d0d`, platform `d557f61e`.
- Phase 2: OSS `761a0295`, platform `8208274e`.
- Phase 3: OSS `c472dcb7`, platform `49131880`.
- Phase 4: OSS `96a10025`, platform `ec1b5827`.
- Phase 5: the enclosing OSS/platform/KB/agent-docs commits for this evidence and the first-party rollout.

## Reproducible commands

`DB-OSS`:

```sh
node scripts/crm/local-fixture.mjs --pg-bin /opt/homebrew/opt/postgresql@18/bin -- pnpm --filter @use-brian/api exec vitest run --config vitest.integration.config.ts src/db/__tests__/campaigns.integration.test.ts src/db/__tests__/campaigns-tracking.integration.test.ts src/db/__tests__/campaigns-dispatch.integration.test.ts src/db/__tests__/campaigns-privacy.integration.test.ts
```

`DB-OVERLAY`:

```sh
node scripts/crm/local-fixture.mjs --pg-bin /opt/homebrew/opt/postgresql@18/bin --migration-dir ../packages/api-platform/migrations -- pnpm --filter @use-brian/api exec vitest run --config vitest.integration.config.ts src/db/__tests__/campaigns.integration.test.ts src/db/__tests__/campaigns-tracking.integration.test.ts src/db/__tests__/campaigns-dispatch.integration.test.ts src/db/__tests__/campaigns-privacy.integration.test.ts
```

`BROWSER`:

```sh
node scripts/campaigns/local-browser-acceptance.mjs --pg-bin /opt/homebrew/opt/postgresql@18/bin
```

Chromium hostname setup is `--host-resolver-rules=MAP *.campaign.test 127.0.0.1,EXCLUDE localhost`. The harness starts the actual OSS API, app-web, platform marketing site, and Studio site.

`SMTP-CAPTURE`:

```sh
node scripts/crm/local-fixture.mjs --pg-bin /opt/homebrew/opt/postgresql@18/bin -- env CAMPAIGN_EVIDENCE_DIR=/absolute/path/to/use-brian/docs/plans/native-campaigns-and-attribution-evidence pnpm --filter @use-brian/api exec vitest run --config vitest.integration.config.ts src/db/__tests__/campaigns-dispatch.integration.test.ts
```

`UNIT-UI` is the required OSS `pnpm test`; it includes the named shared/core/API/Feed/CRM suites. Platform first-party route suites are included by the required platform `pnpm test`.

## Scenario ledger

| # | Scenario | Result | Assertion and command | Commit/state | Sanitized evidence |
|---:|---|---|---|---|---|
| 1 | No analytics vendor configured | passed | `BROWSER` creates the campaign, collects SPA/page/CTA/form observations, records verified conversions, opens Feed/CRM, and rejects any request containing a known analytics SaaS hostname. | Phase 5 enclosing commit | `browser-acceptance.json`; `marketing-desktop.png`; no remote SDK is present in `packages/api/src/campaigns/browser/tracker.ts`. |
| 2 | Manual LinkedIn post | passed | `packages/api/src/db/__tests__/campaigns.integration.test.ts` and `packages/api/src/campaigns/__tests__/links.test.ts` prove publication and redirect behavior; `BROWSER` saves `https://social.example/posts/synthetic-launch` without a LinkedIn connector and Feed reports social impressions unavailable. Commands: `DB-OSS`, `DB-OVERLAY`, `UNIT-UI`, `BROWSER`. | Phases 1-2 plus Phase 5 enclosing commit | `feed-desktop.png`; `feed-phone.png`; `browser-acceptance.json`. |
| 3 | Existing URL with query/fragment | passed | Link tests prove preservation and explicit conflict handling. `BROWSER` starts with `?existing=kept#pricing`, adds bounded attribution fields, and reaches the Plans page. Commands: `UNIT-UI`, `BROWSER`. | Phase 1 plus Phase 5 enclosing commit | `marketing-desktop.png`; `browser-acceptance.json`. |
| 4 | Two placements in one post | passed | Link/store suites create body and first-comment placements with distinct immutable links and campaign rollup; trusted outcomes deduplicate by outcome identity. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`. | Phases 1-2 | Named test assertions in `links.test.ts`, `campaigns.integration.test.ts`, and `campaigns-tracking.integration.test.ts`. |
| 5 | Apex to sibling subdomain | passed | `BROWSER` visits `marketing.campaign.test`, then `studio.campaign.test`; the authorized `campaign.test` cookie preserves the original link/session/UTM and internal navigation does not replace acquisition. | Phase 5 enclosing commit | `browser-acceptance.json`; `marketing-desktop.png`; `studio-phone.png`. |
| 6 | Storage or collection disabled | passed | Tracker/attribution tests prove memory-only mode writes no cookie and disabled sites reject collection while reports expose disabled/unavailable continuity. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`. | Phase 2 | Named assertions in `campaign-tracking.test.ts`, `attribution.test.ts`, and `campaigns-tracking.integration.test.ts`. |
| 7 | Duplicate browser/backend events | passed | Route/store suites count exact event replay once and conflict a changed fingerprint. `BROWSER` submits the exact trusted conversion twice and observes `duplicate: true` on replay. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`, `BROWSER`. | Phase 2 plus Phase 5 enclosing commit | `browser-acceptance.json`; named assertions in `campaigns-tracking.integration.test.ts`. |
| 8 | Forged public conversion/contact ID | passed | Public route tests reject missing/invalid credentials and guessed CRM subjects; RLS integration rejects cross-workspace references and reads. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`. | Phases 0 and 2 | Named assertions in `campaign-tracking.test.ts` and `campaigns.integration.test.ts`. |
| 9 | CRM intake retry / projection restart | passed | Tracking integration persists the canonical lead and outbox before a forced projection failure, then replays to one conversion/subject link. `BROWSER` waits for and opens the same linked CRM record. Commands: `DB-OSS`, `DB-OVERLAY`, `BROWSER`. | Phase 2 plus Phase 5 enclosing commit | `crm-desktop.png`; `crm-phone.png`; `browser-acceptance.json`. |
| 10 | Forwarded email / scanner | passed | Attribution tests retain automated/unknown classification separately. `SMTP-CAPTURE` proves the opaque email click records an observation but only the server credential creates a verified conversion; the click does not authenticate a recipient. | Phases 2 and 4 plus Phase 5 enclosing commit | `smtp-acceptance.json`; sanitized `smtp-capture.eml`; named assertions in `attribution.test.ts` and `campaigns-dispatch.integration.test.ts`. |
| 11 | Email authoring | passed | Email suite proves atomic subject/preheader/body revision, matching text/HTML projection, personalization, and approval invalidation after revision changes. Command: `UNIT-UI`. | Phase 3 | Named assertions in `packages/api/src/content-planning/__tests__/email.test.ts`. |
| 12 | Dynamic audience after approval | passed | Email/dispatch suites freeze the approved audience, omit a later matching contact, and re-run consent/suppression admission before each envelope. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`. | Phases 3-4 | `smtp-acceptance.json`; named assertions in `email.test.ts` and `campaigns-dispatch.integration.test.ts`. |
| 13 | Sender or member grant revoked | passed | Dispatch integration removes the approver membership and disconnects the sender before work; both paths stop before SMTP and never use another workspace credential. Commands: `DB-OSS`, `DB-OVERLAY`. | Phase 4 | Named `blocks stale member and sender authority before SMTP handoff` assertion. |
| 14 | SMTP crash after possible acceptance | passed | Loopback SMTP closes after DATA. The recipient becomes uncertain, restart claims zero work, and the sink still has one message. Commands: `DB-OSS`, `DB-OVERLAY`. | Phase 4 | Named `preserves an uncertain post-DATA outcome` assertion in `campaigns-dispatch.integration.test.ts`. |
| 15 | Pause/cancel/unsubscribe race | passed | Dispatch integration pauses before admission, resumes one recipient, proves GET is non-mutating, withdraws consent idempotently, suppresses the remaining recipient, and cancels another dispatch without changing accepted evidence. Commands: `DB-OSS`, `DB-OVERLAY`. | Phase 4 | Named race assertion in `campaigns-dispatch.integration.test.ts`; `smtp-capture.eml` includes the one-click headers. |
| 16 | SMTP-only self-host | passed | `SMTP-CAPTURE` uses an `imap` connector carrying only the authorized loopback SMTP path, sends two separate envelopes, captures real MIME/DKIM/List-Unsubscribe headers, follows the emitted `/e/` capability, and records an attributed test conversion. Provider delivery/reply metrics remain unavailable. | Phase 4 plus Phase 5 enclosing commit | `smtp-capture.eml`; `smtp-acceptance.json`; `email-click-desktop.png`; `email-click-phone.png`. |
| 17 | Erasure and retention | passed | Privacy integration covers exports, subject/workspace erasure, event retention, token/credential revocation, queued jobs, cached projections, and non-resurrection. Commands: `DB-OSS`, `DB-OVERLAY`. | Phases 2 and 4 | Named assertions in `campaigns-privacy.integration.test.ts`. |
| 18 | UI and Brian parity | passed | Store integration exercises the same typed commands with owner/member authority; Feed and CRM component suites cover operator entry, results, limitations, review/recovery and locale copy. `BROWSER` opens real desktop and phone surfaces. Commands: `UNIT-UI`, `DB-OSS`, `DB-OVERLAY`, `BROWSER`. | Phases 0-5 | `feed-desktop.png`; `feed-phone.png`; `crm-desktop.png`; `crm-phone.png`; named assertions in `feed-campaigns.test.tsx` and `crm-campaigns.test.tsx`. |

## Evidence inventory

- `browser-acceptance.json`: machine-readable browser assertions and production/test totals.
- `marketing-desktop.png`, `studio-phone.png`: first-party installation, SPA/CTA/form capture, and sibling continuity walkthrough.
- `feed-desktop.png`, `feed-phone.png`: campaign authoring and native results at both breakpoints.
- `crm-desktop.png`, `crm-phone.png`: canonical CRM contact with linked campaign acquisition at both breakpoints.
- `email-click-desktop.png`, `email-click-phone.png`: the opaque email-click redirect landing with preserved email attribution at both breakpoints.
- `smtp-capture.eml`: real loopback MIME with synthetic addresses, opaque capabilities redacted, signed one-click headers, text/HTML alternatives, and one recipient envelope.
- `smtp-acceptance.json`: machine-readable SMTP recipient-isolation, signing, click redirect/conversion, and metric-availability assertions.
