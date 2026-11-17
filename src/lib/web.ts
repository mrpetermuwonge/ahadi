import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getDb } from './db';
import { userFromToken, AuthError } from './services/auth';
import { PledgeError } from './services/pledges';
import { PaymentError } from './services/payments';
import { EventError } from './services/events';
import { PayoutError } from './services/payouts';
import { ZodError } from 'zod';
import { hasFreshStepUp } from './services/stepUp';
import { adminCan, type AdminPermission } from './adminPermissions';
import { checkRate, clientIp } from './rateLimit';
import { reportError } from './monitor';

export const SESSION_COOKIE = 'ahadi_session';

export async function currentUser() {
  const db = await getDb();
  return userFromToken(db, cookies().get(SESSION_COOKIE)?.value);
}

export async function requireUser(next?: string) {
  const u = await currentUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return u;
}

export async function requireAdmin(perm: AdminPermission = 'admin.view') {
  const u = await requireUser('/admin');
  if (!u.is_admin) redirect('/app');
  if (!adminCan(u, perm)) redirect('/admin');
  return u;
}

/** API: the caller must be Ahadi staff with this admin permission (lib/adminPermissions.ts). */
export async function apiAdmin(perm: AdminPermission) {
  const u = await apiUser();
  if (!adminCan(u, perm)) throw new EventError('forbidden');
  return u;
}

/**
 * API: money and committee actions need a fresh one-time code (step-up), even for a logged-in user.
 * The client shows "Confirm it's you", sends the code, and retries the action.
 */
export async function requireStepUp() {
  const ok = await hasFreshStepUp(await getDb(), cookies().get(SESSION_COOKIE)?.value);
  if (!ok) throw new AuthError('step_up_required');
}

/** CSRF protection for cookie-authenticated mutations: the request must come from our own origin. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin) return req.headers.get('sec-fetch-site') !== 'cross-site';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const jsonError = (error: string, status = 400, extra?: unknown) => NextResponse.json({ error, extra }, { status });

/** Wrap a route handler: CSRF check, known business errors -> 4xx with a code the UI translates. */
export function api<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>, opts: { csrf?: boolean } = { csrf: true }) {
  return async (req: Request, ...rest: A) => {
    const wait = checkRate(clientIp(req), new URL(req.url).pathname, req.method);
    if (wait > 0) {
      const r = jsonError('too_many_requests', 429);
      r.headers.set('retry-after', String(wait));
      return r;
    }
    if (opts.csrf !== false && req.method !== 'GET' && !sameOrigin(req)) return jsonError('forbidden', 403);
    try {
      return await fn(req, ...rest);
    } catch (e) {
      if (e instanceof PledgeError) return jsonError(e.code, 400, e.extra);
      if (e instanceof AuthError && e.code === 'step_up_required') return jsonError(e.code, 401);
      if (e instanceof PaymentError || e instanceof AuthError || e instanceof EventError) return jsonError(e.code, e.code === 'forbidden' ? 403 : 400);
      if (e instanceof PayoutError) return jsonError(e.message, 400);
      if (e instanceof ZodError) return jsonError('invalid_input', 400, e.issues.map((i) => i.path.join('.')));
      const ref = reportError(e, `${req.method} ${new URL(req.url).pathname}`);
      return jsonError('generic', 500, { ref });
    }
  };
}

export async function apiUser() {
  const u = await currentUser();
  if (!u) throw new EventError('forbidden');
  return u;
}
