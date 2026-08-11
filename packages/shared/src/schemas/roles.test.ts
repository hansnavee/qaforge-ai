import { describe, expect, it } from 'vitest';
import {
  Role,
  addOrgMemberSchema,
  roleLabel,
  roleRank,
  tcmsCapabilities,
} from './roles';

describe('TCMS roles', () => {
  it('ranks tester below lead and admin', () => {
    expect(roleRank(Role.VIEWER)).toBeLessThan(roleRank(Role.TESTER));
    expect(roleRank(Role.TESTER)).toBeLessThan(roleRank(Role.LEAD));
    expect(roleRank(Role.LEAD)).toBe(roleRank(Role.MEMBER));
    expect(roleRank(Role.LEAD)).toBeLessThan(roleRank(Role.ADMIN));
  });

  it('gives testers execute but not design', () => {
    const caps = tcmsCapabilities(Role.TESTER);
    expect(caps.canExecute).toBe(true);
    expect(caps.canDesign).toBe(false);
    expect(caps.canManageRuns).toBe(false);
    expect(caps.canManageMembers).toBe(false);
  });

  it('treats legacy MEMBER as lead', () => {
    const caps = tcmsCapabilities(Role.MEMBER);
    expect(roleLabel(Role.MEMBER)).toBe('Lead');
    expect(caps.canDesign).toBe(true);
    expect(caps.canManageRuns).toBe(true);
  });

  it('keeps viewers read-only', () => {
    const caps = tcmsCapabilities(Role.VIEWER);
    expect(caps.canView).toBe(true);
    expect(caps.canExecute).toBe(false);
    expect(caps.canDesign).toBe(false);
  });

  it('allows inviting tester/lead/admin/viewer but not owner', () => {
    expect(addOrgMemberSchema.parse({ email: 'a@b.co', role: 'TESTER' }).role).toBe(
      'TESTER',
    );
    expect(() =>
      addOrgMemberSchema.parse({ email: 'a@b.co', role: 'OWNER' }),
    ).toThrow();
  });
});
