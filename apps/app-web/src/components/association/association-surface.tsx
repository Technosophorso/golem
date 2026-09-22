"use client";

/** Native workspace Association surface: task-led staff console shell. [COMP:app-web/association] */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Banknote, CalendarDays, ChevronDown, CreditCard, Home, ListChecks, Settings2, Tag, Users, WalletCards, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { OperatorTopbar } from "@/components/operator/operator-topbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AssociationOverview } from "./overview";
import { AssociationEventsPanel } from "./events-panel";
import { AssociationMembersPanel } from "./members-panel";
import { AssociationPlansPanel } from "./plans-panel";
import { AssociationPaymentsPanel } from "./payments-panel";
import { AssociationWaitlistPanel } from "./waitlist-panel";
import { AssociationOperationsPanel } from "./operations-panel";
import { AssociationOrdersPanel } from "./orders-panel";
import { AssociationPromotionsPanel } from "./promotions-panel";

const ASSOCIATION_SECTIONS = ["overview", "memberships", "plans", "events", "promotions", "orders", "waitlist", "payments", "settings"] as const;
export type AssociationSection = (typeof ASSOCIATION_SECTIONS)[number];

/** Old links keep working: `operations` opens Settings, `memberships&view=…` opens plans or offline payments. */
export function resolveAssociationSection(search: URLSearchParams | null): AssociationSection {
  const raw = search?.get("section") ?? "overview", view = search?.get("view");
  if (raw === "memberships" && view === "plans") return "plans";
  if (raw === "memberships" && view === "payments") return "payments";
  if (raw === "operations") return "settings";
  return (ASSOCIATION_SECTIONS as readonly string[]).includes(raw) ? raw as AssociationSection : "overview";
}
export function associationHref(workspaceId: string, section: AssociationSection, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ section, ...params });
  return `/w/${workspaceId}/association?${query}`;
}

export function AssociationSurface({ workspaceId }: { workspaceId: string }) {
  const t = useT().associationPage, u = t.ux;
  const search = useSearchParams();
  const items: { id: AssociationSection; label: string; icon: LucideIcon; group: "daily" | "admin" }[] = [
    { id: "overview", label: u.home, icon: Home, group: "daily" },
    { id: "memberships", label: u.members, icon: Users, group: "daily" },
    { id: "plans", label: t.manage.plans, icon: WalletCards, group: "daily" },
    { id: "events", label: u.eventsNav, icon: CalendarDays, group: "daily" },
    { id: "promotions", label: u.promoCodes, icon: Tag, group: "daily" },
    { id: "orders", label: t.orders, icon: CreditCard, group: "daily" },
    { id: "waitlist", label: t.manage.waitlist, icon: ListChecks, group: "daily" },
    { id: "payments", label: u.offlinePayments, icon: Banknote, group: "daily" },
    { id: "settings", label: u.settings, icon: Settings2, group: "admin" },
  ];
  const section = resolveAssociationSection(search);
  const current = items.find(item => item.id === section) ?? items[0]!;
  const href = (id: AssociationSection) => associationHref(workspaceId, id);
  const eventId = search?.get("eventId") ?? "", wantsNew = search?.get("new") === "1";
  const groups: { id: "daily" | "admin"; label: string }[] = [{ id: "daily", label: u.dailyWork }, { id: "admin", label: u.administration }];
  const CurrentIcon = current.icon;
  return <div className="flex h-full min-h-0 min-w-0 flex-col" data-association-surface>
    <OperatorTopbar app="association"
      center={<DropdownMenu>
        <DropdownMenuTrigger aria-label={u.goTo} className="inline-flex h-11 max-w-48 items-center gap-1.5 rounded-md bg-sidebar-accent/60 px-2 text-[12.5px] text-sidebar-accent-foreground sm:h-7 lg:hidden">
          <CurrentIcon aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{current.label}</span><ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {groups.map((group, index) => <div key={group.id}>{index > 0 ? <DropdownMenuSeparator /> : null}
            {items.filter(item => item.group === group.id).map(item => <DropdownMenuItem key={item.id} className="min-h-11 sm:min-h-0" render={<Link href={href(item.id)} />}><item.icon aria-hidden className="size-3.5" /><span className="min-w-28 flex-1">{item.label}</span></DropdownMenuItem>)}
          </div>)}
        </DropdownMenuContent>
      </DropdownMenu>}
      right={<Link className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-primary md:min-h-8" href={`/w/${workspaceId}/crm`}>{t.openCrm}<ArrowUpRight aria-hidden className="size-4" /></Link>} />
    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-3 lg:block" aria-label={t.name}>
        {groups.map(group => <div key={group.id} className="mb-4">
          <p className="mt-2 mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</p>
          {items.filter(item => item.group === group.id).map(({ id, label, icon: Icon }) => <Link key={id} href={href(id)} aria-current={section === id ? "page" : undefined}
            className={cn("flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring", section === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
            <Icon aria-hidden className="size-4 shrink-0" />{label}</Link>)}
        </div>)}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/10 px-4 py-5 md:px-8 md:py-7">
        <div className="mx-auto max-w-6xl space-y-6">
          {section === "overview" && <AssociationOverview workspaceId={workspaceId} />}
          {section === "memberships" && <AssociationMembersPanel key={`${workspaceId}:${wantsNew}`} workspaceId={workspaceId} initialNew={wantsNew} />}
          {section === "plans" && <AssociationPlansPanel key={`${workspaceId}:${wantsNew}`} workspaceId={workspaceId} initialNew={wantsNew} />}
          {section === "events" && <AssociationEventsPanel key={`${workspaceId}:${eventId}:${wantsNew}`} workspaceId={workspaceId} initialEventId={eventId} initialNew={wantsNew} />}
          {section === "promotions" && <AssociationPromotionsPanel key={`${workspaceId}:${wantsNew}`} workspaceId={workspaceId} initialNew={wantsNew} />}
          {section === "orders" && <AssociationOrdersPanel key={`${workspaceId}:${eventId}`} workspaceId={workspaceId} initialEventId={eventId} />}
          {section === "waitlist" && <AssociationWaitlistPanel key={workspaceId} workspaceId={workspaceId} />}
          {section === "payments" && <AssociationPaymentsPanel key={`${workspaceId}:${wantsNew}`} workspaceId={workspaceId} initialNew={wantsNew} />}
          {section === "settings" && <AssociationOperationsPanel key={`${workspaceId}:${search?.get("tab") ?? ""}`} workspaceId={workspaceId} initialTab={search?.get("tab") ?? undefined} />}
        </div>
      </div>
    </div>
  </div>;
}
