// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChoiceCards, ResponsiveTable, StatusPill, associationStatusTone } from "../ui";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement,root:Root;
beforeEach(()=>{host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function render(node:React.ReactNode){await act(async()=>root.render(<I18nProvider locale="en" dict={en}>{node}</I18nProvider>));}
describe("[COMP:app-web/association] Console building blocks",()=>{
  it("maps commerce and membership states onto a shared tone scale",()=>{
    expect(associationStatusTone("paid")).toBe("success");expect(associationStatusTone("pending")).toBe("warning");
    expect(associationStatusTone("needs_reconciliation")).toBe("danger");expect(associationStatusTone("mystery")).toBe("neutral");
  });
  it("labels a status through the dictionary and falls back to the raw value",async()=>{
    await render(<><StatusPill status="on_sale"/><StatusPill status="paid"/><StatusPill status="custom_state"/></>);
    expect(host.textContent).toContain(en.associationPage.manage.options.on_sale);
    expect(host.textContent).toContain(en.associationPage.orderStates.paid);
    expect(host.textContent).toContain("custom_state");
  });
  it("renders one labelled row per record with the primary cell as the row action",async()=>{
    const rows=[{id:"1",name:"First"},{id:"2",name:"Second"}];let opened="";
    await render(<ResponsiveTable rows={rows} rowKey={row=>row.id} onRowClick={row=>{opened=row.id;}} empty={<p>none</p>} rowData={row=>({"data-test-row":row.id})}
      columns={[{key:"name",label:"Name",primary:true,cell:row=>row.name},{key:"id",label:"Id",cell:row=>row.id}]}/>);
    expect(host.querySelectorAll("[data-test-row]")).toHaveLength(2);
    expect(host.querySelectorAll('[role="cell"][data-label="Name"]')).toHaveLength(2);
    await act(async()=>[...host.querySelectorAll("button")].find(button=>button.textContent==="Second")!.click());
    expect(opened).toBe("2");
    await render(<ResponsiveTable rows={[]} rowKey={()=>""} empty={<p>none</p>} columns={[]}/>);
    expect(host.textContent).toBe("none");
  });
  it("moves the choice with arrow keys and reports the checked card",async()=>{
    function Cards(){const [value,setValue]=useState<"a"|"b">("a");return <ChoiceCards label="Pick" value={value} onChange={setValue} options={[{value:"a",label:"A"},{value:"b",label:"B"}]}/>;}
    await render(<Cards/>);
    const first=host.querySelector<HTMLButtonElement>('[role="radio"]')!;
    await act(async()=>{first.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));});
    const radios=[...host.querySelectorAll('[role="radio"]')];
    expect(radios[1]?.getAttribute("aria-checked")).toBe("true");expect(radios[0]?.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Pick");
  });
});
