"use client";

/** CRM acquisition evidence linked to canonical campaign outcomes. [COMP:app-web/crm-campaigns] */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { getCampaignSubjectAttribution, type CampaignSubjectAttribution } from "@/lib/api/campaigns";
import { useT } from "@/lib/i18n/client";

export function CrmCampaignAttribution(props: {
  workspaceId: string;
  contactId: string;
  initialAttribution?: CampaignSubjectAttribution;
}) {
  const t = useT().crmPage.campaignAttribution;
  const [data, setData] = useState<CampaignSubjectAttribution | null>(props.initialAttribution ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (props.initialAttribution) return;
    let cancelled = false;
    getCampaignSubjectAttribution(props.workspaceId, props.contactId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [props.contactId, props.initialAttribution, props.workspaceId]);

  return (
    <section className="mt-4 border-t border-border/60 pt-4" aria-label={t.title}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
        <Megaphone className="size-3.5" aria-hidden /> {t.title}
      </div>
      {failed ? <p className="text-sm text-destructive">{t.failed}</p> : !data ? (
        <p className="text-sm text-muted-foreground">{t.loading}</p>
      ) : data.conversions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="space-y-2">
          {data.conversions.map((conversion) => (
            <article key={conversion.id} className="rounded-lg border border-border/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{conversion.campaignName ?? t.unattributed}</strong>
                <span className="text-xs text-muted-foreground">{new Date(conversion.occurredAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.verified}: {conversion.conversionKind} · {conversion.channel ?? t.unknownChannel}
              </p>
              {conversion.campaignId ? (
                <Link className="mt-2 inline-flex text-xs font-medium underline underline-offset-2"
                  href={`/w/${props.workspaceId}/feed/campaigns?campaignId=${encodeURIComponent(conversion.campaignId)}`}>
                  {t.openCampaign}
                </Link>
              ) : null}
            </article>
          ))}
          <p className="text-xs text-muted-foreground">{t.limitation}</p>
        </div>
      )}
    </section>
  );
}
