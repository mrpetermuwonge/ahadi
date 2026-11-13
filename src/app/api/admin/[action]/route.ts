import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { adminReview } from '@/lib/services/payouts';
import { runPendingPayments, runReconciliation, runReminders } from '@/lib/services/jobs';
import { DEFAULT_SETTINGS, saveSetting, type SettingKey } from '@/lib/settings';
import { api, apiUser, jsonError } from '@/lib/web';

/** Admin overrides. Every one is audit-logged. */
export const POST = api(async (req, { params }: { params: { action: string } }) => {
  const user = await apiUser();
  if (!user.is_admin) return jsonError('forbidden', 403);
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
      for (const [k, val] of Object.entries(b.values)) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        await saveSetting(db, k as SettingKey, val, user.id);
      }
      await log('admin.settings', 'settings', 'global', b.values);
      break;
    }
    case 'run-jobs': {
      const reminders = await runReminders(db);
      const pending = await runPendingPayments(db);
      const recon = await runReconciliation(db);
      return NextResponse.json({ reminders, pending, recon });
    }
    default:
      return jsonError('not_found', 404);
  }
  return NextResponse.json({ ok: true });
});
