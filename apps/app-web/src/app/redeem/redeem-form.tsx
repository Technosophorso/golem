"use client";


import { publicRuntimeConfig } from "@/lib/runtime-public-config";
// [COMP:app-web/redeem] — see docs/architecture/features/promo-codes.md
//
// Client half of the in-app redeem page. The server component
// (`page.tsx`) resolves the target workspace and passes it in, so this
// form has no workspace-context hydration of its own — it just POSTs the
// code to /api/promo/redeem for that workspace.
//
// A code that runs longer than the workspace's current promo plan comes
// back as a 409 `replace_confirmation_required`; the form confirms via
// `confirmDialog` (naming both plans and their end dates) before
// re-POSTing with `replace_existing: true`. The auto-submit path for
// shareable `?code=` links goes through the same confirm — it calls the
// same `submit`, which is the only thing that ever POSTs.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authFetch, refreshUserCookie } from "@/lib/auth-fetch";
import { useT } from "@/lib/i18n/client";
import { format, type Dictionary } from "@/lib/i18n";
import { isPhoneViewport } from "@/lib/viewport";
import { BackButton } from "@/components/ui/back-button";
import { confirmDialog } from "@/components/ui/confirm-dialog";

const API_URL = publicRuntimeConfig().apiUrl ?? "http://localhost:4000";

type RedeemResult =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; plan: string; planExpiresAt: string | null; replaced: boolean };

type PromoPlanRef = { plan: string; expiresAt: string | null };

// The billing PLANS config (`components/settings-modal/sections/billing-section.tsx`)
// doesn't localize plan names either (they're product names, e.g. "Max 10x") —
// this just formats the raw plan id ("max_10x") the same way.
function formatPlanLabel(planId: string): string {
  return planId
    .split("_")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function formatPlanDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildReplaceDescription(
  t: Dictionary,
  current: { plan: string; expiresAt: string },
  incoming: { plan: string; expiresAt: string | null },
): string {
  const currentPlan = formatPlanLabel(current.plan);
  const currentDate = formatPlanDate(current.expiresAt);
  const incomingPlan = formatPlanLabel(incoming.plan);
  if (incoming.expiresAt) {
    return format(t.redeem.replaceDescriptionDated, {
      currentPlan,
      currentDate,
      incomingPlan,
      incomingDate: formatPlanDate(incoming.expiresAt),
    });
  }
  return format(t.redeem.replaceDescriptionPermanent, {
    currentPlan,
    currentDate,
    incomingPlan,
  });
}

function buildNotLongerMessage(t: Dictionary, current: PromoPlanRef): string {
  const plan = formatPlanLabel(current.plan);
  if (current.expiresAt) {
    return format(t.redeem.notLongerDated, { plan, date: formatPlanDate(current.expiresAt) });
  }
  return format(t.redeem.notLongerPermanent, { plan });
}

export function RedeemForm({
  targetWorkspaceId,
  prefilledCode,
}: {
  targetWorkspaceId: string | null;
  prefilledCode: string;
}) {
  const t = useT();
  const [code, setCode] = useState(prefilledCode);
  const [result, setResult] = useState<RedeemResult>({ kind: "idle" });
  const backHref = targetWorkspaceId ? `/w/${targetWorkspaceId}/p` : "/";

  const submit = useCallback(
    async (opts?: { replaceExisting?: boolean }) => {
      const trimmed = code.trim();
      if (!trimmed) {
        setResult({ kind: "error", message: t.redeem.enterCode });
        return;
      }
      if (!targetWorkspaceId) {
        setResult({ kind: "error", message: t.redeem.noWorkspace });
        return;
      }
      setResult({ kind: "submitting" });
      try {
        const res = await authFetch(`${API_URL}/api/promo/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: targetWorkspaceId,
            code: trimmed,
            ...(opts?.replaceExisting ? { replace_existing: true } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
          current?: PromoPlanRef;
          incoming?: PromoPlanRef;
          plan?: string;
          planExpiresAt?: string | null;
          replaced?: boolean;
        };
        if (!res.ok) {
          if (
            res.status === 409 &&
            body.reason === "replace_confirmation_required" &&
            body.current?.expiresAt &&
            body.incoming
          ) {
            const confirmed = await confirmDialog({
              title: t.redeem.replaceTitle,
              description: buildReplaceDescription(
                t,
                { plan: body.current.plan, expiresAt: body.current.expiresAt },
                body.incoming,
              ),
              confirmLabel: t.redeem.replaceConfirm,
              cancelLabel: t.redeem.replaceCancel,
            });
            if (confirmed) {
              await submit({ replaceExisting: true });
            } else {
              setResult({ kind: "idle" });
            }
            return;
          }
          if (res.status === 409 && body.reason === "not_longer" && body.current) {
            setResult({ kind: "error", message: buildNotLongerMessage(t, body.current) });
            return;
          }
          setResult({ kind: "error", message: body.error ?? `Failed (${res.status})` });
          return;
        }
        // Plan changed — refresh the user cookie so the chrome's plan badge
        // reflects the new plan on next navigation.
        await refreshUserCookie().catch(() => {});
        setResult({
          kind: "success",
          plan: body.plan ?? "pro",
          planExpiresAt: body.planExpiresAt ?? null,
          replaced: body.replaced ?? false,
        });
      } catch (err) {
        setResult({
          kind: "error",
          message: err instanceof Error ? err.message : t.redeem.networkError,
        });
      }
    },
    [code, t, targetWorkspaceId],
  );

  // Shareable links arrive pre-filled (`?code=`) — auto-submit so they
  // "just work". The server already resolved the workspace, so there's no
  // hydration race to wait on. This goes through the same `submit`, so a
  // longer-running code still confirms before it replaces anything.
  useEffect(() => {
    if (prefilledCode && targetWorkspaceId) {
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="absolute left-4 top-4">
        <BackButton label={t.redeem.back} href={backHref} />
      </div>
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t.redeem.title}</h1>
          <p className="text-sm text-muted-foreground">{t.redeem.subtitle}</p>
        </div>

        {result.kind !== "success" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {/* No auto-focus on a phone (responsive contract M4): a shared
                `?code=` link would otherwise land on a raised keyboard and,
                under 16px, a zoomed viewport before any touch. */}
            <input
              type="text"
              autoFocus={!isPhoneViewport()}
              placeholder={t.redeem.placeholder}
              value={code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCode(e.target.value.toUpperCase())
              }
              className="flex h-12 w-full rounded-xl border border-input bg-transparent px-3 py-1 text-center text-[16px] tracking-widest uppercase shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
              disabled={result.kind === "submitting"}
            />
            <button
              type="submit"
              className="w-full h-12 rounded-lg text-sm font-medium bg-action text-action-foreground hover:bg-action/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                result.kind === "submitting" || !code.trim() || !targetWorkspaceId
              }
            >
              {result.kind === "submitting" ? t.redeem.submitting : t.redeem.submit}
            </button>
          </form>
        )}

        {result.kind === "error" && (
          <p className="text-center text-sm text-destructive">{result.message}</p>
        )}

        {result.kind === "success" && (
          <div className="rounded-xl border border-border p-6 text-center space-y-3">
            <p className="text-sm text-foreground">
              {format(t.redeem.success, { plan: result.plan })}
            </p>
            {result.planExpiresAt && (
              <p className="text-xs text-muted-foreground">
                {format(t.redeem.activeUntil, {
                  date: new Date(result.planExpiresAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                })}
              </p>
            )}
            {result.replaced && (
              <p className="text-xs text-muted-foreground">{t.redeem.replaced}</p>
            )}
            <div className="flex justify-center pt-2">
              <Link
                href={targetWorkspaceId ? `/w/${targetWorkspaceId}` : "/"}
                className="text-sm text-foreground underline hover:no-underline"
              >
                {t.redeem.goToWorkspace}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
