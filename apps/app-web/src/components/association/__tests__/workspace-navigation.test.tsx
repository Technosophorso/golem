// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state=vi.hoisted(()=>({query:""}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("@/components/operator/operator-topbar",()=>({OperatorTopbar:()=>null}));
vi.mock("../overview",()=>({AssociationOverview:()=> <div data-overview/>}));
vi.mock("../operations-panel",()=>({AssociationOperationsPanel:({initialTab}:{initialTab?:string})=> <div data-settings={initialTab ?? ""}/>}));
vi.mock("../members-panel",()=>({AssociationMembersPanel:({initialNew}:{initialNew:boolean})=> <div data-members={String(initialNew)}/>}));
vi.mock("../plans-panel",()=>({AssociationPlansPanel:()=> <div data-plans/>}));
vi.mock("../payments-panel",()=>({AssociationPaymentsPanel:()=> <div data-payments/>}));
vi.mock("../events-panel",()=>({AssociationEventsPanel:({initialEventId}:{initialEventId:string})=><div data-events={initialEventId}/>}));
vi.mock("../promotions-panel",()=>({AssociationPromotionsPanel:()=>null}));
vi.mock("../orders-panel",()=>({AssociationOrdersPanel:({initialEventId}:{initialEventId:string})=><div data-event-filter={initialEventId}/>}));
vi.mock("../waitlist-panel",()=>({AssociationWaitlistPanel:()=>null}));
import { AssociationSurface, resolveAssociationSection, associationHref } from "../association-surface";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{state.query="";host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(){await act(async()=>root.render(<I18nProvider locale="en" dict={en}><AssociationSurface workspaceId="fictional-workspace"/></I18nProvider>));}
describe("[COMP:app-web/association] Task navigation",()=>{
  it("starts on Home and keeps lifecycle controls under Settings",async()=>{
    await render();expect(host.querySelector("[data-overview]")).not.toBeNull();
    expect(host.querySelector("[data-settings]")).toBeNull();
    const links=[...host.querySelectorAll("nav a")].map(link=>link.getAttribute("href"));
    expect(links).toContain(associationHref("fictional-workspace","plans"));
    expect(links).toContain(associationHref("fictional-workspace","payments"));
    state.query="section=settings&tab=sync";await render();expect(host.querySelector("[data-settings]")?.getAttribute("data-settings")).toBe("sync");
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(en.associationPage.ux.settings);
  });
  it("keeps old section links working through aliases",()=>{
    expect(resolveAssociationSection(new URLSearchParams("section=memberships&view=plans"))).toBe("plans");
    expect(resolveAssociationSection(new URLSearchParams("section=memberships&view=payments"))).toBe("payments");
    expect(resolveAssociationSection(new URLSearchParams("section=operations"))).toBe("settings");
    expect(resolveAssociationSection(new URLSearchParams("section=memberships"))).toBe("memberships");
    expect(resolveAssociationSection(new URLSearchParams("section=unknown"))).toBe("overview");
    expect(resolveAssociationSection(null)).toBe("overview");
  });
  it("opens tasks directly and preserves event-filtered links",async()=>{
    state.query="section=memberships&view=plans";await render();expect(host.querySelector("[data-plans]")).not.toBeNull();
    state.query="section=memberships&new=1";await render();expect(host.querySelector("[data-members]")?.getAttribute("data-members")).toBe("true");
    state.query="section=orders&eventId=fictional-event";await render();expect(host.querySelector("[data-event-filter]")?.getAttribute("data-event-filter")).toBe("fictional-event");
    state.query="section=events&eventId=fictional-event";await render();expect(host.querySelector("[data-events]")?.getAttribute("data-events")).toBe("fictional-event");
    state.query="section=operations";await render();expect(host.querySelector("[data-settings]")).not.toBeNull();
  });
  it("recovers an unknown section to Home",async()=>{
    state.query="section=unknown";await render();expect(host.querySelector("[data-overview]")).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(en.associationPage.ux.home);
  });
});
