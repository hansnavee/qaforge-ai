import { ForbiddenException } from '@nestjs/common';
import { Role } from '@qaforge/shared';

const ROLE_RANK: Record<string, number> = {
  [Role.VIEWER]: 0,
  [Role.MEMBER]: 1,
  [Role.ADMIN]: 2,
  [Role.OWNER]: 3,
};

export type MembershipLike = { role: string };

export function roleRank(role: string): number {
  return ROLE_RANK[role] ?? -1;
}

/** Throws ForbiddenException if membership role is below minRole. */
export function assertRole(membership: MembershipLike, minRole: Role): void {
  const current = roleRank(membership.role);
  const required = roleRank(minRole);
  if (current < required) {
    throw new ForbiddenException(
      `Requires role ${minRole} or higher (have ${membership.role})`,
    );
  }
}

export function isValidRole(role: string): role is Role {
  return role in ROLE_RANK;
}
