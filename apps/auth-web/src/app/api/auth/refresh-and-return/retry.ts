export function normalizedRetry(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) ? Math.min(4, Math.max(0, parsed)) : 0;
}
