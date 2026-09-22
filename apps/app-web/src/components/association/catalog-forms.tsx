"use client";

/** Native editors over the canonical generic catalogs and vertical tickets. [COMP:app-web/association] */
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { saveAssociationPlan,saveAssociationEvent,saveAssociationTicket,saveAssociationPromotion,type AssociationPlan,type AssociationEvent,type AssociationTicket,type AssociationPromotion,type AssociationPlanSave,type AssociationPromotionSave } from "@/lib/api/association";
import { Button } from "@/components/ui/button";
import { AssociationField as Field,AssociationChoice as Choice,AssociationToggle as Toggle,useAssociationAction,associationInstant,associationLocalTime } from "./operator-controls";

import { AssociationFormSection as Group, AssociationMoneyField as Money, AssociationCatalogPicker } from "./workspace-ui";

function catalogKey(name:string) { return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,54) || `item-${crypto.randomUUID().slice(0,8)}`; }

export function AssociationPlanForm({workspaceId,plan,disabled,onSaved}:{workspaceId:string;plan?:AssociationPlan;disabled:boolean;onSaved:()=>void}) {
  const u=useT().associationPage.ux,t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState<AssociationPlanSave>(()=>({key:plan?.planKey ?? "",name:plan?.name ?? "",currency:plan?.currency ?? "",feeMinor:Number(plan?.feeMinor ?? 0),billingPeriod:plan?.billingPeriod ?? "manual",benefits:plan?.benefits ?? [],eligibilityNote:plan?.eligibilityNote ?? null,published:plan?.published ?? false,activeFrom:associationLocalTime(plan?.activeFrom),activeTo:associationLocalTime(plan?.activeTo),...(plan?.provider && plan.providerPlanId?{provider:plan.provider,providerPlanId:plan.providerPlanId}:{})}));
  const [customKey,setCustomKey]=useState(!!plan);
  const [validation,setValidation]=useState("");
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(disabled||!e.currentTarget.checkValidity())return;if(!Number.isSafeInteger(form.feeMinor)||form.feeMinor<0){setValidation(u.moneyInvalid);return;}if(form.activeFrom&&form.activeTo&&form.activeTo<=form.activeFrom){setValidation(u.dateInvalid);return;}setValidation("");void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationPlan(workspaceId,{...form,benefits:form.benefits.map(v=>v.trim()).filter(Boolean),activeFrom:associationInstant(form.activeFrom ?? ""),activeTo:associationInstant(form.activeTo ?? "")});onSaved();});}}>
    <h3 className="sr-only">{plan?t.edit:t.newPlan}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-6">
      <Group title={u.basics}>
      <Field label={t.name} value={form.name} onChange={v=>setForm(old=>({...old,name:v,...(!customKey?{key:catalogKey(v)}:{})}))} required maxLength={200}/>
      <Field label={t.benefits} multiline value={form.benefits.join("\n")} onChange={v=>set("benefits",v.split("\n"))}/>
      <Field label={t.eligibility} multiline value={form.eligibilityNote ?? ""} onChange={v=>set("eligibilityNote",v)} maxLength={5000}/>
      </Group>
      <Group title={u.pricing}>
      <Field label={t.currency} value={form.currency} onChange={v=>set("currency",v.toUpperCase())} required maxLength={3}/>
      <Money label={t.fee} currency={form.currency ?? ""} value={form.feeMinor} onChange={v=>set("feeMinor",v ?? Number.NaN)} required/>
      <Choice label={t.billing} value={form.billingPeriod} values={["one_time","monthly","annual","lifetime","manual"]} onChange={v=>set("billingPeriod",v as typeof form.billingPeriod)}/>
      <Toggle label={t.published} checked={form.published} onChange={v=>set("published",v)}/>
      <Field label={t.activeFrom} type="datetime-local" value={form.activeFrom ?? ""} onChange={v=>set("activeFrom",v)}/>
      <Field label={t.activeTo} type="datetime-local" value={form.activeTo ?? ""} onChange={v=>set("activeTo",v)}/>
      </Group>
      <Group title={u.advanced} advanced>
        <p className="col-span-full text-sm text-muted-foreground">{u.advancedHelp}</p>
      <Field label={t.key} value={form.key} onChange={v=>{setCustomKey(true);set("key",v);}} required disabled={!!plan} maxLength={63}/>
      </Group>
    </fieldset><p className="text-sm text-muted-foreground">{u.moneyHelp}</p><p className="text-sm text-muted-foreground">{t.timeHint}</p>{validation?<p role="alert" className="text-sm text-destructive">{validation}</p>:null}{action.feedback}
    <p className="text-sm text-muted-foreground">{u.publicationHelp}</p>
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
export function AssociationEventForm({workspaceId,event,disabled,onSaved}:{workspaceId:string;event?:AssociationEvent;disabled:boolean;onSaved:()=>void}) {
  const u=useT().associationPage.ux,t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState<Omit<AssociationEvent,"id">>(()=>({slug:event?.slug ?? "",title:event?.title ?? "",description:event?.description ?? "",startsAt:associationLocalTime(event?.startsAt),endsAt:associationLocalTime(event?.endsAt),timezone:event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,mode:event?.mode ?? "venue",venue:event?.venue ?? null,onlineUrl:event?.onlineUrl ?? null,registrationOpensAt:associationLocalTime(event?.registrationOpensAt),registrationClosesAt:associationLocalTime(event?.registrationClosesAt),capacity:event?.capacity ?? null,status:event?.status ?? "draft",canonicalUrl:event?.canonicalUrl ?? null,programmeKey:event?.programmeKey ?? null,metadata:event?.metadata ?? {}}));
  const [customKey,setCustomKey]=useState(!!event);
  const [validation,setValidation]=useState("");
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(disabled||!e.currentTarget.checkValidity())return;if(!form.startsAt||!form.endsAt||form.endsAt<=form.startsAt||(form.registrationOpensAt&&form.registrationClosesAt&&form.registrationClosesAt<=form.registrationOpensAt)){setValidation(u.dateInvalid);return;}setValidation("");void action.run(`${t.save}: ${form.title}`,async()=>{await saveAssociationEvent(workspaceId,{...form,startsAt:associationInstant(form.startsAt)!,endsAt:associationInstant(form.endsAt)!,registrationOpensAt:associationInstant(form.registrationOpensAt ?? ""),registrationClosesAt:associationInstant(form.registrationClosesAt ?? ""),onlineUrl:form.onlineUrl||null,canonicalUrl:form.canonicalUrl||null,programmeKey:form.programmeKey||null});onSaved();});}}>
    <h3 className="sr-only">{event?t.edit:t.newEvent}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-6">
      <Group title={u.basics}>
      <Field label={t.name} value={form.title} onChange={v=>setForm(old=>({...old,title:v,...(!customKey?{slug:catalogKey(v)}:{})}))} required maxLength={300}/>
      <Field label={t.description} multiline value={form.description} onChange={v=>set("description",v)} maxLength={50000}/>
      </Group>
      <Group title={u.schedule}>
      <Field label={t.start} type="datetime-local" value={form.startsAt} onChange={v=>set("startsAt",v)} required/>
      <Field label={t.end} type="datetime-local" value={form.endsAt} onChange={v=>set("endsAt",v)} required/>
      <Field label={t.timezone} value={form.timezone} onChange={v=>set("timezone",v)} required maxLength={100}/>
      <Choice label={t.mode} value={form.mode} onChange={v=>set("mode",v as typeof form.mode)} values={["venue","online","hybrid"]}/>
      <Field label={t.venue} value={form.venue ?? ""} onChange={v=>set("venue",v)} maxLength={2000}/>
      <Field label={t.onlineUrl} type="url" value={form.onlineUrl ?? ""} onChange={v=>set("onlineUrl",v)} maxLength={2000}/>
      </Group>
      <Group title={u.registration}>
      <Field label={t.opens} type="datetime-local" value={form.registrationOpensAt ?? ""} onChange={v=>set("registrationOpensAt",v)}/>
      <Field label={t.closes} type="datetime-local" value={form.registrationClosesAt ?? ""} onChange={v=>set("registrationClosesAt",v)}/>
      <Field label={t.capacity} type="number" min={1} max={1000000} value={form.capacity===null?"":String(form.capacity)} onChange={v=>set("capacity",v?Number(v):null)}/>
      <Choice label={t.status} value={form.status} onChange={v=>set("status",v as typeof form.status)} values={["draft","published","cancelled","completed"]}/>
      </Group>
      <Group title={u.advanced} advanced>
        <p className="col-span-full text-sm text-muted-foreground">{u.advancedHelp}</p>
      <Field label={t.slug} value={form.slug} onChange={v=>{setCustomKey(true);set("slug",v);}} required disabled={!!event} maxLength={100}/>
      <Field label={t.canonicalUrl} type="url" value={form.canonicalUrl ?? ""} onChange={v=>set("canonicalUrl",v)} maxLength={2000}/>
      <Field label={t.programmeKey} value={form.programmeKey ?? ""} onChange={v=>set("programmeKey",v)} maxLength={63}/>
      </Group>
    </fieldset><p className="text-sm text-muted-foreground">{t.timeHint}</p>{validation?<p role="alert" className="text-sm text-destructive">{validation}</p>:null}{action.feedback}
    <p className="text-sm text-muted-foreground">{u.publicationHelp}</p>
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
export function AssociationTicketForm({workspaceId,eventId,ticket,disabled,onSaved}:{workspaceId:string;eventId:string;ticket?:AssociationTicket;disabled:boolean;onSaved:()=>void}) {
  const u=useT().associationPage.ux,t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [form,setForm]=useState(()=>({key:ticket?.key ?? "",name:ticket?.name ?? "",currency:ticket?.currency ?? "",priceMinor:Number(ticket?.priceMinor ?? 0),memberPriceMinor:ticket?.memberPriceMinor===null||ticket?.memberPriceMinor===undefined?null:Number(ticket.memberPriceMinor),eligiblePlanKeys:ticket?.eligiblePlanKeys ?? [],eligibilityRequired:ticket?.eligibilityRequired ?? false,eligibilityScope:ticket?.eligibilityScope ?? "buyer" as AssociationTicket["eligibilityScope"],capacity:ticket?.capacity ?? null,perOrderLimit:ticket?.perOrderLimit ?? 10,saleStartsAt:associationLocalTime(ticket?.saleStartsAt),saleEndsAt:associationLocalTime(ticket?.saleEndsAt),status:ticket?.status ?? "draft"}));
  const [customKey,setCustomKey]=useState(!!ticket);
  const [validation,setValidation]=useState("");
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(disabled||!e.currentTarget.checkValidity())return;if(!Number.isSafeInteger(form.priceMinor)||form.priceMinor<0||(form.memberPriceMinor!==null&&(!Number.isSafeInteger(form.memberPriceMinor)||form.memberPriceMinor<0))){setValidation(u.moneyInvalid);return;}if(form.saleStartsAt&&form.saleEndsAt&&form.saleEndsAt<=form.saleStartsAt){setValidation(u.dateInvalid);return;}setValidation("");void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationTicket(workspaceId,eventId,{...form,eligiblePlanKeys:form.eligiblePlanKeys.map(v=>v.trim()).filter(Boolean),saleStartsAt:associationInstant(form.saleStartsAt),saleEndsAt:associationInstant(form.saleEndsAt)});onSaved();});}}>
    <h3 className="sr-only">{ticket?t.edit:t.newTicket}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-6">
      <Group title={u.basics}>
      <Field label={t.name} value={form.name} onChange={v=>setForm(old=>({...old,name:v,...(!customKey?{key:catalogKey(v)}:{})}))} required maxLength={200}/>
      </Group>
      <Group title={u.pricing}>
      <Field label={t.currency} value={form.currency} onChange={v=>set("currency",v.toUpperCase())} required maxLength={3}/>
      <Money label={t.price} currency={form.currency ?? ""} value={form.priceMinor} onChange={v=>set("priceMinor",v ?? Number.NaN)} required/>
      <Field label={t.capacity} type="number" min={1} max={1000000} value={form.capacity===null?"":String(form.capacity)} onChange={v=>set("capacity",v?Number(v):null)}/>
      <Field label={t.perOrder} type="number" min={1} max={1000} value={String(form.perOrderLimit)} onChange={v=>set("perOrderLimit",Number(v))} required/>
      <Choice label={t.status} value={form.status} onChange={v=>set("status",v as typeof form.status)} values={["draft","on_sale","sold_out","closed"]}/>
      <Field label={t.saleStart} type="datetime-local" value={form.saleStartsAt} onChange={v=>set("saleStartsAt",v)}/>
      <Field label={t.saleEnd} type="datetime-local" value={form.saleEndsAt} onChange={v=>set("saleEndsAt",v)}/>
      </Group>
      <Group title={u.eligibility}>
      <Money label={t.memberPrice} currency={form.currency} value={form.memberPriceMinor} onChange={v=>set("memberPriceMinor",v)}/>
      <div className="col-span-full space-y-2"><p className="text-sm font-medium">{t.eligiblePlans}</p><AssociationCatalogPicker workspaceId={workspaceId} resource="plans" usePlanKeys selected={form.eligiblePlanKeys} onChange={eligiblePlanKeys=>setForm(old=>({...old,eligiblePlanKeys,eligibilityRequired:eligiblePlanKeys.length?true:old.eligibilityRequired}))}/></div>
      <Toggle label={t.eligibilityRequired} checked={form.eligibilityRequired} onChange={v=>set("eligibilityRequired",v)}/>
      <Choice label={t.eligibilityScope} value={form.eligibilityScope} values={["buyer","attendees","buyer_and_attendees"]} onChange={v=>set("eligibilityScope",v as typeof form.eligibilityScope)}/>
      </Group>
      <Group title={u.advanced} advanced>
        <p className="col-span-full text-sm text-muted-foreground">{u.advancedHelp}</p>
      <Field label={t.key} value={form.key} onChange={v=>{setCustomKey(true);set("key",v);}} required disabled={!!ticket} maxLength={63}/>
      </Group>
    </fieldset><p className="text-sm text-muted-foreground">{u.moneyHelp}</p><p className="text-sm text-muted-foreground">{t.timeHint}</p>{validation?<p role="alert" className="text-sm text-destructive">{validation}</p>:null}{action.feedback}
    <p className="text-sm text-muted-foreground">{u.publicationHelp}</p>
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}

export function AssociationPromotionForm({workspaceId,promotion,disabled,onSaved}:{workspaceId:string;promotion?:AssociationPromotion;disabled:boolean;onSaved:()=>void}) {
  const u=useT().associationPage.ux,t=useT().associationPage.manage,action=useAssociationAction(workspaceId);
  const [code,setCode]=useState("");
  const [targetEvent,setTargetEvent]=useState<string[]>([]);
  const [form,setForm]=useState<AssociationPromotionSave>(()=>({
    key:promotion?.key ?? "",name:promotion?.name ?? "",discountType:promotion?.discountType ?? "percentage",
    percentageBasisPoints:promotion?.percentageBasisPoints ?? 1000,amountMinor:promotion?.amountMinor===null||promotion?.amountMinor===undefined?null:Number(promotion.amountMinor),currency:promotion?.currency ?? null,
    buyQuantity:promotion?.buyQuantity ?? null,getQuantity:promotion?.getQuantity ?? null,targetKind:promotion?.targetKind ?? "event",targetIds:promotion?.targetIds ?? [],
    recurrenceMode:promotion?.recurrenceMode ?? "once",recurrenceCycles:promotion?.recurrenceCycles ?? null,applyMode:promotion?.applyMode ?? "each_eligible_item",
    validFrom:associationLocalTime(promotion?.validFrom),validTo:associationLocalTime(promotion?.validTo),
    maxUses:promotion?.maxUses ?? null,maxUsesPerContact:promotion?.maxUsesPerContact ?? null,
    combinesWithMemberPrice:promotion?.combinesWithMemberPrice ?? false,releaseOnFullRefund:promotion?.releaseOnFullRefund ?? false,
    status:promotion?.status ?? "draft",
  }));
  const [customKey,setCustomKey]=useState(!!promotion);
  const [validation,setValidation]=useState("");
  const set=<K extends keyof typeof form>(key:K,value:(typeof form)[K])=>setForm(old=>({...old,[key]:value}));
  const percentage=form.percentageBasisPoints===null?"":String(form.percentageBasisPoints/100);
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(disabled||!e.currentTarget.checkValidity())return;if(!form.targetIds.some(id=>id.trim())){setValidation(u.noSelection);return;}if(form.discountType==="fixed_amount"&&(!Number.isSafeInteger(form.amountMinor)||!form.amountMinor||form.amountMinor<0)){setValidation(u.moneyInvalid);return;}if(form.validFrom&&form.validTo&&form.validTo<=form.validFrom){setValidation(u.dateInvalid);return;}setValidation("");
    const targetIds=form.targetIds.map(id=>id.trim()).filter(Boolean);
    void action.run(`${t.save}: ${form.name}`,async()=>{await saveAssociationPromotion(workspaceId,{...form,targetIds,
      validFrom:associationInstant(form.validFrom ?? ""),validTo:associationInstant(form.validTo ?? ""),
      ...(code.trim()?{code:code.trim()}:{}),
      percentageBasisPoints:form.discountType==="percentage"?form.percentageBasisPoints:null,
      amountMinor:form.discountType==="fixed_amount"?form.amountMinor:null,
      currency:form.discountType==="fixed_amount"?form.currency:null,
      buyQuantity:form.discountType==="buy_x_get_y"?form.buyQuantity:null,
      getQuantity:form.discountType==="buy_x_get_y"?form.getQuantity:null,
      recurrenceMode:form.targetKind==="plan"?form.recurrenceMode:"once",
      recurrenceCycles:form.targetKind==="plan"&&form.recurrenceMode==="repeating"?form.recurrenceCycles:null,
      applyMode:form.discountType==="buy_x_get_y"?"each_eligible_item":form.applyMode,
    });setCode("");onSaved();},{description:t.promotionReview});}}>
    <h3 className="sr-only">{promotion?t.edit:t.newPromotion}</h3><fieldset disabled={disabled||action.pending} className="grid min-w-0 gap-6">
      <Group title={u.discount}>
      <Field label={t.name} value={form.name} onChange={v=>setForm(old=>({...old,name:v,...(!customKey?{key:catalogKey(v)}:{})}))} required maxLength={200}/>
      <Field label={promotion?t.replacementCode:t.promotionCode} value={code} onChange={setCode} required={!promotion} autoComplete="off" minLength={3} maxLength={100}/>
      <Choice label={t.discountType} value={form.discountType} values={["percentage","fixed_amount","full","buy_x_get_y"]} onChange={v=>set("discountType",v as typeof form.discountType)}/>
      {form.discountType==="percentage"?<Field label={t.percentageDiscount} type="number" min={0.01} max={100} step={0.01} value={percentage} onChange={v=>set("percentageBasisPoints",v?Math.round(Number(v)*100):null)} required/>:null}
      {form.discountType==="fixed_amount"?<><Money label={t.fixedAmountMinor} currency={form.currency ?? ""} value={form.amountMinor} onChange={v=>set("amountMinor",v)} required/><Field label={t.currency} value={form.currency ?? ""} onChange={v=>set("currency",v.toUpperCase())} required maxLength={3}/></>:null}
      {form.discountType==="buy_x_get_y"?<><Field label={t.buyQuantity} type="number" min={1} max={1000} value={form.buyQuantity===null?"":String(form.buyQuantity)} onChange={v=>set("buyQuantity",v?Number(v):null)} required/><Field label={t.getQuantity} type="number" min={1} max={1000} value={form.getQuantity===null?"":String(form.getQuantity)} onChange={v=>set("getQuantity",v?Number(v):null)} required/></>:null}
      </Group>
      <Group title={u.selectTargets}>
      <Choice label={t.promotionTarget} value={form.targetKind} values={["event","ticket","plan"]} onChange={v=>{setForm(old=>({...old,targetKind:v as typeof form.targetKind,targetIds:[]}));setTargetEvent([]);}}/>
      {form.targetKind==="ticket"?<div className="col-span-full space-y-2"><p className="text-sm font-medium">{u.chooseEvent}</p><AssociationCatalogPicker workspaceId={workspaceId} resource="events" single selected={targetEvent} onChange={setTargetEvent}/></div>:null}
      <AssociationCatalogPicker key={form.targetKind} workspaceId={workspaceId} resource={form.targetKind==="plan"?"plans":form.targetKind==="event"?"events":"tickets"} eventId={targetEvent[0]} selected={form.targetIds} onChange={ids=>set("targetIds",ids)}/>
      {form.targetKind==="ticket"&&!targetEvent.length&&form.targetIds.length?<p className="col-span-full text-sm">{u.selected}: {form.targetIds.length}</p>:null}
      {form.targetKind==="plan"?<Choice label={t.recurrenceMode} value={form.recurrenceMode} values={["once","forever","repeating"]} onChange={v=>set("recurrenceMode",v as typeof form.recurrenceMode)}/>:null}
      {form.targetKind==="plan"&&form.recurrenceMode==="repeating"?<Field label={t.recurrenceCycles} type="number" min={2} max={120} value={form.recurrenceCycles===null?"":String(form.recurrenceCycles)} onChange={v=>set("recurrenceCycles",v?Number(v):null)} required/>:null}
      {form.discountType!=="buy_x_get_y"?<Choice label={t.applyMode} value={form.applyMode} values={["once_per_order","each_eligible_item"]} onChange={v=>set("applyMode",v as typeof form.applyMode)}/>:null}
      </Group>
      <Group title={u.limits}>
      <Field label={t.activeFrom} type="datetime-local" value={form.validFrom ?? ""} onChange={v=>set("validFrom",v)}/>
      <Field label={t.activeTo} type="datetime-local" value={form.validTo ?? ""} onChange={v=>set("validTo",v)}/>
      <Field label={t.maxUses} type="number" min={1} max={1000000} value={form.maxUses===null?"":String(form.maxUses)} onChange={v=>set("maxUses",v?Number(v):null)}/>
      <Field label={t.maxUsesPerContact} type="number" min={1} max={10000} value={form.maxUsesPerContact===null?"":String(form.maxUsesPerContact)} onChange={v=>set("maxUsesPerContact",v?Number(v):null)}/>
      <Choice label={t.status} value={form.status} values={["draft","active","disabled"]} onChange={v=>set("status",v as typeof form.status)}/>
      </Group>
      <Group title={u.advanced} advanced>
        <p className="col-span-full text-sm text-muted-foreground">{u.advancedHelp}</p>
      <Field label={t.key} value={form.key} onChange={v=>{setCustomKey(true);set("key",v);}} required disabled={!!promotion} maxLength={63}/>
      <Toggle label={t.combinesWithMemberPrice} checked={form.combinesWithMemberPrice} onChange={v=>set("combinesWithMemberPrice",v)}/>
      <Toggle label={t.releaseOnFullRefund} checked={form.releaseOnFullRefund} onChange={v=>set("releaseOnFullRefund",v)}/>
      </Group>
    </fieldset><p className="text-sm text-muted-foreground">{t.promotionsHelp}</p><p className="text-sm text-muted-foreground">{t.timeHint}</p>{validation?<p role="alert" className="text-sm text-destructive">{validation}</p>:null}{action.feedback}
    <p className="text-sm text-muted-foreground">{u.publicationHelp}</p>
    <Button type="submit" className="min-h-11" disabled={disabled||action.pending}>{t.save}</Button>
  </form>;
}
