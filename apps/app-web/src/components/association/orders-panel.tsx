"use client";

/** Complete history traversal and idempotent order recovery. [COMP:app-web/association] */
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { changeAssociationOrder, getAssociationOrder, listAssociationOrders,
  type AssociationOrderDetail, type AssociationOrderFilters } from "@/lib/api/association";
import { associationOrdersCacheKey } from "@/lib/surface-prefetch";
import { markSurfaceCacheStale, useCachedResource } from "@/lib/surface-cache";
import { crmRecordHref } from "@/lib/crm-view";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { ListSurfaceSkeleton } from "@/components/chrome/surface-skeleton";
import { AssociationField } from "./operator-controls";

function formatMinor(amount: string, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const scale=BigInt(10)**BigInt(fractionDigits),minor=BigInt(amount),whole=minor/scale;
  const remainder=(minor%scale).toString().padStart(fractionDigits,"0");
  return formatter.formatToParts(whole).map(part=>part.type==="fraction"?remainder:part.value).join("");
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type FilterDraft={eventId:string;contactId:string;status:""|AssociationOrderDetail["status"];createdAfter:string;createdBefore:string};
function initialFilterDraft(eventId:string):FilterDraft{return {eventId:UUID.test(eventId)?eventId:"",contactId:"",status:"",createdAfter:"",createdBefore:""};}
function instant(value:string):string|null{if(!value)return "";const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():null;}

export function AssociationOrdersPanel({ workspaceId,initialEventId="" }: { workspaceId: string;initialEventId?:string }) {
  const t = useT().associationPage;
  const [draft,setDraft]=useState<FilterDraft>(()=>initialFilterDraft(initialEventId));
  const [filters,setFilters]=useState<AssociationOrderFilters>(()=>UUID.test(initialEventId)?{eventId:initialEventId}:{});
  const [filterError,setFilterError]=useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1]!;
  const filterScope=JSON.stringify(filters);
  const { data, error, refresh } = useCachedResource(associationOrdersCacheKey(workspaceId, cursor,filterScope),
    () => listAssociationOrders(workspaceId, cursor ?? undefined,filters));
  const [pending, setPending] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [details,setDetails]=useState<Record<string,AssociationOrderDetail>>({});
  const [detailPending,setDetailPending]=useState<string|null>(null);
  const [detailErrors,setDetailErrors]=useState<Record<string,boolean>>({});
  function applyFilters() {
    const after=instant(draft.createdAfter),before=instant(draft.createdBefore);
    if((draft.eventId&&!UUID.test(draft.eventId))||(draft.contactId&&!UUID.test(draft.contactId))
      ||after===null||before===null||(after&&before&&after>=before)){setFilterError(true);return;}
    setFilterError(false);setCursors([null]);
    setFilters({...(draft.eventId?{eventId:draft.eventId}:{}),...(draft.contactId?{contactId:draft.contactId}:{}),
      ...(draft.status?{status:draft.status}:{}),...(after?{createdAfter:after}:{}),...(before?{createdBefore:before}:{})});
  }
  function clearFilters(){const next=initialFilterDraft("");setDraft(next);setFilters({});setCursors([null]);setFilterError(false);}
  async function toggleDetails(orderId:string){
    if(expanded===orderId){setExpanded(null);return;}
    setExpanded(orderId);if(details[orderId])return;
    setDetailPending(orderId);setDetailErrors(previous=>({...previous,[orderId]:false}));
    try{const order=await getAssociationOrder(workspaceId,orderId);setDetails(previous=>({...previous,[orderId]:order}));}
    catch{setDetailErrors(previous=>({...previous,[orderId]:true}));}
    finally{setDetailPending(null);}
  }
  async function act(orderId: string, action: "cancel" | "confirm-free") {
    if (pending || error) return;
    setPending(orderId);
    try {
      const label = action === "cancel" ? t.cancelOrder : t.confirmFree;
      if (!await confirmDialog({ title: label, description: action === "cancel" ? t.cancelOrderConfirm : t.confirmFreeDescription, confirmLabel: label, cancelLabel: t.cancel })) return;
      setSaveError(false);
      await changeAssociationOrder(workspaceId, orderId, action);
      markSurfaceCacheStale(`crm:${workspaceId}:`);
      markSurfaceCacheStale(`association-orders:${workspaceId}`);
      markSurfaceCacheStale(`association-module:${workspaceId}`);
      await refresh();
    } catch { setSaveError(true); await refresh(); }
    finally { setPending(null); }
  }
  return <section className="space-y-3" data-association-orders>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{t.orders}</h2>
      <Button className="min-h-11" variant="ghost" disabled={!!pending} onClick={() => void refresh()}>{t.refresh}</Button>
    </div>
    <form className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={event=>{event.preventDefault();applyFilters();}}>
      <AssociationField label={t.orderEventId} value={draft.eventId} onChange={eventId=>setDraft(previous=>({...previous,eventId}))}/>
      <AssociationField label={t.orderContactId} value={draft.contactId} onChange={contactId=>setDraft(previous=>({...previous,contactId}))}/>
      <label className="flex min-w-0 flex-col gap-1 text-sm">{t.orderStatus}<select className="min-h-11 rounded-lg border border-border bg-background px-3 text-base" value={draft.status} onChange={event=>setDraft(previous=>({...previous,status:event.target.value as FilterDraft["status"]}))}>
        <option value="">{t.allOrderStatuses}</option>{Object.entries(t.orderStates).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      <AssociationField type="datetime-local" label={t.orderCreatedAfter} value={draft.createdAfter} onChange={createdAfter=>setDraft(previous=>({...previous,createdAfter}))}/>
      <AssociationField type="datetime-local" label={t.orderCreatedBefore} value={draft.createdBefore} onChange={createdBefore=>setDraft(previous=>({...previous,createdBefore}))}/>
      <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-5"><Button type="submit" className="min-h-11">{t.applyOrderFilters}</Button><Button type="button" variant="outline" className="min-h-11" onClick={clearFilters}>{t.clearOrderFilters}</Button></div>
      {filterError?<p role="alert" className="text-sm text-destructive md:col-span-2 xl:col-span-5">{t.orderFilterInvalid}</p>:null}
    </form>
    {(error || saveError) && <p role="alert" className="text-sm text-destructive">{saveError ? t.orderSaveFailed : t.ordersLoadFailed}</p>}
    {!data && !error && <ListSurfaceSkeleton rows={5} />}
    {data?.financialSummary?.length?<div className="grid gap-3 md:grid-cols-2" data-order-financial-summary>{data.financialSummary.map(summary=><section key={summary.currency} className="rounded-xl border border-border p-3 text-sm">
      <h3 className="font-semibold">{t.orderFinancialSummary}: {summary.currency}</h3>
      <p>{t.settledOrders}: {summary.settledOrderCount} / {summary.orderCount}</p>
      <p>{t.subtotal}: {formatMinor(summary.subtotalMinor,summary.currency)} · {t.discount}: {formatMinor(summary.discountMinor,summary.currency)}</p>
      <p>{t.gross}: {formatMinor(summary.grossMinor,summary.currency)} · {t.refundedAmount}: {formatMinor(summary.refundedMinor,summary.currency)} · {t.net}: {formatMinor(summary.netMinor,summary.currency)}</p>
      <p>{t.pendingValue}: {formatMinor(summary.pendingMinor,summary.currency)}</p>
      <p className="text-xs text-muted-foreground">{t.providerSettlementExternal}</p>
    </section>)}</div>:null}
    {data?.orders.length === 0 && <p className="text-sm text-muted-foreground">{t.noOrders}</p>}
    <div className="divide-y divide-border rounded-xl border border-border">
      {data?.orders.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <h3 className="break-all font-mono text-sm" title={order.id}>{t.order} {order.id.slice(0, 8)}</h3>
          <p className="text-sm">{t.orderStates[order.status]}</p>
          <p className="text-xs text-muted-foreground">{t.total}: {formatMinor(order.totalMinor, order.currency)}</p>
          {order.refundState !== "none" && <p className="text-xs text-muted-foreground" data-order-refund>
            {t.refund}: {t.refundStates[order.refundState]}{order.refundedMinor !== "0" ? ` · ${t.refundedAmount}: ${formatMinor(order.refundedMinor, order.currency)}` : ""}
          </p>}
          {order.disputeState !== "none" && <p className="text-xs text-muted-foreground" data-order-dispute>{t.dispute}: {t.disputeStates[order.disputeState]}</p>}
          {order.reservationExpiresAt && order.status === "pending" && <p className="text-xs text-muted-foreground">{t.reservedUntil} {new Date(order.reservationExpiresAt).toLocaleString()}</p>}
          {order.providerReference && <p className="break-all text-xs text-muted-foreground">{t.providerReference}: {order.provider} / {order.providerReference}</p>}
          <div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href={crmRecordHref(workspaceId, "contact", order.contactId)}>{t.openContact}</Link>
            <Button type="button" variant="ghost" className="min-h-11" disabled={detailPending===order.id} onClick={()=>void toggleDetails(order.id)}>{expanded===order.id?t.hideOrderDetails:t.orderDetails}</Button></div>
          {expanded===order.id?<div className="space-y-3 rounded-lg bg-muted/40 p-3" data-order-details>
            {detailPending===order.id?<p>{t.loadingOrderDetails}</p>:null}
            {detailErrors[order.id]?<p role="alert" className="text-destructive">{t.orderDetailsFailed}</p>:null}
            {details[order.id]?.lines.map(line=><div key={line.id} className="text-sm"><p className="font-medium">{line.ticketName} ({line.ticketKey}) · {t.quantity}: {line.quantity}</p>
              <p>{t.unitPrice}: {formatMinor(line.unitPriceMinor,order.currency)} · {t.lineTotal}: {formatMinor(line.lineTotalMinor,order.currency)}{line.discountMinor!=="0"?` · ${t.discount}: ${formatMinor(line.discountMinor,order.currency)}`:""}</p></div>)}
            {details[order.id]?.registrations.length?<div><h4 className="text-sm font-semibold">{t.attendees}</h4>{details[order.id].registrations.map(registration=><p key={registration.id} className="text-sm">{registration.attendeeName} · {t.manage.options[registration.status as keyof typeof t.manage.options] ?? registration.status}</p>)}</div>:null}
          </div>:null}
        </div>
        {order.status === "pending" && <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" disabled={!!pending || !!error} onClick={() => void act(order.id, "cancel")}>{t.cancelOrder}</Button>
          {order.totalMinor === "0" && <Button className="min-h-11" disabled={!!pending || !!error} onClick={() => void act(order.id, "confirm-free")}>{t.confirmFree}</Button>}
        </div>}
      </article>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" variant="outline" disabled={cursors.length === 1 || !!pending} onClick={() => setCursors(previous => previous.slice(0, -1))}>{t.previous}</Button>
      <Button className="min-h-11" variant="outline" disabled={!data?.nextCursor || !!error || !!pending || cursors.includes(data.nextCursor)} onClick={() => { if (data?.nextCursor) setCursors(previous => [...previous, data.nextCursor]); }}>{t.next}</Button>
    </div>
  </section>;
}
