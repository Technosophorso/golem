"use client";

/** Owner/admin reviewed offline-payment rescue. [COMP:app-web/association] */
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  cancelAssociationMembershipRescue, createAssociationMembershipRescue,
  reverseAssociationMembershipRescue, settleAssociationMembershipRescue,
  type AssociationMembershipRescue, type AssociationPlan,
} from "@/lib/api/association";
import type { CrmLookupRow } from "@/lib/api/crm";
import { crmRecordHref } from "@/lib/crm-view";
import { Button } from "@/components/ui/button";
import {
  AssociationChoice as Choice, AssociationField as Field, AssociationIntentNotice,
  AssociationListState, associationInstant, useAssociationAction, useAssociationIntent, useAssociationPage,
} from "./operator-controls";

export function AssociationMembershipRescueForm({workspaceId,plan,contact,disabled,onSaved}:{workspaceId:string;plan:AssociationPlan;contact:CrmLookupRow;disabled:boolean;onSaved:()=>void}) {
  const t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const intent=useAssociationIntent(workspaceId,"membership-offline-rescue",`${plan.id}:${contact.id}`);
  const [start,setStart]=useState(""),[end,setEnd]=useState(""),[due,setDue]=useState(""),[reason,setReason]=useState("");
  const unavailable=disabled||Number(plan.feeMinor)<=0||!!plan.provider;
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={e=>{e.preventDefault();if(unavailable)return;void action.run(t.createRescue,async()=>{
    await createAssociationMembershipRescue(workspaceId,{contactId:contact.id,planId:plan.id,idempotencyKey:intent.identity(),startsAt:associationInstant(start)!,endsAt:associationInstant(end)!,dueAt:associationInstant(due)!,reason});
    onSaved();
  },{description:`${t.rescueReview}: ${contact.name} · ${plan.name} · ${plan.currency} ${plan.feeMinor} · ${new Date(associationInstant(start)!).toLocaleString()} / ${new Date(associationInstant(end)!).toLocaleString()}`});}}>
    <h3 className="font-semibold">{t.createRescue}: {contact.name} / {plan.name}</h3>
    <p className="text-sm text-muted-foreground">{t.rescueHelp}</p>
    <fieldset disabled={unavailable||action.pending} className="grid gap-3 md:grid-cols-2">
      <Field label={t.start} type="datetime-local" value={start} onChange={setStart} required/>
      <Field label={t.end} type="datetime-local" value={end} onChange={setEnd} required/>
      <Field label={t.paymentDue} type="datetime-local" value={due} onChange={setDue} required/>
      <Field label={t.rescueReason} value={reason} onChange={setReason} required maxLength={2000}/>
    </fieldset>
    <p className="text-sm text-muted-foreground">{t.timeHint} {t.rescueLockedMoney}: {plan.currency} {plan.feeMinor}</p>
    {action.feedback}<AssociationIntentNotice reference={intent.reference} onReset={intent.reset} disabled={action.pending}/>
    <Button type="submit" className="min-h-11" disabled={unavailable||action.pending}>{t.createRescue}</Button>
  </form>;
}

export function AssociationMembershipRescueActionForm({workspaceId,row,onSaved}:{workspaceId:string;row:AssociationMembershipRescue;onSaved:()=>void}) {
  const t=useT().associationPage.manage;
  const settle=useAssociationAction(workspaceId),reverse=useAssociationAction(workspaceId),cancel=useAssociationAction(workspaceId);
  const settleIntent=useAssociationIntent(workspaceId,"membership-offline-settle",row.id);
  const reverseIntent=useAssociationIntent(workspaceId,"membership-offline-reverse",row.id);
  const cancelIntent=useAssociationIntent(workspaceId,"membership-offline-cancel",row.id);
  const [method,setMethod]=useState<"bank_transfer"|"cash"|"cheque"|"other">("bank_transfer");
  const [reference,setReference]=useState(""),[occurred,setOccurred]=useState(""),[note,setNote]=useState("");
  const [reversalReference,setReversalReference]=useState(""),[reversalOccurred,setReversalOccurred]=useState(""),[reason,setReason]=useState("");
  const amount=Number(row.amountMinor),pending=settle.pending||reverse.pending||cancel.pending;
  if(row.status==="outstanding")return <div className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">{t.reviewRescue}: {row.contactName} / {row.planName}</h3>
    <div className="grid gap-3 md:grid-cols-2">
      <Choice label={t.settlementMethod} value={method} values={["bank_transfer","cash","cheque","other"]} onChange={v=>setMethod(v as typeof method)} disabled={pending}/>
      <Field label={t.evidenceReference} value={reference} onChange={setReference} required maxLength={500} disabled={pending}/>
      <Field label={t.paymentOccurred} type="datetime-local" value={occurred} onChange={setOccurred} required disabled={pending}/>
      <Field label={t.settlementNote} value={note} onChange={setNote} maxLength={2000} disabled={pending}/>
    </div>
    <p className="text-sm text-muted-foreground">{t.settlementExact}: {row.currency} {row.amountMinor}</p>
    {settle.feedback}<AssociationIntentNotice reference={settleIntent.reference} onReset={settleIntent.reset} disabled={pending}/>
    <Button type="button" className="min-h-11" disabled={pending||!reference||!occurred} onClick={()=>void settle.run(t.recordSettlement,async()=>{
      await settleAssociationMembershipRescue(workspaceId,row.id,{requestId:settleIntent.identity(),method,evidenceReference:reference,amountMinor:amount,currency:row.currency,occurredAt:associationInstant(occurred)!,note:note||null});onSaved();
    },{description:`${t.settlementReview}: ${row.contactName} · ${row.planName} · ${row.currency} ${row.amountMinor} · ${reference}`})}>{t.recordSettlement}</Button>
    <div className="grid gap-3 md:grid-cols-[1fr_auto]"><Field label={t.cancellationReason} value={reason} onChange={setReason} required maxLength={2000} disabled={pending}/>
      <Button type="button" className="min-h-11 self-end" variant="outline" disabled={pending||!reason} onClick={()=>void cancel.run(t.cancelRescue,async()=>{
        await cancelAssociationMembershipRescue(workspaceId,row.id,{requestId:cancelIntent.identity(),reason});onSaved();
      },{description:`${t.cancelRescueReview}: ${row.contactName} · ${row.planName} · ${reason}`})}>{t.cancelRescue}</Button></div>
    {cancel.feedback}<AssociationIntentNotice reference={cancelIntent.reference} onReset={cancelIntent.reset} disabled={pending}/>
  </div>;
  if(row.status==="settled")return <div className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">{t.reverseSettlement}: {row.contactName} / {row.planName}</h3>
    <p className="text-sm text-muted-foreground">{t.reversalHelp}</p>
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t.reversalReference} value={reversalReference} onChange={setReversalReference} required maxLength={500} disabled={pending}/>
      <Field label={t.reversalOccurred} type="datetime-local" value={reversalOccurred} onChange={setReversalOccurred} required disabled={pending}/>
      <Field label={t.reversalReason} value={reason} onChange={setReason} required maxLength={2000} disabled={pending}/>
    </div>
    {reverse.feedback}<AssociationIntentNotice reference={reverseIntent.reference} onReset={reverseIntent.reset} disabled={pending}/>
    <Button type="button" className="min-h-11" variant="outline" disabled={pending||!reversalReference||!reversalOccurred||!reason} onClick={()=>void reverse.run(t.reverseSettlement,async()=>{
      await reverseAssociationMembershipRescue(workspaceId,row.id,{requestId:reverseIntent.identity(),evidenceReference:reversalReference,amountMinor:amount,currency:row.currency,occurredAt:associationInstant(reversalOccurred)!,reason});onSaved();
    },{description:`${t.reversalReview}: ${row.contactName} · ${row.planName} · ${row.currency} ${row.amountMinor} · ${reversalReference}`})}>{t.reverseSettlement}</Button>
  </div>;
  return null;
}

export function AssociationMembershipRescues({workspaceId,canManage}:{workspaceId:string;canManage:boolean}) {
  const t=useT().associationPage.manage,rescues=useAssociationPage(workspaceId,"rescues",{},canManage);
  const [selected,setSelected]=useState<AssociationMembershipRescue|null>(null);
  if(!canManage)return null;
  return <div className="space-y-3"><h2 className="text-lg font-semibold">{t.offlineRescues}</h2><p className="text-sm text-muted-foreground">{t.offlineRescuesHelp}</p>
    <AssociationListState {...rescues}><div className="divide-y divide-border">{rescues.data?.items.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="text-sm"><Link className="inline-flex min-h-11 items-center font-medium text-primary" href={crmRecordHref(workspaceId,"contact",row.contactId)}>{row.contactName}</Link>
        <p>{row.planName} · {row.currency} {row.amountMinor} · {t.options[row.status]}</p>
        <p>{new Date(row.startsAt).toLocaleString()} / {new Date(row.endsAt).toLocaleString()}</p>
        <p className={row.overdue?"text-destructive":"text-muted-foreground"}>{t.paymentDue}: {new Date(row.dueAt).toLocaleString()}{row.overdue?` · ${t.overdue}`:""}</p>
        {row.settlementReference?<p>{t.evidenceReference}: {row.settlementReference}</p>:null}</div>
      {row.status==="outstanding"||row.status==="settled"?<Button type="button" className="min-h-11" variant="outline" disabled={!!rescues.error} onClick={()=>setSelected(row)}>{t.reviewRescue}</Button>:null}
    </div>)}</div>{rescues.data?.items.length===0?<p>{t.empty}</p>:null}</AssociationListState>
    {selected?<AssociationMembershipRescueActionForm key={`${selected.id}:${selected.status}`} workspaceId={workspaceId} row={selected} onSaved={()=>{setSelected(null);void rescues.refresh();}}/>:null}
  </div>;
}
