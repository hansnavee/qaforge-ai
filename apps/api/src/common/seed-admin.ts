import { Logger } from '@nestjs/common';
import { prisma } from '@qaforge/database';
import { Role } from '@qaforge/shared';
import { auth } from '../auth/auth';

const logger = new Logger('SeedAdmin');

/**
 * Creates a default admin user + org when SEED_ADMIN=true (or credentials set).
 * Safe to run repeatedly — skips if the email already exists.
 */
export async function seedDefaultAdmin(): Promise<void> {
  const enabled =
    process.env.SEED_ADMIN === 'true' ||
    Boolean(process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD);
  if (!enabled) return;

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@qaforge.ai').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@QAForge123';
  const name = process.env.SEED_ADMIN_NAME || 'QAForge Admin';
  const orgName = process.env.SEED_ADMIN_ORG || 'QAForge Demo';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    logger.log(`Default admin already exists: ${email}`);
    return;
  }

  try {
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    });
    const userId = result.user?.id;
    if (!userId) {
      logger.warn('signUpEmail returned no user id');
      return;
    }

    const slug = 'qaforge-demo';
    await prisma.$transaction(async (tx) => {
      const org = await tx.organization.upsert({
        where: { slug },
        create: { name: orgName, slug },
        update: {},
      });
      await tx.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId,
          },
        },
        create: {
          organizationId: org.id,
          userId,
          role: Role.OWNER,
        },
        update: { role: Role.OWNER },
      });
      await tx.subscription.upsert({
        where: { organizationId: org.id },
        create: {
          organizationId: org.id,
          plan: 'FREE',
          status: 'active',
        },
        update: {},
      });
    });

    logger.log(`Seeded default admin ${email} (OWNER of ${orgName})`);
  } catch (err) {
    logger.error(`Failed to seed default admin: ${(err as Error).message}`);
  }
}
