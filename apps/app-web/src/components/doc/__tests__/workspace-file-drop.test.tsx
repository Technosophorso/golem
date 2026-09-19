// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";

const authHarness = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock("@/lib/auth-fetch", () => ({
  authFetch: authHarness.authFetch,
  getValidAccessToken: vi.fn(),
}));
vi.mock("@/lib/desktop-auth-source", () => ({
  usesGatewayCredentials: vi.fn(() => false),
}));
vi.mock("@/lib/recordings/use-recording-upload", () => ({
  useRecordingUpload: () => ({
    run: vi.fn(),
    dismiss: vi.fn(),
    status: "idle",
    uploadProgress: 0,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { WorkspaceFileDropBoundary, WorkspaceFileIntakeButton } from "../workspace-file-drop";

/**
 * [COMP:app-web/workspace-file-drop] The workspace shell catches neutral file
 * drops for review while a marked contextual drop surface keeps ownership.
 */
describe("[COMP:app-web/workspace-file-drop] WorkspaceFileDropBoundary", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    authHarness.authFetch.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  function mount({ offline = false }: { offline?: boolean } = {}) {
    root = createRoot(host!);
    act(() => {
      root!.render(
        <I18nProvider locale="en" dict={en}>
          <WorkspaceFileDropBoundary
            workspaceId="ws-1"
            assistantId="assistant-1"
            offline={offline}
          >
            <WorkspaceFileIntakeButton disabled={offline} />
            <div id="neutral-surface">Workspace surface</div>
            <div id="contextual-drop" data-file-drop-owner="true">
              Chat attachment surface
            </div>
          </WorkspaceFileDropBoundary>
        </I18nProvider>,
      );
    });
  }

  function dispatchDrop(target: Element, files: File[], types = ["Files"]) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: { files, types },
      configurable: true,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function button(label: string) {
    return [...document.body.querySelectorAll("button")].find(
      (el) => el.getAttribute("aria-label") === label || el.textContent === label,
    )!;
  }

  function pickFiles(files: File[]) {
    const input = document.body.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  }

  it("opens a picker review from the toolbar and stages files until explicitly added", async () => {
    mount();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    act(() => button("Add files").click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Drop files here");

    pickFiles([new File(["notes"], "planning-notes.md", { type: "text/markdown" })]);
    expect(document.body.textContent).toContain("planning-notes.md");
    expect(authHarness.authFetch).not.toHaveBeenCalled();

    authHarness.authFetch.mockResolvedValue(new Response(JSON.stringify({
      files: [{ fileName: "planning-notes.md", ok: true, status: "stored" }],
    }), { status: 200 }));
    await act(async () => button("Add to brain").click());
    expect(authHarness.authFetch).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Stored");
  });

  it("dismisses a dropped batch without uploading and opens a fresh picker review", async () => {
    mount();
    dispatchDrop(host!.querySelector("#neutral-surface")!, [new File(["notes"], "discarded.md")]);
    await act(async () => button("Close file intake").click());
    act(() => button("Add files").click());
    expect(document.body.textContent).not.toContain("discarded.md");
    expect(document.body.textContent).toContain("Drop files here");
    expect(authHarness.authFetch).not.toHaveBeenCalled();
  });

  it("keeps the review open during submission and allows closing after it finishes", async () => {
    mount();
    act(() => button("Add files").click());
    pickFiles([new File(["notes"], "planning-notes.md")]);
    let finish!: (response: Response) => void;
    authHarness.authFetch.mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    await act(async () => button("Add to brain").click());
    expect(button("Close file intake").disabled).toBe(true);
    act(() => button("Close file intake").click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finish(new Response(JSON.stringify({ files: [] }), { status: 200 })));
    expect(button("Close file intake").disabled).toBe(false);
  });

  it("stages a neutral workspace drop for review without uploading", () => {
    mount();
    const file = new File(["notes"], "planning-notes.md", { type: "text/markdown" });
    const event = dispatchDrop(host!.querySelector("#neutral-surface")!, [file]);

    expect(event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain("Add files to your brain");
    expect(document.body.textContent).toContain("planning-notes.md");
    expect(authHarness.authFetch).not.toHaveBeenCalled();
  });

  it("lets a marked contextual file workflow override the fallback", () => {
    mount();
    const file = new File(["notes"], "chat-notes.md", { type: "text/markdown" });
    const event = dispatchDrop(host!.querySelector("#contextual-drop")!, [file]);

    expect(event.defaultPrevented).toBe(false);
    expect(document.body.textContent).not.toContain("chat-notes.md");
    expect(authHarness.authFetch).not.toHaveBeenCalled();
  });

  it("keeps an offline drop staged until the workspace reconnects", () => {
    mount({ offline: true });
    expect(button("Add files").disabled).toBe(true);
    const file = new File(["notes"], "offline-notes.md", { type: "text/markdown" });
    dispatchDrop(host!.querySelector("#neutral-surface")!, [file]);

    expect(document.body.textContent).toContain("offline-notes.md");
    expect(document.body.textContent).toContain("after you reconnect");
    const addButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Add to brain",
    );
    expect(addButton?.disabled).toBe(true);
  });

  it("ignores non-file application drags", () => {
    mount();
    const event = dispatchDrop(host!.querySelector("#neutral-surface")!, [], ["text/plain"]);

    expect(event.defaultPrevented).toBe(false);
    expect(document.body.textContent).not.toContain("Add files to your brain");
  });
});
