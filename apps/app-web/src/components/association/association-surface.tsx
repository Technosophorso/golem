"use client";

/** Native workspace Association surface. [COMP:app-web/association] */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, CalendarDays, CreditCard, Home, ListChecks, Settings2, ShieldCheck, Tag, Users, WalletCards, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { OperatorTopbar } from "@/components/operator/operator-topbar";
import { AssociationModuleControls } from "./module-controls";
import { AssociationEventsPanel } from "./events-panel";
import { AssociationMembershipsPanel } from "./memberships-panel";
import { AssociationWaitlistPanel } from "./waitlist-panel";
import { AssociationOperationsPanel } from "./operations-panel";
import { AssociationOrdersPanel } from "./orders-panel";
import { AssociationPromotionsPanel } from "./promotions-panel";

export function AssociationSurface({ workspaceId }: { workspaceId: string }) {
  const t = useT().associationPage, u = t.ux;
  const search = useSearchParams();
  const items: { id: string; label: string; description: string; icon: LucideIcon }[] = [
    { id: "overview", label: t.overview, description: u.intro, icon: Home },
    { id: "memberships", label: u.members, description: u.membersHelp, icon: Users },
    { id: "events", label: t.manage.events, description: u.eventsHelp, icon: CalendarDays },
    { id: "promotions", label: t.manage.promotions, description: u.promotionsHelp, icon: Tag },
    { id: "orders", label: t.orders, description: u.ordersHelp, icon: CreditCard },
    { id: "waitlist", label: t.manage.waitlist, description: u.waitlistHelp, icon: ListChecks },
    { id: "operations", label: t.manage.operations, description: u.operationsHelp, icon: ShieldCheck },
    { id: "settings", label: u.settings, description: u.settingsHelp, icon: Settings2 },
  ];
  const current = items.find(item => item.id === search?.get("section")) ?? items[0]!;
  const section = current.id;
  const href = (id: string) => `/w/${workspaceId}/association?section=${id}`;
  const tasks = [items[1]!, { id: "memberships&view=plans", label: t.manage.plans, description: u.plansHelp, icon: WalletCards }, ...items.slice(2, 6)];
  return <div className="flex h-full min-h-0 min-w-0 flex-col" data-association-surface>
    <OperatorTopbar app="association" right={<Link className="inline-flex min-h-11 items-center gap-2 px-3 text-sm text-primary" href={`/w/${workspaceId}/crm`}>{t.openCrm}<ArrowUpRight aria-hidden className="size-4" /></Link>} />
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <nav className="shrink-0 border-b border-border bg-muted/20 p-2 lg:w-56 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:p-4" aria-label={t.name}>
        <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {items.map(({ id, label, icon: Icon }, index) => <div key={id} className="shrink-0 lg:shrink">
            {(index === 0 || index === 6) && <p className="mb-2 mt-4 hidden px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:block">{index === 0 ? u.dailyWork : u.administration}</p>}
            <Link href={href(id)} aria-current={section === id ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${section === id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><Icon aria-hidden className="size-4 shrink-0" />{label}</Link>
          </div>)}
        </div>
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/10 p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-7">
          <header className="space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t.name}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{section === "overview" ? u.workspace : current.label}</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{current.description}</p></header>
          {section === "overview" && <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tasks.map(({ id, label, description, icon: Icon }) => <Link key={id} href={href(id)} className="group flex min-h-48 flex-col rounded-2xl border border-border bg-background p-5 transition-colors hover:border-primary/50 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-ring">
              <div className="mb-6 flex items-center justify-between"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Icon aria-hidden className="size-5" /></span><ArrowUpRight aria-hidden className="size-4 text-muted-foreground group-hover:text-primary" /></div>
              <h2 className="text-base font-semibold">{label}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            </Link>)}</div>
            <Link href={`/w/${workspaceId}/crm`} className="flex min-h-11 items-center justify-between gap-4 rounded-2xl border border-border bg-background p-5 focus-visible:outline-2 focus-visible:outline-ring"><div><h2 className="font-semibold">{u.contacts}</h2><p className="mt-1 text-sm text-muted-foreground">{u.contactsHelp}</p></div><ArrowUpRight aria-hidden className="size-5 shrink-0" /></Link>
          </>}
          {section !== "overview" && <div className="min-w-0 rounded-2xl border border-border bg-background p-4 md:p-6">
            {section === "settings" && <AssociationModuleControls workspaceId={workspaceId} />}
            {section === "memberships" && <AssociationMembershipsPanel key={`${workspaceId}:${search?.get("view") ?? ""}`} workspaceId={workspaceId} initialView={search?.get("view") === "plans" ? "plans" : "members"} />}
            {section === "events" && <AssociationEventsPanel key={workspaceId} workspaceId={workspaceId} />}
            {section === "promotions" && <AssociationPromotionsPanel key={workspaceId} workspaceId={workspaceId} />}
            {section === "orders" && <AssociationOrdersPanel key={`${workspaceId}:${search?.get("eventId") ?? ""}`} workspaceId={workspaceId} initialEventId={search?.get("eventId") ?? ""} />}
            {section === "waitlist" && <AssociationWaitlistPanel key={workspaceId} workspaceId={workspaceId} />}
            {section === "operations" && <AssociationOperationsPanel key={workspaceId} workspaceId={workspaceId} />}
          </div>}
        </div>
      </div>
    </div>
  </div>;
}
