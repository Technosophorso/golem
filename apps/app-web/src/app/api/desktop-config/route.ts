import { serverRuntimePublicConfig } from "@/lib/runtime-public-config";
// Next.js Route Handler — GET /api/desktop-config
//
// Deployment self-description for the desktop shell. The Electron app lets a
// user point it at a self-hosted brain by typing ONE address (the app URL);
// this endpoint is how that deployment then declares where its own backend
// lives, instead of the shell guessing from the hostname.
//
// The shell needs the value BEFORE it commits to a target — the
// pre-switch `/health` probe in main.ts `run-local` validates the brain before
// persisting and relaunching — which rules out anything only readable after
// the page has loaded in the window.
//
// We report the browser-facing runtime origins, not the server-side
// `API_URL`: on a reverse-proxied self-host those differ (`API_URL` is often an
// internal `localhost:4000` hop, while the browser dials the public hostname),
// and the shell dials the API the same way the browser does.
//
// Public and unauthenticated by necessity — the shell calls it before any
// session exists. It discloses nothing secret: every value here is already
// shipped inside the public client bundle.
//
// Older self-hosts predate this route and 404; the shell falls back to
// `deriveLocalApiUrl` there, so this is additive.
//
// Spec: docs/architecture/features/app-desktop.md → "Dual target"
// Component-map tag: [COMP:app-web/desktop-config-route].

import { NextResponse } from "next/server";

export async function GET() {
  const config = serverRuntimePublicConfig();
  let aliasCapabilities: { internalLinkAliasesVersion?: 1 } = {};
  if (config.apiUrl) {
    try {
      const response = await fetch(`${config.apiUrl}/capabilities/internal-links`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = await response.json() as { internalLinkAliasesVersion?: unknown };
        if (body.internalLinkAliasesVersion === 1) aliasCapabilities = { internalLinkAliasesVersion: 1 };
      }
    } catch {
      // Version skew or an unavailable API leaves the alias capability absent.
    }
  }
  return NextResponse.json(
    {
      ...config,
      docSyncUrl: config.docSyncUrl || "",
      pageLinkHandoffVersion: 1,
      ...aliasCapabilities,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
