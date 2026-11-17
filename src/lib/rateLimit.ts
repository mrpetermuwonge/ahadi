/**
 * Speed limits per IP address, so nobody can hammer the app (guessing codes, flooding pledges or messages,
 * scraping). Counted in memory, which is right for one server; with several servers use a shared store
 * (e.g. Redis) instead (see TODO.md). Business limits (codes per phone, pledges per phone) stay in the services.
 */
type Bucket = { limit: number; windowMs: number };

/** Stricter limits for sign-in and code endpoints than for ordinary actions. */
export function bucketFor(path: string, method: string): { key: string } & Bucket {
  if (/^\/api\/(auth|pledger)\//.test(path)) return { key: 'auth', limit: 30, windowMs: 60_000 };
  if (path.startsWith('/api/pledges') || path.startsWith('/api/payments')) return { key: 'money', limit: 40, windowMs: 60_000 };
  if (path.startsWith('/api/files')) return { key: 'files', limit: 20, windowMs: 60_000 };
  if (method === 'GET') return { key: 'read', limit: 120, windowMs: 60_000 };
  return { key: 'write', limit: 90, windowMs: 60_000 };
}

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

/** Returns seconds to wait when over the limit, else 0. */
export function checkRate(ip: string, path: string, method: string, now = Date.now()): number {
  const b = bucketFor(path, method);
  const k = `${b.key}:${ip}`;
  const list = (hits.get(k) ?? []).filter((t) => now - t < b.windowMs);
  if (list.length >= b.limit) {
    hits.set(k, list);
    return Math.ceil((b.windowMs - (now - list[0]!)) / 1000);
  }
  list.push(now);
  hits.set(k, list);
  if (now - lastSweep > 5 * 60_000) {
    lastSweep = now;
    for (const [key, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(key);
  }
  return 0;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0]!.trim() : req.headers.get('x-real-ip')) || 'local';
}

/** For tests. */
export function resetRateLimits() {
  hits.clear();
}
