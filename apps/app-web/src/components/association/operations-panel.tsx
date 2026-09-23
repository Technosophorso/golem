"use client";

/** Settings host: module lifecycle, sponsored places, payment sync, activity log and owner administration. [COMP:app-web/association] */
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { retryAssociationProviderReceipt } from "@/lib/api/association";
import { useAssociationModule, AssociationModuleControls } from "./module-controls";
import { AssociationPrivacyPanel } from "./privacy-panel";
import { AssociationMailboxPanel } from "./mailbox-panel";
import { AssociationCredentialsPanel } from "./credentials-panel";
import { AssociationSponsorships } from "./sponsorships";
import { ProgrammePublishingPanel } from "./programme-publishing";
import { WebsiteMediaPanel } from "./website-media";
import { AssociationListState,useAssociationAction,useAssociationPage } from "./operator-controls";
import { EmptyState, InlineNotice, PageHeader, ResponsiveTable, Segmented, StatusPill, associationDate } from "./ui";

type SettingsTab="general"|"website"|"sponsorship"|"sync"|"activity"|"keys"|"mailboxes"|"privacy";
const TABS:SettingsTab[]=["general","website","sponsorship","sync","activity","keys","mailboxes","privacy"];

function PaymentSync({workspaceId,canManage}:{workspaceId:string;canManage:boolean}) {
  const t=useT().associationPage,u=t.ux,m=t.manage,receipts=useAssociationPage(workspaceId,"receipts"),retry=useAssociationAction(workspaceId);
  async function retryReceipt(id:string) {
    const completed=await retry.run(u.retrySync,()=>retryAssociationProviderReceipt(workspaceId,id),{description:m.retryReceiptHelp});
    if(!completed)await receipts.refresh();
  }
  return <section className="space-y-4"><p className="text-sm text-muted-foreground">{u.paymentSyncHelp}</p>
    <AssociationListState {...receipts}>
      <ResponsiveTable rows={receipts.data?.items ?? []} rowKey={row=>row.id} rowData={row=>({"data-receipt-row":row.id})} empty={<EmptyState title={m.empty}/>}
        columns={[
          {key:"source",label:u.provider,cell:row=><span>{row.provider}<span className="block break-all text-xs text-muted-foreground">{row.eventId}</span></span>},
          {key:"state",label:m.status,cell:row=><span><StatusPill status={row.state}/>{row.errorCode?<span className="block text-xs text-destructive">{m.errorCode}: {row.errorCode}</span>:null}</span>},
          {key:"attempts",label:m.attempts,cell:row=>String(row.attempts)},
          {key:"target",label:t.order,hideBelowMd:true,cell:row=><span className="break-all text-xs">{row.orderId?`${t.order}: ${row.orderId}`:""}{row.entitlementId?`${m.memberships}: ${row.entitlementId}`:""}</span>},
        ]}
        actions={row=>canManage&&row.state==="needs_reconciliation"?<Button type="button" size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={retry.pending} onClick={()=>void retryReceipt(row.id)}>{u.retrySync}</Button>:null}/>
    </AssociationListState>{retry.feedback}</section>;
}

function ActivityLog({workspaceId}:{workspaceId:string}) {
  const t=useT().associationPage,u=t.ux,m=t.manage,audit=useAssociationPage(workspaceId,"audit"),deliveries=useAssociationPage(workspaceId,"deliveries");
  return <div className="grid gap-6 lg:grid-cols-2">
    <section className="space-y-3"><h3 className="font-semibold">{u.changes}</h3><AssociationListState {...audit} compact><div className="divide-y divide-border rounded-2xl border border-border bg-background">
      {audit.data?.items.map(row=><article className="space-y-0.5 px-4 py-3 text-sm break-words" key={row.id}><p className="font-medium">{row.action}</p><p className="text-xs text-muted-foreground">{row.actorKind} · {row.id}</p></article>)}
      {audit.data?.items.length===0?<p className="p-4 text-sm text-muted-foreground">{m.empty}</p>:null}</div></AssociationListState></section>
    <section className="space-y-3"><h3 className="font-semibold">{u.notificationsSent}</h3><AssociationListState {...deliveries} compact><div className="divide-y divide-border rounded-2xl border border-border bg-background">
      {deliveries.data?.items.map(row=><article className="space-y-0.5 px-4 py-3 text-sm break-words" key={row.id}><p className="flex flex-wrap items-center gap-2 font-medium">{row.eventType}<StatusPill status={row.status}/></p><p className="text-xs text-muted-foreground">{m.attempts}: {row.attempts} · {associationDate(row.occurredAt)} · {row.id}</p></article>)}
      {deliveries.data?.items.length===0?<p className="p-4 text-sm text-muted-foreground">{m.empty}</p>:null}</div></AssociationListState></section>
  </div>;
}

export function AssociationOperationsPanel({workspaceId,initialTab}:{workspaceId:string;initialTab?:string}) {
  const module=useAssociationModule(workspaceId);
  const t=useT().associationPage,u=t.ux;
  const canManage=!!module.data?.canManage&&!module.error;
  const [tab,setTab]=useState<SettingsTab>(TABS.includes(initialTab as SettingsTab)?initialTab as SettingsTab:"general");
  const labels:Record<SettingsTab,string>={general:u.general,website:t.programmes.tab,sponsorship:u.sponsorship,sync:u.syncIssues,activity:u.activityLog,keys:t.admin.keys,mailboxes:t.admin.mailboxes,privacy:t.privacy.title};
  const available=TABS.filter(id=>canManage||["general","sync","activity"].includes(id));
  const current=available.includes(tab)?tab:"general";
  return <section className="space-y-5" data-association-settings>
    <PageHeader title={u.settings} description={u.settingsHelp}><Segmented label={u.goTo} value={current} onChange={setTab} options={available.map(id=>({value:id,label:labels[id]}))}/></PageHeader>
    {module.data&&!canManage&&current==="general"?<InlineNotice tone="neutral">{t.ownerOnly}</InlineNotice>:null}
    {current==="general"?<AssociationModuleControls workspaceId={workspaceId}/>:null}
    {current==="website"?<div className="space-y-10"><WebsiteMediaPanel workspaceId={workspaceId}/><ProgrammePublishingPanel workspaceId={workspaceId}/></div>:null}
    {current==="sponsorship"?<AssociationSponsorships workspaceId={workspaceId} canManage={canManage}/>:null}
    {current==="sync"?<PaymentSync workspaceId={workspaceId} canManage={canManage}/>:null}
    {current==="activity"?<ActivityLog workspaceId={workspaceId}/>:null}
    {current==="keys"?<AssociationCredentialsPanel workspaceId={workspaceId} disabled={!canManage}/>:null}
    {current==="mailboxes"?<AssociationMailboxPanel workspaceId={workspaceId} disabled={!canManage}/>:null}
    {current==="privacy"?<AssociationPrivacyPanel workspaceId={workspaceId} disabled={!canManage}/>:null}
  </section>;
}
