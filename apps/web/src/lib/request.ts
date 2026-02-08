export function getClientIpFromHeaders(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    // X-Forwarded-For can be a comma-separated list.
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp =
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    headers.get("true-client-ip");

  return realIp?.trim() || null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser or top-level navigations
  return origin === new URL(request.url).origin;
}

