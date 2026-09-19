/** Shareable page URLs. Spec: doc.md -> Routes. [COMP:app-web/doc-public-url] */
export function docPublicUrl(
  path: string,
  location: Pick<Location, "protocol" | "origin" | "search"> | undefined =
    typeof window === "undefined" ? undefined : window.location,
): string | null {
  // Server-rendered anchors remain relative until the browser supplies its origin.
  if (!location) return path;
  const base = location.protocol === "file:"
    ? new URLSearchParams(location.search).get("app")
    : location.origin;
  if (!base) return null;
  try {
    const origin = new URL(base);
    if (origin.protocol !== "http:" && origin.protocol !== "https:") return null;
    return new URL(path, origin.origin).href;
  } catch {
    return null;
  }
}
