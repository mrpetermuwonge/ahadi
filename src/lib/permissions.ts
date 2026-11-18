/**
 * Who may do what on an event: ONE table, used by the server (API routes and pages) and by the interface
 * (which tabs and buttons appear). The server check is the real protection; hiding a button is only courtesy.
 *
 * Roles on an event:
 *  - owner      The organizer. Runs the event: details, settings, committee, pledge changes, messages,
 *               withdrawal requests, billing and verification documents.
 *  - treasurer  Looks after the money: records and reverses cash, sees the full ledger and exports,
 *               gives the second approval on withdrawals. Cannot change the event, the committee or request money.
 *  - viewer     A helper on the committee: sees progress and the pledge list (phone numbers masked) and shares
 *               the event. No money actions, no ledger, no exports.
 *  - admin      Ahadi staff who are not on the committee: read-only support view. Admin actions live in /admin.
 *
 * Separation of duties: when an event has a treasurer, only the treasurer records or reverses cash, so the
 * person who asks for withdrawals is not also the person who records the money coming in.
 */
export type EventRole = 'owner' | 'treasurer' | 'viewer' | 'admin';

export type Permission =
  | 'event.view'
  | 'event.share'
  | 'pledges.contacts' // full phone numbers of pledgers
  | 'pledges.adjust'
  | 'pledges.record' // add pledges made at a meeting / import a list
  | 'pledgers.remind' // "remind everyone who still owes"
  | 'updates.post' // post news to supporters
  | 'pledges.decideChange'
  | 'messages.moderate'
  | 'ledger.view'
  | 'ledger.export'
  | 'cash.record'
  | 'cash.reverse'
  | 'committee.view'
  | 'committee.contacts' // full phone numbers of committee members
  | 'committee.manage'
  | 'committee.transfer' // hand the event over to another committee member
  | 'payouts.view'
  | 'payouts.request'
  | 'payouts.secondApprove'
  | 'settings.manage'
  | 'billing.manage'
  | 'verification.manage';

const MATRIX: Record<Permission, readonly EventRole[]> = {
  'event.view': ['owner', 'treasurer', 'viewer', 'admin'],
  'event.share': ['owner', 'treasurer', 'viewer'],
  'pledges.contacts': ['owner', 'treasurer', 'admin'],
  'pledges.adjust': ['owner'],
  'pledges.record': ['owner', 'treasurer'],
  'pledgers.remind': ['owner', 'treasurer'],
  'updates.post': ['owner'],
  'pledges.decideChange': ['owner'],
  'messages.moderate': ['owner'],
  'ledger.view': ['owner', 'treasurer', 'admin'],
  'ledger.export': ['owner', 'treasurer'],
  'cash.record': ['treasurer', 'owner'], // owner only while the event has no treasurer (see can())
  'cash.reverse': ['treasurer', 'owner'], // same rule
  'committee.view': ['owner', 'treasurer', 'viewer', 'admin'],
  'committee.contacts': ['owner', 'treasurer', 'admin'],
  'committee.manage': ['owner'],
  'committee.transfer': ['owner'],
  'payouts.view': ['owner', 'treasurer', 'admin'],
  'payouts.request': ['owner'],
  'payouts.secondApprove': ['treasurer', 'owner'], // never the person who asked (enforced in payouts service)
  'settings.manage': ['owner'],
  'billing.manage': ['owner'],
  'verification.manage': ['owner'],
};

export interface AccessContext {
  /** The event has at least one treasurer. */
  hasTreasurer: boolean;
}

export function can(role: EventRole | null | undefined, perm: Permission, ctx: AccessContext = { hasTreasurer: false }): boolean {
  if (!role) return false;
  if (!MATRIX[perm].includes(role)) return false;
  if ((perm === 'cash.record' || perm === 'cash.reverse') && role === 'owner' && ctx.hasTreasurer) return false;
  return true;
}

/** Everything a role may do on this event, for the interface. */
export function permissionsFor(role: EventRole | null | undefined, ctx: AccessContext): Record<Permission, boolean> {
  return Object.fromEntries((Object.keys(MATRIX) as Permission[]).map((p) => [p, can(role, p, ctx)])) as Record<Permission, boolean>;
}

export const PERMISSIONS = Object.keys(MATRIX) as Permission[];
