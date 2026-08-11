import { z } from 'zod';

export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  LEAD: 'LEAD',
  MEMBER: 'MEMBER',
  TESTER: 'TESTER',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'LEAD',
  'MEMBER',
  'TESTER',
  'VIEWER',
]);

/** Roles an admin can assign (Owner is transferred, not invited). */
export const ASSIGNABLE_ROLES = [
  Role.ADMIN,
  Role.LEAD,
  Role.TESTER,
  Role.VIEWER,
] as const;

export const ROLE_RANK: Record<string, number> = {
  [Role.VIEWER]: 0,
  [Role.TESTER]: 1,
  [Role.MEMBER]: 2,
  [Role.LEAD]: 2,
  [Role.ADMIN]: 3,
  [Role.OWNER]: 4,
};

export function roleRank(role: string): number {
  return ROLE_RANK[String(role).toUpperCase()] ?? -1;
}

export function roleLabel(role: string): string {
  if (role === Role.OWNER) return 'Owner';
  if (role === Role.ADMIN) return 'Administrator';
  if (role === Role.LEAD || role === Role.MEMBER) return 'Lead';
  if (role === Role.TESTER) return 'Tester';
  if (role === Role.VIEWER) return 'Viewer';
  return role;
}

export function roleBlurb(role: string): string {
  if (role === Role.OWNER) return 'Billing, team, and full project access.';
  if (role === Role.ADMIN) return 'Manage team, projects, cases, and runs.';
  if (role === Role.LEAD || role === Role.MEMBER) {
    return 'Design cases, start and complete runs, and execute tests.';
  }
  if (role === Role.TESTER) {
    return 'Execute runs: Pass/Fail, comments, and evidence. Cannot edit cases.';
  }
  if (role === Role.VIEWER) return 'Read-only access to cases, runs, and reports.';
  return '';
}

export type TcmsCapabilities = {
  role: string;
  canView: boolean;
  canExecute: boolean;
  canDesign: boolean;
  canManageRuns: boolean;
  canManageProject: boolean;
  canManageMembers: boolean;
  canManageBilling: boolean;
};

export function tcmsCapabilities(role?: string | null): TcmsCapabilities {
  const r = String(role ?? Role.VIEWER).toUpperCase();
  const rank = roleRank(r);
  return {
    role: r,
    canView: rank >= roleRank(Role.VIEWER),
    canExecute: rank >= roleRank(Role.TESTER),
    canDesign: rank >= roleRank(Role.LEAD),
    canManageRuns: rank >= roleRank(Role.LEAD),
    canManageProject: rank >= roleRank(Role.ADMIN),
    canManageMembers: rank >= roleRank(Role.ADMIN),
    canManageBilling: rank >= roleRank(Role.OWNER),
  };
}

export const addOrgMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(['ADMIN', 'LEAD', 'TESTER', 'VIEWER']).default('TESTER'),
});

export const updateOrgMemberSchema = z.object({
  role: z.enum(['ADMIN', 'LEAD', 'TESTER', 'VIEWER']),
});
