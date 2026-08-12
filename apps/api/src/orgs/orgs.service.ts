import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, type Prisma } from '@qaforge/database';
import {
  Role,
  addOrgMemberSchema,
  createOrganizationSchema,
  roleRank,
  updateOrgMemberSchema,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt, hasEncryptionKey } from '../common/encryption';
import { assertRole } from '../common/rbac';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { PlanUsageService } from '../billing/plan-usage.service';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';
  return base;
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly audit: AuditService,
    private readonly planUsage: PlanUsageService,
  ) {}

  async create(user: SessionUser, body: unknown) {
    const input = parseBody(createOrganizationSchema, body);
    let slug = slugify(input.name);
    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const org = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const organization = await tx.organization.create({
        data: { name: input.name, slug },
      });
      await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: Role.OWNER,
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          plan: 'FREE',
          status: 'active',
        },
      });
      return organization;
    });

    await this.audit.log({
      organizationId: org.id,
      userId: user.id,
      action: 'org.create',
      resource: 'organization',
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug },
    });

    return org;
  }

  async listForUser(userId: string) {
    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: {
        organization: {
          include: { subscription: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    }));
  }

  /** First organization the user belongs to (creation order). */
  async getDefaultOrgId(userId: string): Promise<string> {
    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });
    if (!membership) {
      throw new NotFoundException('No organization found for this account');
    }
    return membership.organizationId;
  }

  async getById(userId: string, orgId: string) {
    const membership = await this.requireMembership(userId, orgId, Role.VIEWER);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: true,
        memberships: {
          include: {
            user: { select: { id: true, email: true, name: true, image: true } },
          },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const { browserstackEncrypted, ...rest } = org;
    return {
      ...rest,
      role: membership.role,
      browserstackConfigured: Boolean(browserstackEncrypted),
    };
  }

  async saveBrowserstack(
    userId: string,
    orgId: string,
    body: { username?: string; accessKey?: string },
  ) {
    await this.requireMembership(userId, orgId, Role.ADMIN);
    if (!hasEncryptionKey()) {
      throw new BadRequestException('ENCRYPTION_KEY is not configured');
    }
    const username = body.username?.trim() ?? '';
    const accessKey = body.accessKey?.trim() ?? '';
    if (!username || !accessKey) {
      throw new BadRequestException('BrowserStack username and access key are required');
    }
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        browserstackEncrypted: encrypt(JSON.stringify({ username, accessKey })),
      },
    });
    return { ok: true, browserstackConfigured: true };
  }

  async readBrowserstackKeys(orgId: string): Promise<{
    username: string;
    accessKey: string;
  }> {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { browserstackEncrypted: true },
    });
    if (!org?.browserstackEncrypted) {
      throw new BadRequestException(
        'Add BrowserStack username and access key in Settings, then retry Cloud.',
      );
    }
    try {
      const parsed = JSON.parse(decrypt(org.browserstackEncrypted)) as {
        username?: string;
        accessKey?: string;
      };
      if (!parsed.username || !parsed.accessKey) {
        throw new Error('incomplete');
      }
      return { username: parsed.username, accessKey: parsed.accessKey };
    } catch {
      throw new BadRequestException('BrowserStack keys could not be decrypted');
    }
  }

  async addMember(actor: SessionUser, orgId: string, body: unknown) {
    const actorMem = await this.requireMembership(actor.id, orgId, Role.ADMIN);
    const input = parseBody(addOrgMemberSchema, body);
    if (roleRank(input.role) > roleRank(actorMem.role)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }

    const target = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (!target) {
      throw new NotFoundException(
        `No user with email ${input.email}. They must sign up first.`,
      );
    }

    const existing = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: target.id },
      },
    });
    if (existing) {
      throw new ConflictException('User is already a member');
    }

    await this.planUsage.assertSeatLimit(orgId);

    const membership = await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: target.id,
        role: input.role,
      },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      action: 'org.member.add',
      resource: 'membership',
      resourceId: membership.id,
      metadata: { email: input.email, role: input.role },
    });

    return membership;
  }

  async updateMember(
    actor: SessionUser,
    orgId: string,
    membershipId: string,
    body: unknown,
  ) {
    const actorMem = await this.requireMembership(actor.id, orgId, Role.ADMIN);
    const input = parseBody(updateOrgMemberSchema, body);
    if (roleRank(input.role) > roleRank(actorMem.role)) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }

    const target = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === Role.OWNER && actorMem.role !== Role.OWNER) {
      throw new ForbiddenException('Only an owner can change an owner');
    }
    if (target.role === Role.OWNER) {
      const owners = await prisma.membership.count({
        where: { organizationId: orgId, role: Role.OWNER },
      });
      if (owners <= 1) {
        throw new BadRequestException('The organization needs at least one owner');
      }
    }

    const membership = await prisma.membership.update({
      where: { id: target.id },
      data: { role: input.role },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      action: 'org.member.update',
      resource: 'membership',
      resourceId: membership.id,
      metadata: { role: input.role },
    });

    return membership;
  }

  async removeMember(
    actor: SessionUser,
    orgId: string,
    membershipId: string,
  ) {
    const actorMem = await this.requireMembership(actor.id, orgId, Role.ADMIN);
    const target = await prisma.membership.findFirst({
      where: { id: membershipId, organizationId: orgId },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === Role.OWNER) {
      const owners = await prisma.membership.count({
        where: { organizationId: orgId, role: Role.OWNER },
      });
      if (owners <= 1) {
        throw new BadRequestException('Cannot remove the last owner');
      }
      if (actorMem.role !== Role.OWNER) {
        throw new ForbiddenException('Only an owner can remove an owner');
      }
    }
    if (roleRank(target.role) > roleRank(actorMem.role)) {
      throw new ForbiddenException('Cannot remove a member above your role');
    }

    await prisma.membership.delete({ where: { id: target.id } });
    await this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      action: 'org.member.remove',
      resource: 'membership',
      resourceId: target.id,
      metadata: { userId: target.userId },
    });
    return { ok: true, id: membershipId };
  }

  async requireMembership(userId: string, orgId: string, minRole: Role) {
    const membership = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId },
      },
    });
    if (!membership) {
      throw new NotFoundException('Organization not found or access denied');
    }
    assertRole(membership, minRole);
    return membership;
  }
}
