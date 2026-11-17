import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { newId } from '@/lib/ids';
import { addMember, EventError, eventAccess, removeMember, updateEventDetails, updateEventSettings } from '@/lib/services/events';
import { decideChangeRequest, organizerChangeAmount, recordManualPayment, reverseManualEntry } from '@/lib/services/pledges';
import { requestPayout, secondApprove } from '@/lib/services/payouts';
import { startPurchase } from '@/lib/services/payments';
import { getSettings } from '@/lib/settings';
import { normalizePhone } from '@/lib/phone';
import { api, apiUser, jsonError } from '@/lib/web';
import type { Permission } from '@/lib/permissions';

/**
 * All committee actions on one event. Every action checks the caller's permission on the SERVER against the
 * role table in lib/permissions.ts (eventAccess throws 'forbidden'), so hiding a button is never the only protection.
 */
const NEEDS: Record<string, Permission> = {
  'manual-payment': 'cash.record',
  reverse: 'cash.reverse',
  'adjust-pledge': 'pledges.adjust',
  'decide-change': 'pledges.decideChange',
  'moderate-message': 'messages.moderate',
  'add-member': 'committee.manage',
  'remove-member': 'committee.manage',
  settings: 'settings.manage',
  details: 'settings.manage',
  'request-payout': 'payouts.request',
  'second-approve': 'payouts.secondApprove',
  'buy-pass': 'billing.manage',
  'buy-credits': 'billing.manage',
  verification: 'verification.manage',
};

export const POST = api(async (req, { params }: { params: { id: string; action: string } }) => {
  const needed = NEEDS[params.action];
  if (!needed) return jsonError('not_found', 404);
  const user = await apiUser();
  const db = await getDb();
  const { event } = await eventAccess(db, params.id, user, needed);
  const body = await req.json().catch(() => ({}));
  const ensurePledge = async (pledgeId: string) => {
    const r = await db.query('SELECT 1 FROM pledges WHERE id=$1 AND event_id=$2', [pledgeId, event.id]);
    if (r.length === 0) throw new EventError('not_found');
  };

  switch (params.action) {
    case 'manual-payment': {
      const b = z.object({ pledgeId: z.string(), amount: z.number().int().positive(), reason: z.string().max(200), receipt: z.string().max(60) }).parse(body);
      await ensurePledge(b.pledgeId);
      await recordManualPayment(db, { pledgeId: b.pledgeId, amount: b.amount, reason: b.reason, receiptRef: b.receipt, actor: user.id });
      break;
    }
    case 'reverse': {
      const b = z.object({ journalId: z.string(), reason: z.string().max(200) }).parse(body);
      const [j] = await db.query('SELECT event_id FROM ledger_journals WHERE id=$1', [b.journalId]);
      if (j?.event_id !== event.id) return jsonError('not_found', 404);
      await reverseManualEntry(db, b.journalId, user.id, b.reason);
      break;
    }
    case 'adjust-pledge': {
      const b = z.object({ pledgeId: z.string(), amount: z.number().int().positive() }).parse(body);
      await ensurePledge(b.pledgeId);
      await organizerChangeAmount(db, b.pledgeId, b.amount, user.id);
      break;
    }
    case 'decide-change': {
      const b = z.object({ requestId: z.string(), approve: z.boolean() }).parse(body);
      const [r] = await db.query(`SELECT p.event_id FROM pledge_change_requests c JOIN pledges p ON p.id=c.pledge_id WHERE c.id=$1`, [b.requestId]);
      if (r?.event_id !== event.id) return jsonError('not_found', 404);
      await decideChangeRequest(db, b.requestId, b.approve, user.id);
      break;
    }
    case 'moderate-message': {
      const b = z.object({ pledgeId: z.string(), status: z.enum(['approved', 'hidden']) }).parse(body);
      await ensurePledge(b.pledgeId);
      await db.query('UPDATE pledges SET message_status=$2 WHERE id=$1', [b.pledgeId, b.status]);
      break;
    }
    case 'add-member': {
      const b = z.object({ phone: z.string().max(30), role: z.enum(['treasurer', 'viewer']) }).parse(body);
      await addMember(db, event.id, user.id, b.phone, b.role);
      break;
    }
    case 'remove-member': {
      const b = z.object({ userId: z.string() }).parse(body);
      await removeMember(db, event.id, user.id, b.userId);
      break;
    }
    case 'details': {
      const b = z.object({
        title: z.string().max(100),
        eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        targetAmount: z.number().int().positive().max(1e13).nullable(),
        story: z.string().max(4000),
        coverFileId: z.string().max(40).nullable(),
        details: z.record(z.string().max(200)),
      }).parse(body);
      await updateEventDetails(db, event.id, user.id, b);
      break;
    }
    case 'settings': {
      const b = z.object({
        privacy: z.enum(['hidden_list', 'public_list']).optional(),
        reminderOffsets: z.array(z.number().int()).max(6).optional(),
        status: z.enum(['active', 'closed']).optional(),
        tipsEnabled: z.boolean().optional(),
        showOnHome: z.boolean().optional(),
        showAmounts: z.boolean().optional(),
        organizerKind: z.enum(['individual', 'group', 'faith', 'nonprofit', 'company', 'school']).optional(),
      }).parse(body);
      await updateEventSettings(db, event.id, user.id, b);
      break;
    }
    case 'request-payout': {
      const b = z.object({ accountId: z.string(), amount: z.number().int().positive() }).parse(body);
      await requestPayout(db, { eventId: event.id, userId: user.id, accountId: b.accountId, amount: b.amount });
      break;
    }
    case 'second-approve': {
      const b = z.object({ payoutId: z.string() }).parse(body);
      const [p] = await db.query('SELECT event_id FROM payouts WHERE id=$1', [b.payoutId]);
      if (p?.event_id !== event.id) return jsonError('not_found', 404);
      await secondApprove(db, b.payoutId, user.id);
      break;
    }
    case 'buy-pass':
    case 'buy-credits': {
      const b = z.object({ method: z.enum(['mtn', 'airtel', 'card']), phone: z.string().max(30).nullable(), idempotencyKey: z.string().min(16).max(80) }).parse(body);
      const s = await getSettings(db);
      const phone = b.method === 'card' ? null : normalizePhone(b.phone ?? '');
      if (b.method !== 'card' && !phone) return jsonError('invalid_phone');
      const pass = params.action === 'buy-pass';
      const p = await startPurchase(db, {
        purpose: pass ? 'event_pass' : 'sms_credits', userId: user.id, eventId: event.id,
        amount: pass ? s.event_pass_price : s.sms_bundle_price, method: b.method, phone, currency: event.currency,
        idempotencyKey: `${params.action}:${b.idempotencyKey}`,
      });
      return NextResponse.json({ paymentId: p.id, status: p.status });
    }
    case 'verification': {
      const b = z.object({ fileId: z.string(), kind: z.enum(['organizer_id', 'invoice']) }).parse(body);
      const [f] = await db.query('SELECT 1 FROM files WHERE id=$1 AND owner_user_id=$2', [b.fileId, user.id]);
      if (!f) return jsonError('not_found', 404);
      const id = newId('ver');
      await db.query(`INSERT INTO verifications(id, event_id, user_id, kind, file_id) VALUES ($1,$2,$3,$4,$5)`, [id, event.id, user.id, b.kind, b.fileId]);
      await audit(db, { actor: user.id, action: 'verification.submitted', entityType: 'verification', entityId: id, eventId: event.id, details: { kind: b.kind } });
      break;
    }
  }
  return NextResponse.json({ ok: true });
});
