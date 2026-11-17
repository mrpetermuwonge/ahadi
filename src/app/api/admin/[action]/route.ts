import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { adminReview } from '@/lib/services/payouts';
import { runPendingPayments, runReconciliation, runReminders } from '@/lib/services/jobs';
import { adminReassignOwner } from '@/lib/services/events';
import { changeSettings, decideProposal, setAdminRole } from '@/lib/services/adminTeam';
import { refundPayment } from '@/lib/services/payments';
import { erasePledgerByPhone } from '@/lib/services/pledges';
import { runBackup, runRetention } from '@/lib/services/ops';
import type { AdminPermission, AdminRole } from '@/lib/adminPermissions';
import { api, apiAdmin, jsonError, requireStepUp } from '@/lib/web';

/**
 * Admin actions. Each needs an admin permission (lib/adminPermissions.ts); the sensitive ones also need a fresh
 * one-time code (step-up). Every action is audit-logged.
 */
const NEEDS: Record<string, AdminPermission> = {
  freeze: 'events.freeze',
  'verify-event': 'events.verify',
  home: 'home.review',
  'resolve-flag': 'flags.resolve',
  'payout-review': 'payouts.review',
  verification: 'verifications.review',
  'resolve-recon': 'recon.resolve',
  settings: 'settings.edit',
  'setting-decide': 'settings.approve',
  'run-jobs': 'jobs.run',
  'team-set': 'team.manage',
  'reassign-owner': 'accounts.recover',
  refund: 'payments.refund',
  'erase-pledger': 'privacy.erase',
  'backup-now': 'ops.run',
  'retention-now': 'ops.run',
};
const STEP_UP = new Set(['payout-review', 'settings', 'setting-decide', 'team-set', 'reassign-owner', 'refund', 'erase-pledger']);

export const POST = api(async (req, { params }: { params: { action: string } }) => {
  const perm = NEEDS[params.action];
  if (!perm) return jsonError('not_found', 404);
  const user = await apiAdmin(perm);
  if (STEP_UP.has(params.action)) await requireStepUp();
  const db = await getDb();
  const body = await req.json().catch(() => ({}));
  const log = (action: string, entityType: string, entityId: string, details?: unknown, eventId?: string) =>
    audit(db, { actor: user.id, action, entityType, entityId, details, eventId });

  switch (params.action) {
    case 'freeze': {
      const b = z.object({ eventId: z.string(), frozen: z.boolean() }).parse(body);
      await db.query('UPDATE events SET frozen=$2 WHERE id=$1', [b.eventId, b.frozen]);
      await log(b.frozen ? 'admin.freeze' : 'admin.unfreeze', 'event', b.eventId, {}, b.eventId);
      break;
    }
    case 'verify-event': {
      const b = z.object({ eventId: z.string() }).parse(body);
      await db.query('UPDATE events SET verified=true WHERE id=$1', [b.eventId]);
      await log('admin.verify_event', 'event', b.eventId, {}, b.eventId);
      break;
    }
    case 'home': {
      // Approve or decline an event for the homepage slideshow (the owner must have asked for it).
      const b = z.object({ eventId: z.string(), approved: z.boolean() }).parse(body);
      const rows = await db.query('UPDATE events SET home_approved=$2 WHERE id=$1 AND show_on_home RETURNING id', [b.eventId, b.approved]);
      if (rows.length === 0) return jsonError('not_found', 404);
      await log(b.approved ? 'admin.home_approved' : 'admin.home_declined', 'event', b.eventId, {}, b.eventId);
      break;
    }
    case 'resolve-flag': {
      const b = z.object({ reportId: z.string() }).parse(body);
      await db.query(`UPDATE reports SET status='resolved' WHERE id=$1`, [b.reportId]);
      await log('admin.resolve_flag', 'report', b.reportId);
      break;
    }
    case 'payout-review': {
      const b = z.object({ payoutId: z.string(), approve: z.boolean(), note: z.string().max(200) }).parse(body);
      await adminReview(db, b.payoutId, user.id, b.approve, b.note);
      break;
    }
    case 'verification': {
      const b = z.object({ verificationId: z.string(), approve: z.boolean(), note: z.string().max(200) }).parse(body);
      const [v] = await db.query(`UPDATE verifications SET status=$2, note=$3, reviewed_by=$4 WHERE id=$1 RETURNING *`, [b.verificationId, b.approve ? 'approved' : 'rejected', b.note, user.id]);
      if (!v) return jsonError('not_found', 404);
      // An event is verified once both the organizer ID and the supporting document are approved.
      if (v.event_id) {
        const ok = await db.query(`SELECT DISTINCT kind FROM verifications WHERE event_id=$1 AND status='approved'`, [v.event_id]);
        if (ok.length >= 2) await db.query('UPDATE events SET verified=true WHERE id=$1', [v.event_id]);
      }
      await log('admin.verification', 'verification', v.id, { approve: b.approve, note: b.note }, v.event_id);
      break;
    }
    case 'resolve-recon': {
      const b = z.object({ issueId: z.string() }).parse(body);
      await db.query(`UPDATE reconciliation_issues SET resolved=true WHERE id=$1`, [b.issueId]);
      await log('admin.resolve_recon', 'reconciliation_issue', b.issueId);
      break;
    }
    case 'settings': {
      const b = z.object({ values: z.record(z.unknown()) }).parse(body);
      return NextResponse.json(await changeSettings(db, user.id, b.values));
    }
    case 'setting-decide': {
      const b = z.object({ proposalId: z.string(), approve: z.boolean() }).parse(body);
      await decideProposal(db, user.id, b.proposalId, b.approve);
      break;
    }
    case 'run-jobs': {
      const reminders = await runReminders(db);
      const pending = await runPendingPayments(db);
      const recon = await runReconciliation(db);
      await log('admin.run_jobs', 'jobs', 'all');
      return NextResponse.json({ reminders, pending, recon });
    }
    case 'team-set': {
      const b = z.object({ phone: z.string().max(30), role: z.enum(['super', 'finance', 'trust', 'support']).nullable() }).parse(body);
      await setAdminRole(db, user.id, b.phone, b.role as AdminRole | null);
      break;
    }
    case 'reassign-owner': {
      const b = z.object({ eventId: z.string(), phone: z.string().max(30), reason: z.string().max(500) }).parse(body);
      await adminReassignOwner(db, b.eventId, user.id, b.phone, b.reason);
      break;
    }
    case 'refund': {
      const b = z.object({ paymentId: z.string().max(40), note: z.string().max(200) }).parse(body);
      await refundPayment(db, b.paymentId, user.id, b.note);
      break;
    }
    case 'erase-pledger': {
      const b = z.object({ phone: z.string().max(30) }).parse(body);
      await erasePledgerByPhone(db, b.phone, user.id);
      break;
    }
    case 'backup-now': {
      const r = await runBackup(db);
      await log('admin.backup', 'ops', 'backup', r);
      return NextResponse.json(r);
    }
    case 'retention-now': {
      const r = await runRetention(db);
      await log('admin.retention', 'ops', 'retention', r);
      return NextResponse.json(r);
    }
    default:
      return jsonError('not_found', 404);
  }
  return NextResponse.json({ ok: true });
});
