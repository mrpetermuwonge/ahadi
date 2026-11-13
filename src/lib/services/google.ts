import type { Db } from '../db';
import { APP_URL } from '../config';
import { randomId, safeEqual } from '../ids';
import { AuthError } from './auth';

/**
 * "Continue with Google" using Google's OpenID Connect web-server flow.
 * Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 * Authorized redirect URI to register in Google Cloud Console: {APP_URL}/api/auth/google/callback
 */
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = () => `${APP_URL()}/api/auth/google/callback`;

const safeNext = (n: string | null | undefined) => (n && n.startsWith('/') && !n.startsWith('//') ? n.slice(0, 200) : '/app');

/** Start: remember a one-time state (CSRF) and nonce (replay) on the server, then send the browser to Google. */
export async function googleAuthUrl(db: Db, next: string | null): Promise<string> {
  if (!googleEnabled()) throw new AuthError('google_disabled');
  const state = randomId(32);
  const nonce = randomId(32);
  await db.query(`DELETE FROM oauth_states WHERE expires_at < now()`);
  await db.query(`INSERT INTO oauth_states(state, nonce, next_path, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`, [state, nonce, safeNext(next)]);
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

function decodeJwtPayload(jwt: string): any {
  const part = jwt.split('.')[1];
  if (!part) throw new AuthError('google_failed');
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/**
 * Callback: check state, exchange the code at Google's token endpoint (server to server over HTTPS),
 * then check the ID token's audience, issuer, expiry and nonce. Because the token comes straight from
 * Google's token endpoint over TLS, its signature does not need separate verification (per Google's OIDC docs).
 */
export async function googleCallback(db: Db, state: string | null, code: string | null) {
  if (!state || !code) throw new AuthError('google_failed');
  const rows = await db.query(`DELETE FROM oauth_states WHERE state=$1 AND expires_at > now() RETURNING *`, [state]);
  const saved = rows[0];
  if (!saved || !safeEqual(saved.state, state)) throw new AuthError('google_failed');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) throw new AuthError('google_failed');
  const claims = decodeJwtPayload(json.id_token);
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) throw new AuthError('google_failed');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new AuthError('google_failed');
  if (typeof claims.exp !== 'number' || claims.exp < now) throw new AuthError('google_failed');
  if (claims.nonce !== saved.nonce) throw new AuthError('google_failed');
  return {
    next: saved.next_path as string,
    profile: {
      sub: String(claims.sub),
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: claims.name ?? null,
    },
  };
}
