import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, type Prisma } from '@qaforge/database';
import {
  Role,
  addOrgMemberSchema,
  createOrganizationSchema,
  parseJiraConnectionConfig,
  roleRank,
  updateOrgMemberSchema,
  verifyJiraConnection,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt, hasEncryptionKey } from '../common/encryption';
import { assertRole } from '../common/rbac';
import { parseBody } from '../common/parse-body';
import type { SessionUser } from '../auth/auth';
import { PlanUsageService } from '../billing/plan-usage.service';
import { z } from 'zod';

const saveJiraSchema = z.object({
  baseUrl: z.string().url().max(500),
  email: z.string().email().max(320),
  apiToken: z.string().min(8).max(2000),
  projectKey: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  issueType: z.string().trim().min(1).max(80).optional(),
});

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
    const canSeeMemberPii = roleRank(membership.role) >= roleRank(Role.ADMIN);
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: true,
        memberships: canSeeMemberPii
          ? {
              include: {
                user: {
                  select: { id: true, email: true, name: true, image: true },
                },
              },
            }
          : false,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const { browserstackEncrypted, jiraEncrypted, ...rest } = org;
    let jiraSummary: {
      baseUrl: string;
      email: string;
      projectKey: string;
      issueType: string;
    } | null = null;
    if (jiraEncrypted && hasEncryptionKey()) {
      try {
        const cfg = parseJiraConnectionConfig(
          JSON.parse(decrypt(jiraEncrypted)),
        );
        if (cfg) {
          jiraSummary = {
            baseUrl: cfg.baseUrl,
            email: cfg.email,
            projectKey: cfg.projectKey,
            issueType: cfg.issueType || 'Bug',
          };
        }
      } catch {
        jiraSummary = null;
      }
    }
    return {
      ...rest,
      memberships: canSeeMemberPii ? rest.memberships : [],
      role: membership.role,
      browserstackConfigured: Boolean(browserstackEncrypted),
      jiraConfigured: Boolean(jiraEncrypted),
      jira: jiraSummary,
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

  async saveJira(
    userId: string,
    orgId: string,
    body: unknown,
  ) {
    await this.requireMembership(userId, orgId, Role.ADMIN);
    await this.planUsage.assertFeature(orgId, 'jira', userId);
    if (!hasEncryptionKey()) {
      throw new BadRequestException('ENCRYPTION_KEY is not configured');
    }
    const input = parseBody(saveJiraSchema, body);
    const config = parseJiraConnectionConfig({
      baseUrl: input.baseUrl,
      email: input.email,
      apiToken: input.apiToken,
      projectKey: input.projectKey,
      issueType: input.issueType || 'Bug',
    });
    if (!config) {
      throw new BadRequestException('Jira connection fields are incomplete');
    }
    try {
      await verifyJiraConnection(config);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Jira connection failed',
      );
    }
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        jiraEncrypted: encrypt(
          JSON.stringify({
            baseUrl: config.baseUrl,
            email: config.email,
            apiToken: config.apiToken,
            projectKey: config.projectKey,
            issueType: config.issueType || 'Bug',
          }),
        ),
      },
    });
    await this.audit.log({
      organizationId: orgId,
      userId,
      action: 'org.jira.connect',
      resource: 'organization',
      resourceId: orgId,
      metadata: {
        baseUrl: config.baseUrl,
        projectKey: config.projectKey,
        email: config.email,
      },
    });
    return {
      ok: true,
      jiraConfigured: true,
      jira: {
        baseUrl: config.baseUrl,
        email: config.email,
        projectKey: config.projectKey,
        issueType: config.issueType || 'Bug',
      },
    };
  }

  async clearJira(userId: string, orgId: string) {
    await this.requireMembership(userId, orgId, Role.ADMIN);
    await prisma.organization.update({
      where: { id: orgId },
      data: { jiraEncrypted: null },
    });
    await this.audit.log({
      organizationId: orgId,
      userId,
      action: 'org.jira.disconnect',
      resource: 'organization',
      resourceId: orgId,
      metadata: {},
    });
    return { ok: true, jiraConfigured: false, jira: null };
  }

  async readJiraConfig(orgId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { jiraEncrypted: true },
    });
    if (!org?.jiraEncrypted || !hasEncryptionKey()) return null;
    try {
      return parseJiraConnectionConfig(JSON.parse(decrypt(org.jiraEncrypted)));
    } catch {
      return null;
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
    const existing = target
      ? await prisma.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: orgId,
              userId: target.id,
            },
          },
        })
      : null;
    // Same message whether the email has no account or is already a member —
    // avoids probing global signup existence.
    if (!target || existing) {
      throw new BadRequestException(
        'Unable to add that email. The user must already have an account and not be a member of this organization.',
      );
    }

    await this.planUsage.assertSeatLimit(orgId, actor.id);

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
