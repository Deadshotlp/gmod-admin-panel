/**
 * Einfaches Ratenlimit im Arbeitsspeicher.
 *
 * Reicht für ein Panel mit einer Handvoll Admins auf einer Instanz. Bei mehreren
 * Instanzen hinter einem Loadbalancer müsste das nach Redis wandern.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimitKey(request: Request, name: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";

  return `${name}:${ip}`;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

// Abgelaufene Einträge gelegentlich aufräumen, damit die Map nicht wächst.
setInterval(
  () => {
    const now = Date.now();

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  },
  5 * 60 * 1000,
).unref?.();
