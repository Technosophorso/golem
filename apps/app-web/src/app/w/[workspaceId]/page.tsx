"use client";

/**
 * The workspace root — opens the workspace's configured default mini app.
 *
 * This used to be a server component that hard-redirected to `/p`. It cannot
 * be any more: which apps a workspace shows is configuration
 * (`workspaces.home_apps`, migration 385) and Page may be deselected, so a
 * fixed `/p` would drop those workspaces onto a surface that is not on their
 * strip. Generic workspace entry opens the FIRST configured app, regardless of
 * the sticky app used by the explicit Home button (`defaultHomePath`,
 * `lib/operator-apps.ts`). Ordinary app-open does not invoke the Suggested
 * interruption; that remains part of explicit Home navigation.
 *
 * Resolution is client-side because the ordered config lives in the persistent
 * sidebar-data provider. The server-fetched workspace detail seeds it on the
 * first render; an older/unseeded host waits for the provider's config read
 * rather than redirecting from its provisional default strip.
 *
 * The desktop quick-capture (`?capture=1`) and recorder (`?record=1`) hints
 * always land on `/p` regardless of config: both are doc-surface affordances
 * (open a fresh draft, start the dock recorder), so honouring them anywhere
 * else would silently drop what the user was capturing.
 * Stripe's one-shot `checkout` / `session_id` handoff is also preserved onto
 * the resolved default path so the workspace plan gate can reconcile it there.
 *
 * Spec: docs/architecture/features/home-apps.md → "Home resolution".
 * [COMP:app-web/workspace-root]
 */

import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSidebarData } from "@/components/doc/doc-sidebar-data";
import { SurfaceSkeletonFor } from "@/components/chrome/surface-skeleton";
import { surfaceFromPathname } from "@/lib/doc-page-url";
import { defaultHomePath } from "@/lib/operator-apps";
import { forwardPlanGateCheckoutReturn } from "@/lib/plan-gate";
import { useBrianWorkspacePath } from "@/lib/siri-use-brian";

function WorkspaceRootRedirect() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params?.workspaceId ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { homeApps, homeAppsLoading } = useSidebarData();
  const defaultPath =
    workspaceId && !homeAppsLoading
      ? defaultHomePath(workspaceId, homeApps)
      : null;

  useEffect(() => {
    if (!workspaceId) return;
    const capture = searchParams?.get("capture") === "1";
    const record = searchParams?.get("record") === "1";
    if (capture || record) {
      router.replace(`/w/${workspaceId}/p?${capture ? "capture=1" : "record=1"}`);
      return;
    }
    const useBrianPath = useBrianWorkspacePath(
      workspaceId,
      searchParams?.get("useBrian"),
    );
    if (useBrianPath) {
      router.replace(useBrianPath);
      return;
    }
    if (!defaultPath) return;
    router.replace(
      forwardPlanGateCheckoutReturn(
        defaultPath,
        searchParams?.toString() ?? "",
      ),
    );
  }, [defaultPath, router, searchParams, workspaceId]);

  // A seeded config paints the destination frame immediately. An older host
  // with no seed paints the neutral shell until the ordered config resolves;
  // it must not imply Page and then redirect there from provisional state.
  return <SurfaceSkeletonFor surface={surfaceFromPathname(defaultPath ?? "")} />;
}

export default function WorkspaceRootPage() {
  return (
    <Suspense fallback={<SurfaceSkeletonFor surface={null} />}>
      <WorkspaceRootRedirect />
    </Suspense>
  );
}
