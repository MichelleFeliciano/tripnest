/**
 * Client-side permission model. This only drives the UI (hide/disable buttons).
 * The authoritative enforcement is Postgres row-level security; keep both in sync
 * (see docs/SECURITY.md and tests/rls.test.ts).
 */
export type Role = 'owner' | 'editor' | 'viewer';

export type Action =
  | 'trip.view'
  | 'trip.edit'
  | 'trip.archive'
  | 'trip.delete'
  | 'members.invite'
  | 'members.manage'
  | 'itinerary.edit'
  | 'reservations.edit'
  | 'packing.editShared'
  | 'expenses.add'
  | 'settlements.record'
  | 'budget.edit'
  | 'notes.edit'
  | 'documents.upload';

const EDITOR_ACTIONS: Action[] = [
  'trip.view',
  'members.invite',
  'itinerary.edit',
  'reservations.edit',
  'packing.editShared',
  'expenses.add',
  'settlements.record',
  'budget.edit',
  'notes.edit',
  'documents.upload',
];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([...EDITOR_ACTIONS, 'trip.edit', 'trip.archive', 'trip.delete', 'members.manage']),
  editor: new Set<Action>(EDITOR_ACTIONS),
  viewer: new Set<Action>(['trip.view']),
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && MATRIX[role].has(action);
}

/** Editors may change only the expenses they created; owners may change all. */
export function canModifyExpense(role: Role | null | undefined, createdBy: string, userId: string): boolean {
  return role === 'owner' || (role === 'editor' && createdBy === userId);
}

export function inviteRoleAllowed(inviterRole: Role | null | undefined, invitedRole: Role): boolean {
  if (!can(inviterRole, 'members.invite')) return false;
  return invitedRole === 'editor' || invitedRole === 'viewer'; // ownership is never granted by invitation
}
