"use client";

/** Secret-safe promotion catalogue for event checkout. [COMP:app-web/association] */
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { AssociationPromotion } from "@/lib/api/association";
import { Button } from "@/components/ui/button";
import { useAssociationModule } from "./module-controls";
import { AssociationListState,useAssociationPage } from "./operator-controls";
import { AssociationPromotionForm } from "./catalog-forms";

export function AssociationPromotionsPanel({workspaceId}:{workspaceId:string}) {
  const t=useT().associationPage, module=useAssociationModule(workspaceId);
  const canManage=!!module.data?.canManage&&!module.error;
  const rows=useAssociationPage(workspaceId,"promotions",{},canManage);
  const [editing,setEditing]=useState<AssociationPromotion|"new"|null>(null);
  const enabled=canManage&&module.data?.module.state==="enabled";
  if(module.data&&!module.data.canManage)return <p className="text-sm text-muted-foreground">{t.ownerOnly}</p>;
  return <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-2">
    <div><h2 className="text-lg font-semibold">{t.manage.promotions}</h2><p className="text-sm text-muted-foreground">{t.manage.promotionsHelp}</p></div>
    <Button type="button" className="min-h-11" variant="outline" disabled={!enabled||!!rows.error} onClick={()=>setEditing("new")}>{t.manage.newPromotion}</Button>
  </div>
    {module.data&&module.data.module.state!=="enabled"?<p className="text-sm text-muted-foreground">{t.stateDescriptions[module.data.module.state]}</p>:null}
    <AssociationListState {...rows}>{rows.data?.items.length===0?<p className="text-sm">{t.manage.empty}</p>:null}
      <div className="divide-y divide-border">{rows.data?.items.map(row=><article key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 text-sm"><p className="font-medium">{row.name}</p>
          <p>{t.manage.options[row.status]} · {t.manage.options[row.discountType]} · {row.targetIds.length} {t.manage.options[row.targetKind]}</p>
          <p>{t.manage.redeemedUses}: {row.redeemedUses}{row.maxUses===null?"":` / ${row.maxUses}`} · {t.manage.reserved}: {row.reservedUses}</p>
          <p className="break-all text-xs text-muted-foreground">{row.key} · {t.manage.codeProtected}</p></div>
        <Button type="button" variant="ghost" className="min-h-11" disabled={!enabled||!!rows.error} onClick={()=>setEditing(row)}>{t.manage.edit}</Button>
      </article>)}</div>
    </AssociationListState>
    {editing?<AssociationPromotionForm key={editing==="new"?"new":editing.id} workspaceId={workspaceId} promotion={editing==="new"?undefined:editing} disabled={!enabled||!!rows.error} onSaved={()=>{setEditing(null);void rows.refresh();}}/>:null}
  </section>;
}
