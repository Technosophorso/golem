"use client";

/** Event catalog, ticket inventory, stable attendee check-in and safe exports. [COMP:app-web/association] */
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { checkInAssociationAttendee,correctAssociationCheckIn,exportAssociationAttendees,exportAssociationOperationalRoster,type AssociationEvent,type AssociationRegistration,type AssociationTicket } from "@/lib/api/association";
import { listCrmConsentPurposes } from "@/lib/api/crm";
import { crmRecordHref } from "@/lib/crm-view";
import { associationPageCacheKey } from "@/lib/surface-prefetch";
import { useCachedResource } from "@/lib/surface-cache";
import { Button } from "@/components/ui/button";
import { Select,SelectTrigger,SelectContent,SelectItem,SelectValue } from "@/components/ui/select";
import { useAssociationModule } from "./module-controls";
import { AssociationField,useAssociationPage,AssociationListState,useAssociationAction } from "./operator-controls";
import { AssociationEventForm,AssociationTicketForm } from "./catalog-forms";
import { AssociationReservationForm } from "./reservation-form";

function Attendees({workspaceId,eventId,canManage}:{workspaceId:string;eventId:string;canManage:boolean}) {
  const t=useT().associationPage,rows=useAssociationPage(workspaceId,"registrations",{eventId}),action=useAssociationAction(workspaceId);
  const purposes=useCachedResource(associationPageCacheKey(workspaceId,"email-purposes"),()=>listCrmConsentPurposes(workspaceId));
  const [purpose,setPurpose]=useState(""),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState(false),[rosterExporting,setRosterExporting]=useState(false),[rosterError,setRosterError]=useState(false),[correctionReasons,setCorrectionReasons]=useState<Record<string,string>>({});
  async function download() {
    if(!purpose||exporting||purposes.error)return;
    setExporting(true);setExportError(false);
    try {
      const csv=await exportAssociationAttendees(workspaceId,eventId,purpose),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const anchor=document.createElement("a");anchor.href=url;anchor.download=`attendees-${eventId}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);
    } catch {setExportError(true);}finally {setExporting(false);}
  }
  async function downloadRoster() {
    if(!canManage||rosterExporting)return;
    setRosterExporting(true);setRosterError(false);
    try {
      const csv=await exportAssociationOperationalRoster(workspaceId,eventId),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const anchor=document.createElement("a");anchor.href=url;anchor.download=`operational-roster-${eventId}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);
    } catch {setRosterError(true);}finally {setRosterExporting(false);}
  }
  async function correct(row:AssociationRegistration) {
    const expectedStatus=row.status==="attended"?"attended":"checked_in",reason=(correctionReasons[row.id]??"").trim();
    if(!canManage||reason.length<5||!["checked_in","attended"].includes(row.status))return;
    const saved=await action.run(`${t.manage.correctCheckIn}: ${row.attendeeName}`,()=>correctAssociationCheckIn(workspaceId,row.id,expectedStatus,reason),
      {description:`${t.manage.correctCheckInHelp} ${t.manage.correctionReason}: ${reason}`});
    if(saved){setCorrectionReasons(current=>({...current,[row.id]:""}));void rows.refresh();}
  }
  return <section className="space-y-3"><h3 className="text-lg font-semibold">{t.manage.attendees}</h3>
    <AssociationListState {...rows}>{rows.data?.items.length===0?<p className="text-sm">{t.manage.empty}</p>:null}
      <div className="divide-y divide-border">{rows.data?.items.map(row=><div key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="min-w-0 text-sm"><p>{row.attendeeName}</p><p className="break-all text-muted-foreground">{row.attendeeEmail}</p><p>{t.manage.options[row.status]}</p><p className="break-all text-xs text-muted-foreground">{row.id}</p></div>
        <div className="flex flex-wrap items-center gap-2">{row.attendeeContactId?<Link className="inline-flex min-h-11 items-center text-sm text-primary" href={crmRecordHref(workspaceId,"contact",row.attendeeContactId)}>{t.openContact}</Link>:null}
          {["confirmed","registered"].includes(row.status)?<Button type="button" className="min-h-11" variant="outline" disabled={action.pending||!!rows.error} onClick={()=>void action.run(`${t.manage.checkIn}: ${row.attendeeName}`,()=>checkInAssociationAttendee(workspaceId,row.id))}>{t.manage.checkIn}</Button>:null}</div>
        {canManage&&["checked_in","attended"].includes(row.status)?<div className="w-full space-y-2 rounded-lg bg-muted/40 p-3"><AssociationField label={`${t.manage.correctionReason}: ${row.attendeeName}`} value={correctionReasons[row.id]??""} maxLength={500} onChange={value=>setCorrectionReasons(current=>({...current,[row.id]:value}))}/><Button type="button" className="min-h-11" variant="outline" disabled={action.pending||!!rows.error||(correctionReasons[row.id]??"").trim().length<5} onClick={()=>void correct(row)}>{t.manage.correctCheckIn}</Button></div>:null}
      </div>)}</div>
    </AssociationListState>{action.feedback}
    <div className="space-y-2 rounded-xl border border-border p-3"><label className="text-sm">{t.manage.purpose}</label><Select value={purpose} onValueChange={v=>setPurpose(v ?? "")} disabled={exporting||!!purposes.error}>
      <SelectTrigger className="min-h-11 w-full" aria-label={t.manage.purpose}><SelectValue placeholder={t.manage.choose}/></SelectTrigger><SelectContent>{purposes.data?.filter(p=>!p.archivedAt&&p.applicableChannels.includes("email")).map(p=><SelectItem key={p.id} value={p.purposeKey}>{p.label}</SelectItem>)}</SelectContent>
    </Select><p className="text-sm text-muted-foreground">{t.manage.exportHelp}</p><Button type="button" className="min-h-11" variant="outline" disabled={!purpose||exporting||!!purposes.error} onClick={()=>void download()}>{t.manage.export}</Button>
    {(purposes.error||exportError)?<p role="alert" className="text-sm text-destructive">{t.manage.loadFailed}</p>:null}</div>
    {canManage?<div className="space-y-2 rounded-xl border border-border p-3"><p className="text-sm font-medium">{t.manage.operationalRoster}</p><p className="text-sm text-muted-foreground">{t.manage.operationalRosterHelp}</p><Button type="button" className="min-h-11" variant="outline" disabled={rosterExporting} onClick={()=>void downloadRoster()}>{t.manage.operationalRoster}</Button>{rosterError?<p role="alert" className="text-sm text-destructive">{t.manage.loadFailed}</p>:null}</div>:null}
  </section>;
}
function EventOperations({workspaceId,event,enabled,canManage}:{workspaceId:string;event:AssociationEvent;enabled:boolean;canManage:boolean}) {
  const t=useT().associationPage,rows=useAssociationPage(workspaceId,"tickets",{eventId:event.id});
  const [editing,setEditing]=useState<AssociationTicket|"new"|null>(null),[reserving,setReserving]=useState<AssociationTicket|null>(null);
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{t.manage.tickets}: {event.title}</h3>
    <div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-11 items-center px-3 text-sm text-primary" href={`/w/${workspaceId}/association?section=orders&eventId=${encodeURIComponent(event.id)}`}>{t.eventOrders}</Link><Button type="button" className="min-h-11" variant="outline" disabled={!enabled||!!rows.error} onClick={()=>setEditing("new")}>{t.manage.newTicket}</Button></div></div>
    <AssociationListState {...rows}>{rows.data?.items.length===0?<p className="text-sm">{t.manage.empty}</p>:null}<div className="divide-y divide-border">{rows.data?.items.map(ticket=><div key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="text-sm"><p className="font-medium">{ticket.name}</p><p>{ticket.currency} {ticket.priceMinor} · {t.manage.options[ticket.status]}</p><p>{t.manage.available}: {ticket.available ?? t.manage.unlimited} · {t.manage.reserved}: {ticket.reservedCount}</p><p className="break-all text-xs text-muted-foreground">{t.manage.ticketId}: {ticket.id}</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" className="min-h-11" disabled={!enabled||!!rows.error} onClick={()=>setEditing(ticket)}>{t.manage.edit}</Button><Button type="button" variant="outline" className="min-h-11" disabled={!enabled||!!rows.error||ticket.status!=="on_sale"} onClick={()=>setReserving(ticket)}>{t.manage.reserve}</Button></div>
    </div>)}</div></AssociationListState>
    {editing?<AssociationTicketForm key={editing==="new"?"new":editing.id} workspaceId={workspaceId} eventId={event.id} ticket={editing==="new"?undefined:editing} disabled={!enabled||!!rows.error} onSaved={()=>{setEditing(null);void rows.refresh();}}/>:null}
    {reserving?<AssociationReservationForm key={reserving.id} workspaceId={workspaceId} ticket={rows.data?.items.find(row=>row.id===reserving.id) ?? reserving} disabled={!enabled||!!rows.error}/>:null}
    <Attendees workspaceId={workspaceId} eventId={event.id} canManage={canManage}/>
  </div>;
}
export function AssociationEventsPanel({workspaceId}:{workspaceId:string}) {
  const t=useT().associationPage,rows=useAssociationPage(workspaceId,"events"),module=useAssociationModule(workspaceId);
  const [selected,setSelected]=useState<AssociationEvent|null>(null),[editing,setEditing]=useState<AssociationEvent|"new"|null>(null);
  const configure=!!module.data?.canManage&&!module.error;
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t.manage.events}</h2><Button type="button" className="min-h-11" variant="outline" disabled={!configure||!!rows.error} onClick={()=>setEditing("new")}>{t.manage.newEvent}</Button></div>
    {!configure?<p className="text-sm text-muted-foreground">{t.manage.canConfigure}</p>:null}
    {module.data&&module.data.module.state!=="enabled"?<p className="text-sm text-muted-foreground">{t.stateDescriptions[module.data.module.state]}</p>:null}
    <AssociationListState {...rows}>{rows.data?.items.length===0?<p className="text-sm">{t.manage.empty}</p>:null}<div className="divide-y divide-border">{rows.data?.items.map(event=><div key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <button type="button" className="min-h-11 text-left text-sm" onClick={()=>{setSelected(event);setEditing(null);}}><span className="font-medium">{event.title}</span><span className="block text-muted-foreground">{new Date(event.startsAt).toLocaleString()} · {event.timezone} · {t.manage.options[event.status]}</span><span className="block break-all text-xs text-muted-foreground">{t.manage.eventId}: {event.id}</span></button>
      <Button type="button" className="min-h-11" variant="ghost" disabled={!configure||!!rows.error} onClick={()=>{setSelected(event);setEditing(event);}}>{t.manage.edit}</Button></div>)}</div></AssociationListState>
    {editing?<AssociationEventForm key={editing==="new"?"new":editing.id} workspaceId={workspaceId} event={editing==="new"?undefined:editing} disabled={!configure||!!rows.error} onSaved={()=>{setEditing(null);void rows.refresh();}}/>:null}
    {selected?<EventOperations key={selected.id} workspaceId={workspaceId} event={selected} enabled={module.data?.module.state==="enabled"&&!module.error} canManage={configure}/>:null}
  </section>;
}
