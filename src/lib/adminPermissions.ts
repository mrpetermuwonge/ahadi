/**
 * Ahadi staff roles and what each may do in the Admin panel. ONE table, used by admin pages, tabs, buttons
 * and the admin API (which always checks again).
 *
 *  - super    Everything, including the admin team, global settings and account recovery.
 *  - finance  Money: withdrawals review, refunds, reconciliation, revenue, running the payment jobs.
 *  - trust    Safety: reports, freezing events, document verification, verified badge, homepage approvals,
 *             erasing a person's data on request.
 *  - support  Read-only: sees everything to help people, changes nothing.
 *
 * Every admin can see the analytics overview, events, the audit log and settings (read-only).
 */
export type AdminRole = 'super' | 'finance' | 'trust' | 'support';
export const ADMIN_ROLES: AdminRole[] = ['super', 'finance', 'trust', 'support'];

export type AdminPermission =
  | 'admin.view'
  | 'analytics.export'
  | 'events.freeze'
  | 'events.verify'
  | 'home.review'
  | 'flags.resolve'
  | 'verifications.review'
  | 'payouts.view'
  | 'payouts.review'
  | 'revenue.view'
  | 'recon.resolve'
  | 'jobs.run'
  | 'settings.edit'
  | 'settings.approve'
  | 'team.manage'
  | 'accounts.recover'
  | 'audit.view'
  | 'payments.view'
  | 'payments.refund'
  | 'privacy.erase'
  | 'ops.view'
  | 'ops.run';

const MATRIX: Record<AdminPermission, readonly AdminRole[]> = {
  'admin.view': ['super', 'finance', 'trust', 'support'],
  'analytics.export': ['super', 'finance'],
  'events.freeze': ['super', 'trust'],
  'events.verify': ['super', 'trust'],
  'home.review': ['super', 'trust'],
  'flags.resolve': ['super', 'trust'],
  'verifications.review': ['super', 'trust'],
  'payouts.view': ['super', 'finance', 'trust', 'support'],
  'payouts.review': ['super', 'finance'],
  'revenue.view': ['super', 'finance', 'support'],
  'recon.resolve': ['super', 'finance'],
  'jobs.run': ['super', 'finance'],
  'settings.edit': ['super'],
  'settings.approve': ['super'],
  'team.manage': ['super'],
  'accounts.recover': ['super'],
  'audit.view': ['super', 'finance', 'trust', 'support'],
  'payments.view': ['super', 'finance', 'trust', 'support'],
  'payments.refund': ['super', 'finance'],
  'privacy.erase': ['super', 'trust'],
  'ops.view': ['super', 'finance', 'trust', 'support'],
  'ops.run': ['super'],
};

/** Settings that move money or change what people pay: changing them needs a second super admin. */
export const MONEY_SETTINGS = ['fee_percent', 'fee_min', 'event_pass_price', 'sms_bundle_price', 'sms_bundle_size', 'tip_suggestions', 'free_max_pledges', 'free_max_active_events'];

export function adminRoleOf(user: { is_admin?: boolean; admin_role?: string | null } | null | undefined): AdminRole | null {
  if (!user?.is_admin) return null;
  return (ADMIN_ROLES as string[]).includes(user.admin_role ?? '') ? (user.admin_role as AdminRole) : 'support';
}

export function adminCan(user: { is_admin?: boolean; admin_role?: string | null } | null | undefined, perm: AdminPermission): boolean {
  const role = adminRoleOf(user);
  return !!role && MATRIX[perm].includes(role);
}

export function adminPermissionsFor(user: { is_admin?: boolean; admin_role?: string | null }): Record<AdminPermission, boolean> {
  return Object.fromEntries((Object.keys(MATRIX) as AdminPermission[]).map((p) => [p, adminCan(user, p)])) as Record<AdminPermission, boolean>;
}
