// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Instance } from "tippy.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlockDragHandlePlugin } from "../block-drag-handle";

let editor: Editor | undefined;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

describe("[COMP:app-web/block-drag-handle] modal isolation", () => {
  it("places the actual tippy wrapper below the settings dialog layer", () => {
    const host = document.createElement("div");
    document.body.append(host);
    editor = new Editor({ element: host, extensions: [StarterKit], content: "<p>Example block</p>" });
    const grip = document.createElement("div");
    editor.registerPlugin(createBlockDragHandlePlugin({ editor, element: grip }));
    editor.commands.setTextSelection(1);

    // Inspect the real popup wrapper, not the grip's ineffective child z-index.
    const popup = (editor.view.dom as HTMLElement & { _tippy: Instance })._tippy;
    expect(popup).toBeDefined();
    expect(Number(popup.popper.style.zIndex)).toBeGreaterThan(0);
    expect(Number(popup.popper.style.zIndex)).toBeLessThan(50);
  });

  it("hides a stale background grip when Base UI opens a dialog, preserving the dialog's own editor", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // Extract the actual rule: jsdom cannot parse the full Tailwind entrypoint.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../app/globals.css"), "utf8");
    const rule = css.match(/([^{}]*\[data-base-ui-inert\][^{}]*\.doc-drag-handle)\s*\{([^}]+)\}/);
    expect(rule).not.toBeNull();
    const selector = rule![1].trim().replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const style = document.createElement("style");
    style.textContent = `${selector} {${rule![2]}}`;
    document.body.append(style);
    const declaration = (style.sheet!.cssRules[0] as CSSStyleRule).style;
    expect(declaration.getPropertyValue("visibility")).toBe("hidden");
    // The plugin sets inline visibility, so the modal rule must override it.
    expect(declaration.getPropertyPriority("visibility")).toBe("important");

    const render = (open: boolean) => act(async () => {
      root!.render(<>
        <div className="doc-drag-handle" data-testid="background-grip" style={{ visibility: "visible" }} />
        <Dialog.Root open={open}>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup>
              <Dialog.Title>Example settings</Dialog.Title>
              <div className="doc-drag-handle" data-testid="dialog-grip" style={{ visibility: "visible" }} />
              <Dialog.Close>Close</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </>);
    });
    await render(false);
    const background = document.querySelector<HTMLElement>('[data-testid="background-grip"]')!;
    expect(background.matches(selector)).toBe(false);
    await render(true);
    expect(background.style.visibility).toBe("visible");
    expect(background.matches(selector)).toBe(true);
    expect(document.querySelector('[data-testid="dialog-grip"]')!.matches(selector)).toBe(false);
    await render(false);
    expect(background.matches(selector)).toBe(false);
    host.setAttribute("inert", "");
    expect(background.matches(selector)).toBe(true);
  });
});
