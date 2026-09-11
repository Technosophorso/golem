export function trustedClientIp(request: Request, trustProxyHeaders: boolean): string | null {
  if (!trustProxyHeaders) return null;
  const direct = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return chain?.at(-1) ?? null;
}
