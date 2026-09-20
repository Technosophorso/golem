import { afterEach, describe, expect, it, vi } from "vitest";
import { docPagePath, docBlockHash } from "../doc-page-url";
import { docPublicUrl } from "../doc-public-url";

afterEach(() => vi.unstubAllGlobals());

describe("[COMP:app-web/doc-public-url] shareable links", () => {
  const page = docPagePath("workspace-1", "page-1");
  const bundle = (app?: string) => new URL(
    `file:///Applications/Example.app/renderer/index.html?api=https://api.example${app === undefined ? "" : `&app=${encodeURIComponent(app)}`}#/w/other/p/other`,
  );

  it.each(["https://app.example", "https://brain.example", "http://localhost:3003"])(
    "copies the selected desktop deployment %s without local paths or router state",
    (app) => {
      vi.stubGlobal("window", { location: bundle(app) });
      expect(docPublicUrl(page)).toBe(`${app}${page}`);
      expect(docPublicUrl(docBlockHash("workspace-1", "page-1", "block-1")))
        .toBe(`${app}${page}#b-block-1`);
      expect(docPublicUrl("/share/p/page-1")).toBe(`${app}/share/p/page-1`);
    },
  );

  it("uses the current browser origin, ignoring a desktop query parameter", () => {
    expect(docPublicUrl(page, new URL("https://web.example/w/old?app=https://other.example")))
      .toBe(`https://web.example${page}`);
  });

  it.each([undefined, "", "null", "file:///tmp", "javascript:alert(1)"])(
    "refuses unusable desktop web targets (%s)",
    (app) => expect(docPublicUrl(page, bundle(app))).toBeNull(),
  );

  it("keeps server-rendered anchors relative", () => {
    expect(docPublicUrl(page)).toBe(page);
  });
});
