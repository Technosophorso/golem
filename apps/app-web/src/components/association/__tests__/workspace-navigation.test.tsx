// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const state=vi.hoisted(()=>({query:""}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("@/components/operator/operator-topbar",()=>({OperatorTopbar:()=>null}));
vi.mock("../module-controls",()=>({AssociationModuleControls:()=> <div data-settings/>}));
vi.mock("../memberships-panel",()=>({AssociationMembershipsPanel:({initialView}:{initialView:string})=> <div data-memberships={initialView}/>}));
vi.mock("../events-panel",()=>({AssociationEventsPanel:()=>null}));
vi.mock("../promotions-panel",()=>({AssociationPromotionsPanel:()=>null}));
vi.mock("../orders-panel",()=>({AssociationOrdersPanel:({initialEventId}:{initialEventId:string})=><div data-event-filter={initialEventId}/>}));
vi.mock("../waitlist-panel",()=>({AssociationWaitlistPanel:()=>null}));
vi.mock("../operations-panel",()=>({AssociationOperationsPanel:()=>null}));
import { AssociationSurface } from "../association-surface";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{state.query="";host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(){await act(async()=>root.render(<I18nProvider locale="en" dict={en}><AssociationSurface workspaceId="fictional-workspace"/></I18nProvider>));}
describe("[COMP:app-web/association] Task navigation",()=>{
  it("starts with daily tasks and keeps lifecycle controls in settings",async()=>{
    await render();expect(host.querySelector("h1")?.textContent).toBe(en.associationPage.ux.workspace);
    expect(host.querySelector("[data-settings]")).toBeNull();
    expect([...host.querySelectorAll("a")].map(link=>link.getAttribute("href"))).toContain("/w/fictional-workspace/association?section=memberships&view=plans");
    state.query="section=settings";await render();expect(host.querySelector("[data-settings]")).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(en.associationPage.ux.settings);
  });
  it("opens the plan task directly and preserves event-filtered order links",async()=>{
    state.query="section=memberships&view=plans";await render();expect(host.querySelector("[data-memberships]")?.getAttribute("data-memberships")).toBe("plans");
    state.query="section=orders&eventId=fictional-event";await render();expect(host.querySelector("[data-event-filter]")?.getAttribute("data-event-filter")).toBe("fictional-event");
  });
  it("recovers an unknown section to the task overview",async()=>{
    state.query="section=unknown";await render();expect(host.querySelector("h1")?.textContent).toBe(en.associationPage.ux.workspace);
  });
});
