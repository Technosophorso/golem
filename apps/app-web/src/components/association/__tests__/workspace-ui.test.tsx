// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const api=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("@/lib/api/association",async original=>({...await original<typeof import("@/lib/api/association")>(),listAssociationPage:api.list}));
vi.mock("@/lib/surface-prefetch",()=>({associationPageCacheKey:(w:string,r:string,q={})=>`crm:${w}:${r}:${JSON.stringify(q)}`}));
import { AssociationCatalogPicker, associationAmountToMinor, associationMoney } from "../workspace-ui";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { resetSurfaceCache } from "@/lib/surface-cache";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{resetSurfaceCache();vi.resetAllMocks();host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();resetSurfaceCache();});
describe("[COMP:app-web/association] Named selection and currency presentation",()=>{
  it("converts major units with exact currency precision and rejects unsafe values",()=>{
    expect(associationAmountToMinor("1080.01","HKD")).toBe(108001);
    expect(associationAmountToMinor("100","JPY")).toBe(100);
    expect(associationAmountToMinor("1.234","KWD")).toBe(1234);
    expect(associationAmountToMinor("1.001","USD")).toBeNull();
    expect(associationAmountToMinor("9007199254740992","JPY")).toBeNull();
    expect(associationAmountToMinor("-1","USD")).toBeNull();
    expect(associationMoney("9007199254740993","USD")).toContain("90,071,992,547,409.93");
    expect(associationMoney("-50","USD")).toBe("-$0.50");
  });
  it("keeps chosen names across pages and allows removing an off-page selection",async()=>{
    api.list.mockImplementation(async(_w,_r,q)=>({items:q.cursor?[{id:"b",title:"Second workshop"}]:[{id:"a",title:"First workshop"}],nextCursor:q.cursor?null:"next"}));
    function Picker(){const [ids,setIds]=useState<string[]>([]);return <AssociationCatalogPicker workspaceId="w" resource="events" selected={ids} onChange={setIds}/>;}
    await act(async()=>root.render(<I18nProvider locale="en" dict={en}><Picker/></I18nProvider>));
    await act(async()=>host.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
    await act(async()=>[...host.querySelectorAll("button")].find(button=>button.textContent===en.associationPage.next)!.click());
    expect(host.textContent).toContain("First workshop");expect(host.textContent).toContain("Second workshop");
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove: First workshop"]')!.click());
    expect(host.textContent).not.toContain("First workshop");
  });
  it("keeps saved ticket targets removable before an event has been chosen",async()=>{
    function Picker(){const [ids,setIds]=useState(["saved-ticket"]);return <AssociationCatalogPicker workspaceId="w" resource="tickets" selected={ids} onChange={setIds}/>;}
    await act(async()=>root.render(<I18nProvider locale="en" dict={en}><Picker/></I18nProvider>));
    expect(api.list).not.toHaveBeenCalled();
    await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Remove: saved-ticket"]')!.click());
    expect(host.textContent).not.toContain(en.associationPage.ux.retainedSelection);
  });
});
