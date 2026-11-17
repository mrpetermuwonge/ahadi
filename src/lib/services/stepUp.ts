import type { Db } from '../db';
import { sha256 } from '../ids';
import { audit } from '../audit';
import { AuthError, consumeCode, requestCode } from './auth';

/**
 * Step-up verification: before money or committee actions we ask for a FRESH one-time code, even when the person
 * is already logged in. A phone left unlocked, or a stolen session cookie, is then not enough to move money.
 * A successful check is remembered on the session for a few minutes so several actions in a row need one code.
 */
export const STEP_UP_MINUTES = 10;

type U = { id: string; phone: string | null; email: string | null };

function identifierOf(user: U): { kind: 'phone' | 'email'; value: string } {
  if (user.phone) return { kind: 'phone', value: user.phone };
  if (user.email) return { kind: 'email', value: user.email };
  throw new AuthError('step_up_unavailable');
}

export async function hasFreshStepUp(db: Db, token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [s] = await db.query(
    `SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at > now() AND stepped_up_at > now() - interval '${STEP_UP_MINUTES} minutes'`,
    [sha256(token)],
  );
  return !!s;
}

export async function sendStepUpCode(db: Db, user: U, locale = 'en') {
  const id = identifierOf(user);
  return requestCode(db, { kind: id.kind, value: id.value, locale, purpose: 'step_up' });
}

export async function verifyStepUp(db: Db, user: U, token: string, code: string) {
  const id = identifierOf(user);
  await consumeCode(db, id.value, code, 'step_up');
  await db.query('UPDATE sessions SET stepped_up_at=now() WHERE token_hash=$1 AND user_id=$2', [sha256(token), user.id]);
  await audit(db, { actor: user.id, action: 'auth.step_up', entityType: 'user', entityId: user.id });
}
