import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, type Prisma } from '@qaforge/database';
import { Role, createOrganizationSchema } from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import { assertRole, isValidRole } from '../common/rbac';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';

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
  constructor(private readonly audit: AuditService) {}

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
    return { ...org, role: membership.role };
  }

  async addMember(
    actor: SessionUser,
    orgId: string,
    body: { email: string; role: string },
  ) {
    await this.requireMembership(actor.id, orgId, Role.ADMIN);

    if (!isValidRole(body.role) || body.role === Role.OWNER) {
      throw new ConflictException('Invalid role');
    }

    const target = await prisma.user.findUnique({ where: { email: body.email } });
    if (!target) {
      throw new NotFoundException(`No user with email ${body.email}`);
    }

    const existing = await prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: target.id },
      },
    });
    if (existing) {
      throw new ConflictException('User is already a member');
    }

    const membership = await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: target.id,
        role: body.role,
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
      metadata: { email: body.email, role: body.role },
    });

    return membership;
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
