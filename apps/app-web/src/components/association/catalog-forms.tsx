"use client";

/** Native editors over the canonical generic catalogs and vertical tickets. [COMP:app-web/association] */
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { saveAssociationPlan,saveAssociationEvent,saveAssociationTicket,saveAssociationPromotion,type AssociationPlan,type AssociationEvent,type AssociationTicket,type AssociationPromotion,type AssociationPlanSave,type AssociationPromotionSave } from "@/lib/api/association";
import { Button } from "@/components/ui/button";
import { AssociationField as Field,AssociationChoice as Choice,AssociationToggle as Toggle,useAssociationAction,associationInstant,associationLocalTime } from "./operator-controls";

export function AssociationPlanForm({workspaceId,plan,disabled,onSaved}:{workspaceId:string;plan?:AssociationPlan;disabled:boolean;onSaved:()=>void}) {
  const t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState<AssociationPlanSave>(()=>({key:plan?.planKey ?? "",name:plan?.name ?? "",currency:plan?.currency ?? "",feeMinor:Number(plan?.feeMinor ?? 0),billingPeriod:plan?.billingPeriod ?? "manual",benefits:plan?.benefits ?? [],eligibilityNote:plan?.eligibilityNote ?? null,published:plan?.published ?? false,activeFrom:associationLocalTime(plan?.activeFrom),activeTo:associationLocalTime(plan?.activeTo),...(plan?.provider && plan.providerPlanId?{provider:plan.provider,providerPlanId:plan.providerPlanId}:{})}));
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={e=>{e.preventDefault();if(disabled)return;void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationPlan(workspaceId,{...form,benefits:form.benefits.map(v=>v.trim()).filter(Boolean),activeFrom:associationInstant(form.activeFrom ?? ""),activeTo:associationInstant(form.activeTo ?? "")});onSaved();});}}>
    <h3 className="font-semibold">{plan?t.edit:t.newPlan}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-3 md:grid-cols-2">
      <Field label={t.key} value={form.key} onChange={v=>set("key",v)} required disabled={!!plan} maxLength={63}/>
      <Field label={t.name} value={form.name} onChange={v=>set("name",v)} required maxLength={200}/>
      <Field label={t.currency} value={form.currency} onChange={v=>set("currency",v)} required maxLength={3}/>
      <Field label={t.fee} type="number" min={0} step={1} value={String(form.feeMinor)} onChange={v=>set("feeMinor",Number(v))} required/>
      <Choice label={t.billing} value={form.billingPeriod} values={["one_time","monthly","annual","lifetime","manual"]} onChange={v=>set("billingPeriod",v as typeof form.billingPeriod)}/>
      <Toggle label={t.published} checked={form.published} onChange={v=>set("published",v)}/>
      <Field label={t.activeFrom} type="datetime-local" value={form.activeFrom ?? ""} onChange={v=>set("activeFrom",v)}/>
      <Field label={t.activeTo} type="datetime-local" value={form.activeTo ?? ""} onChange={v=>set("activeTo",v)}/>
      <Field label={t.benefits} multiline value={form.benefits.join("\n")} onChange={v=>set("benefits",v.split("\n"))}/>
      <Field label={t.eligibility} multiline value={form.eligibilityNote ?? ""} onChange={v=>set("eligibilityNote",v)} maxLength={5000}/>
    </fieldset><p className="text-sm text-muted-foreground">{t.timeHint}</p>{action.feedback}
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
export function AssociationEventForm({workspaceId,event,disabled,onSaved}:{workspaceId:string;event?:AssociationEvent;disabled:boolean;onSaved:()=>void}) {
  const t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState<Omit<AssociationEvent,"id">>(()=>({slug:event?.slug ?? "",title:event?.title ?? "",description:event?.description ?? "",startsAt:associationLocalTime(event?.startsAt),endsAt:associationLocalTime(event?.endsAt),timezone:event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,mode:event?.mode ?? "venue",venue:event?.venue ?? null,onlineUrl:event?.onlineUrl ?? null,registrationOpensAt:associationLocalTime(event?.registrationOpensAt),registrationClosesAt:associationLocalTime(event?.registrationClosesAt),capacity:event?.capacity ?? null,status:event?.status ?? "draft",canonicalUrl:event?.canonicalUrl ?? null,programmeKey:event?.programmeKey ?? null,metadata:event?.metadata ?? {}}));
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={e=>{e.preventDefault();if(disabled)return;void action.run(`${t.save}: ${form.title}`,async()=>{await saveAssociationEvent(workspaceId,{...form,startsAt:associationInstant(form.startsAt)!,endsAt:associationInstant(form.endsAt)!,registrationOpensAt:associationInstant(form.registrationOpensAt ?? ""),registrationClosesAt:associationInstant(form.registrationClosesAt ?? ""),onlineUrl:form.onlineUrl||null,canonicalUrl:form.canonicalUrl||null,programmeKey:form.programmeKey||null});onSaved();});}}>
    <h3 className="font-semibold">{event?t.edit:t.newEvent}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-3 md:grid-cols-2">
      <Field label={t.slug} value={form.slug} onChange={v=>set("slug",v)} required disabled={!!event} maxLength={100}/>
      <Field label={t.name} value={form.title} onChange={v=>set("title",v)} required maxLength={300}/>
      <Field label={t.start} type="datetime-local" value={form.startsAt} onChange={v=>set("startsAt",v)} required/>
      <Field label={t.end} type="datetime-local" value={form.endsAt} onChange={v=>set("endsAt",v)} required/>
      <Field label={t.timezone} value={form.timezone} onChange={v=>set("timezone",v)} required maxLength={100}/>
      <Choice label={t.mode} value={form.mode} onChange={v=>set("mode",v as typeof form.mode)} values={["venue","online","hybrid"]}/>
      <Field label={t.venue} value={form.venue ?? ""} onChange={v=>set("venue",v)} maxLength={2000}/>
      <Field label={t.onlineUrl} type="url" value={form.onlineUrl ?? ""} onChange={v=>set("onlineUrl",v)} maxLength={2000}/>
      <Field label={t.opens} type="datetime-local" value={form.registrationOpensAt ?? ""} onChange={v=>set("registrationOpensAt",v)}/>
      <Field label={t.closes} type="datetime-local" value={form.registrationClosesAt ?? ""} onChange={v=>set("registrationClosesAt",v)}/>
      <Field label={t.capacity} type="number" min={1} max={1000000} value={form.capacity===null?"":String(form.capacity)} onChange={v=>set("capacity",v?Number(v):null)}/>
      <Choice label={t.status} value={form.status} onChange={v=>set("status",v as typeof form.status)} values={["draft","published","cancelled","completed"]}/>
      <Field label={t.canonicalUrl} type="url" value={form.canonicalUrl ?? ""} onChange={v=>set("canonicalUrl",v)} maxLength={2000}/>
      <Field label={t.programmeKey} value={form.programmeKey ?? ""} onChange={v=>set("programmeKey",v)} maxLength={63}/>
      <Field label={t.description} multiline value={form.description} onChange={v=>set("description",v)} maxLength={50000}/>
    </fieldset><p className="text-sm text-muted-foreground">{t.timeHint}</p>{action.feedback}
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
export function AssociationTicketForm({workspaceId,eventId,ticket,disabled,onSaved}:{workspaceId:string;eventId:string;ticket?:AssociationTicket;disabled:boolean;onSaved:()=>void}) {
  const t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState(()=>({key:ticket?.key ?? "",name:ticket?.name ?? "",currency:ticket?.currency ?? "",priceMinor:Number(ticket?.priceMinor ?? 0),memberPriceMinor:ticket?.memberPriceMinor===null||ticket?.memberPriceMinor===undefined?null:Number(ticket.memberPriceMinor),eligiblePlanKeys:ticket?.eligiblePlanKeys ?? [],eligibilityRequired:ticket?.eligibilityRequired ?? false,eligibilityScope:ticket?.eligibilityScope ?? "buyer" as AssociationTicket["eligibilityScope"],capacity:ticket?.capacity ?? null,perOrderLimit:ticket?.perOrderLimit ?? 10,saleStartsAt:associationLocalTime(ticket?.saleStartsAt),saleEndsAt:associationLocalTime(ticket?.saleEndsAt),status:ticket?.status ?? "draft"}));
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={e=>{e.preventDefault();if(disabled)return;void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationTicket(workspaceId,eventId,{...form,eligiblePlanKeys:form.eligiblePlanKeys.map(v=>v.trim()).filter(Boolean),saleStartsAt:associationInstant(form.saleStartsAt),saleEndsAt:associationInstant(form.saleEndsAt)});onSaved();});}}>
    <h3 className="font-semibold">{ticket?t.edit:t.newTicket}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-3 md:grid-cols-2">
      <Field label={t.key} value={form.key} onChange={v=>set("key",v)} required disabled={!!ticket} maxLength={63}/>
      <Field label={t.name} value={form.name} onChange={v=>set("name",v)} required maxLength={200}/>
      <Field label={t.currency} value={form.currency} onChange={v=>set("currency",v)} required maxLength={3}/>
      <Field label={t.price} type="number" min={0} step={1} value={String(form.priceMinor)} onChange={v=>set("priceMinor",Number(v))} required/>
      <Field label={t.memberPrice} type="number" min={0} step={1} value={form.memberPriceMinor===null?"":String(form.memberPriceMinor)} onChange={v=>set("memberPriceMinor",v?Number(v):null)}/>
      <Field label={t.capacity} type="number" min={1} max={1000000} value={form.capacity===null?"":String(form.capacity)} onChange={v=>set("capacity",v?Number(v):null)}/>
      <Field label={t.perOrder} type="number" min={1} max={1000} value={String(form.perOrderLimit)} onChange={v=>set("perOrderLimit",Number(v))} required/>
      <Choice label={t.status} value={form.status} onChange={v=>set("status",v as typeof form.status)} values={["draft","on_sale","sold_out","closed"]}/>
      <Field label={t.saleStart} type="datetime-local" value={form.saleStartsAt} onChange={v=>set("saleStartsAt",v)}/>
      <Field label={t.saleEnd} type="datetime-local" value={form.saleEndsAt} onChange={v=>set("saleEndsAt",v)}/>
      <Field label={t.eligiblePlans} value={form.eligiblePlanKeys.join(", ")} onChange={v=>setForm(old=>{const eligiblePlanKeys=v.split(",");return {...old,eligiblePlanKeys,eligibilityRequired:eligiblePlanKeys.some(key=>key.trim())?true:old.eligibilityRequired};})}/>
      <Toggle label={t.eligibilityRequired} checked={form.eligibilityRequired} onChange={v=>set("eligibilityRequired",v)}/>
      <Choice label={t.eligibilityScope} value={form.eligibilityScope} values={["buyer","attendees","buyer_and_attendees"]} onChange={v=>set("eligibilityScope",v as typeof form.eligibilityScope)}/>
    </fieldset><p className="text-sm text-muted-foreground">{t.timeHint}</p>{action.feedback}
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}

export function AssociationPromotionForm({workspaceId,promotion,disabled,onSaved}:{workspaceId:string;promotion?:AssociationPromotion;disabled:boolean;onSaved:()=>void}) {
  const t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [code,setCode]=useState("");
  const [form,setForm]=useState<AssociationPromotionSave>(()=>({
    key:promotion?.key ?? "",name:promotion?.name ?? "",discountType:promotion?.discountType ?? "percentage",
    percentageBasisPoints:promotion?.percentageBasisPoints ?? 1000,buyQuantity:promotion?.buyQuantity ?? null,
    getQuantity:promotion?.getQuantity ?? null,targetKind:promotion?.targetKind ?? "event",targetIds:promotion?.targetIds ?? [],
    validFrom:associationLocalTime(promotion?.validFrom),validTo:associationLocalTime(promotion?.validTo),
    maxUses:promotion?.maxUses ?? null,maxUsesPerContact:promotion?.maxUsesPerContact ?? null,
    combinesWithMemberPrice:promotion?.combinesWithMemberPrice ?? false,releaseOnFullRefund:promotion?.releaseOnFullRefund ?? false,
    status:promotion?.status ?? "draft",
  }));
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  const percentage=form.percentageBasisPoints===null?"":String(form.percentageBasisPoints/100);
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={e=>{e.preventDefault();if(disabled)return;
    const targetIds=form.targetIds.map(id=>id.trim()).filter(Boolean);
    void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationPromotion(workspaceId,{...form,targetIds,
      validFrom:associationInstant(form.validFrom ?? ""),validTo:associationInstant(form.validTo ?? ""),
      ...(code.trim()?{code:code.trim()}:{}),
      percentageBasisPoints:form.discountType==="percentage"?form.percentageBasisPoints:null,
      buyQuantity:form.discountType==="buy_x_get_y"?form.buyQuantity:null,
      getQuantity:form.discountType==="buy_x_get_y"?form.getQuantity:null,
    });setCode("");onSaved();},{description:t.promotionReview});}}>
    <h3 className="font-semibold">{promotion?t.edit:t.newPromotion}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-3 md:grid-cols-2">
      <Field label={t.key} value={form.key} onChange={v=>set("key",v)} required disabled={!!promotion} maxLength={63}/>
      <Field label={t.name} value={form.name} onChange={v=>set("name",v)} required maxLength={200}/>
      <Field label={promotion?t.replacementCode:t.promotionCode} value={code} onChange={setCode} required={!promotion} autoComplete="off" minLength={3} maxLength={100}/>
      <Choice label={t.discountType} value={form.discountType} values={["percentage","full","buy_x_get_y"]} onChange={v=>set("discountType",v as typeof form.discountType)}/>
      {form.discountType==="percentage"?<Field label={t.percentageDiscount} type="number" min={0.01} max={100} step={0.01} value={percentage} onChange={v=>set("percentageBasisPoints",v?Math.round(Number(v)*100):null)} required/>:null}
      {form.discountType==="buy_x_get_y"?<><Field label={t.buyQuantity} type="number" min={1} max={1000} value={form.buyQuantity===null?"":String(form.buyQuantity)} onChange={v=>set("buyQuantity",v?Number(v):null)} required/><Field label={t.getQuantity} type="number" min={1} max={1000} value={form.getQuantity===null?"":String(form.getQuantity)} onChange={v=>set("getQuantity",v?Number(v):null)} required/></>:null}
      <Choice label={t.promotionTarget} value={form.targetKind} values={["event","ticket"]} onChange={v=>set("targetKind",v as typeof form.targetKind)}/>
      <Field label={t.targetIds} multiline value={form.targetIds.join("\n")} onChange={v=>set("targetIds",v.split(/[\n,]/))} required maxLength={4000}/>
      <Field label={t.activeFrom} type="datetime-local" value={form.validFrom ?? ""} onChange={v=>set("validFrom",v)}/>
      <Field label={t.activeTo} type="datetime-local" value={form.validTo ?? ""} onChange={v=>set("validTo",v)}/>
      <Field label={t.maxUses} type="number" min={1} max={1000000} value={form.maxUses===null?"":String(form.maxUses)} onChange={v=>set("maxUses",v?Number(v):null)}/>
      <Field label={t.maxUsesPerContact} type="number" min={1} max={10000} value={form.maxUsesPerContact===null?"":String(form.maxUsesPerContact)} onChange={v=>set("maxUsesPerContact",v?Number(v):null)}/>
      <Toggle label={t.combinesWithMemberPrice} checked={form.combinesWithMemberPrice} onChange={v=>set("combinesWithMemberPrice",v)}/>
      <Toggle label={t.releaseOnFullRefund} checked={form.releaseOnFullRefund} onChange={v=>set("releaseOnFullRefund",v)}/>
      <Choice label={t.status} value={form.status} values={["draft","active","disabled"]} onChange={v=>set("status",v as typeof form.status)}/>
    </fieldset><p className="text-sm text-muted-foreground">{t.promotionsHelp}</p><p className="text-sm text-muted-foreground">{t.targetIdsHelp}</p><p className="text-sm text-muted-foreground">{t.timeHint}</p>{action.feedback}
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
