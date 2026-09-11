/** Resolve an app-origin return without allowing an open redirect. */
export function resolveAppLoginReturn(
  requestUrl: URL,
  rawNext: string | null,
): URL {
  if (!rawNext || rawNext.startsWith("//")) return new URL(requestUrl.origin);
  try {
    const candidate = new URL(rawNext, requestUrl.origin);
    return candidate.origin === requestUrl.origin
      ? candidate
      : new URL(requestUrl.origin);
  } catch {
    return new URL(requestUrl.origin);
  }
}
