import { prisma } from '@qaforge/database';
import {
  createJiraIssue,
  getPlanLimits,
  parseJiraConnectionConfig,
} from '@qaforge/shared';
import { decrypt, hasEncryptionKey } from './crypto.js';

/**
 * After a TCMS bug is saved, optionally dual-write to Jira when the org
 * has Enterprise jira feature + encrypted connection.
 */
export async function syncBugToJira(opts: {
  organizationId: string;
  bugId: string;
  title: string;
  description?: string;
  severity?: string;
  stepsToReproduce?: string;
}): Promise<{ externalRef: string | null; skipped?: string; error?: string }> {
  if (!hasEncryptionKey()) {
    return { externalRef: null, skipped: 'ENCRYPTION_KEY missing' };
  }

  const [org, sub] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: opts.organizationId },
      select: { jiraEncrypted: true },
    }),
    prisma.subscription.findUnique({
      where: { organizationId: opts.organizationId },
      select: { plan: true },
    }),
  ]);

  const limits = getPlanLimits(sub?.plan);
  if (!limits.features.jira) {
    return { externalRef: null, skipped: 'plan lacks jira feature' };
  }
  if (!org?.jiraEncrypted) {
    return { externalRef: null, skipped: 'jira not configured' };
  }

  let config;
  try {
    config = parseJiraConnectionConfig(JSON.parse(decrypt(org.jiraEncrypted)));
  } catch {
    return { externalRef: null, error: 'jira config decrypt failed' };
  }
  if (!config) {
    return { externalRef: null, error: 'jira config incomplete' };
  }

  try {
    const issue = await createJiraIssue(config, {
      title: opts.title,
      description: opts.description,
      severity: opts.severity,
      stepsToReproduce: opts.stepsToReproduce,
    });
    await prisma.bug.update({
      where: { id: opts.bugId },
      data: { externalRef: issue.url },
    });
    return { externalRef: issue.url };
  } catch (err) {
    return {
      externalRef: null,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err),
    };
  }
}
