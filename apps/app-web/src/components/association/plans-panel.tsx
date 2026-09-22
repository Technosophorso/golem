"use client";

/** Membership plan catalogue: cards and the plan editor. [COMP:app-web/association] */
import { useState } from "react";
import { Plus, WalletCards } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { AssociationPlan } from "@/lib/api/association";
import { Button } from "@/components/ui/button";
import { useAssociationModule } from "./module-controls";
import { AssociationPlanForm } from "./catalog-forms";
import { AssociationListState,useAssociationPage } from "./operator-controls";
import { AssociationEditor, associationMoney } from "./workspace-ui";
import { EmptyState, InlineNotice, PageHeader, StatusPill } from "./ui";

function planCurrencies(plans:readonly {currency:string}[]|undefined):string[] { return [...new Set((plans ?? []).map(plan=>plan.currency).filter(Boolean))]; }

export function AssociationPlansPanel({workspaceId,initialNew=false}:{workspaceId:string;initialNew?:boolean}) {
  const t=useT().associationPage,u=t.ux,m=t.manage,plans=useAssociationPage(workspaceId,"plans"),module=useAssociationModule(workspaceId);
  const [editing,setEditing]=useState<AssociationPlan|"new"|null>(initialNew?"new":null),[saved,setSaved]=useState(false);
  const configure=!!module.data?.canManage&&!module.error;
  if(editing)return <AssociationEditor title={editing==="new"?m.newPlan:editing.name} onClose={()=>setEditing(null)}><AssociationPlanForm key={editing==="new"?"new":editing.id} workspaceId={workspaceId} plan={editing==="new"?undefined:editing} currencies={planCurrencies(plans.data?.items)} disabled={!configure||!!plans.error} onSaved={()=>{setEditing(null);setSaved(true);void plans.refresh();}}/></AssociationEditor>;
  return <section className="space-y-5">
    <PageHeader title={m.plans} description={u.plansHelp} actions={<Button type="button" className="min-h-11 md:min-h-9" disabled={!configure||!!plans.error} onClick={()=>{setSaved(false);setEditing("new");}}><Plus aria-hidden className="size-4"/>{m.newPlan}</Button>}/>
    {saved?<InlineNotice tone="success">{u.saved}</InlineNotice>:null}
    {module.data&&!configure?<InlineNotice tone="neutral">{m.canConfigure}</InlineNotice>:null}
    <p className="text-sm text-muted-foreground">{u.planChangeHelp}</p>
    <AssociationListState {...plans}>{plans.data?.items.length===0?<EmptyState icon={WalletCards} title={u.emptyPlans}/>:null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.data?.items.map(plan=><article key={plan.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-5" data-plan-card>
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{plan.name}</h3><StatusPill status={plan.published?"published":"draft"} label={plan.published?m.published:m.options.draft}/></div>
        <p className="text-2xl font-semibold tracking-tight">{Number(plan.feeMinor)===0?u.free:associationMoney(plan.feeMinor,plan.currency)} <span className="text-sm font-normal text-muted-foreground">/ {m.options[plan.billingPeriod]}</span></p>
        {plan.benefits.length?<ul className="list-inside list-disc text-sm text-muted-foreground">{plan.benefits.slice(0,3).map(benefit=><li key={benefit}>{benefit}</li>)}</ul>:null}
        {plan.eligibilityNote?<p className="text-xs text-muted-foreground">{plan.eligibilityNote}</p>:null}{plan.provider?<p className="text-xs text-muted-foreground">{m.providerManaged}</p>:null}
        <Button type="button" className="mt-auto min-h-11 self-start md:min-h-8" size="sm" variant="outline" disabled={!configure||!!plans.error} onClick={()=>{setSaved(false);setEditing(plan);}}>{m.edit}</Button>
      </article>)}</div></AssociationListState>
  </section>;
}
