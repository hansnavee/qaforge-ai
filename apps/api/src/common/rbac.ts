import { ForbiddenException } from '@nestjs/common';
import { Role, ROLE_RANK, roleRank } from '@qaforge/shared';

export type MembershipLike = { role: string };

export { roleRank };

/** Throws ForbiddenException if membership role is below minRole. */
export function assertRole(membership: MembershipLike, minRole: Role): void {
  const current = roleRank(membership.role);
  const required = ROLE_RANK[minRole] ?? 99;
  if (current < required) {
    throw new ForbiddenException(
      `Requires role ${minRole} or higher (have ${membership.role})`,
    );
  }
}

export function isValidRole(role: string): role is Role {
  return String(role).toUpperCase() in ROLE_RANK;
}
