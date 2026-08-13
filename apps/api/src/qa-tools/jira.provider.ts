import { prisma } from '@qaforge/database';
import {
  QA_TOOL_PROVIDER,
  createJiraIssue,
  parseJiraConnectionConfig,
  type JiraConnectionConfig,
  type QaDefect,
  type QaDefectInput,
  type QaToolContext,
  type QaToolProvider,
} from '@qaforge/shared';

/**
 * Jira as an external defect sink (Agent → tools → Jira).
 * Does not own TCMS memory — dual-write callers create TCMS first, then this.
 */
export function createJiraProvider(
  config: JiraConnectionConfig,
): QaToolProvider {
  return {
    id: QA_TOOL_PROVIDER.JIRA,
    testcase: {
      async list() {
        return [];
      },
      async upsert() {
        throw new Error('Jira provider does not persist test cases');
      },
    },
    defect: {
      async create(_ctx: QaToolContext, input: QaDefectInput): Promise<QaDefect> {
        const issue = await createJiraIssue(config, {
          title: input.title,
          description: input.description,
          severity: input.severity,
        });
        return {
          id: issue.id,
          title: input.title,
          description: input.description,
          severity: input.severity,
          testCaseId: input.testCaseId,
          executionId: input.executionId,
          externalRef: issue.url,
        };
      },
    },
  };
}

export type OrgJiraConfig = JiraConnectionConfig;

/** Decrypt org Jira config when present. Caller supplies decrypt fn. */
export function jiraConfigFromEncrypted(
  encrypted: string | null | undefined,
  decryptFn: (payload: string) => string,
): JiraConnectionConfig | null {
  if (!encrypted) return null;
  try {
    const parsed = JSON.parse(decryptFn(encrypted)) as unknown;
    return parseJiraConnectionConfig(parsed);
  } catch {
    return null;
  }
}

/**
 * Dual-write: TCMS bug is canonical; optional Jira issue when configured.
 * Updates Bug.externalRef with the Jira browse URL on success.
 * Jira failures are returned as warnings — TCMS write is never rolled back.
 */
export async function dualWriteDefectExternalRef(opts: {
  bugId: string;
  orgId: string;
  projectId: string;
  title: string;
  description?: string;
  severity?: string;
  stepsToReproduce?: string;
  decryptFn: (payload: string) => string;
  /** When false, skip Jira even if configured (Suggest / no plan). */
  syncJira: boolean;
}): Promise<{ externalRef: string | null; jiraError?: string }> {
  if (!opts.syncJira) return { externalRef: null };

  const org = await prisma.organization.findUnique({
    where: { id: opts.orgId },
    select: { jiraEncrypted: true },
  });
  const config = jiraConfigFromEncrypted(org?.jiraEncrypted, opts.decryptFn);
  if (!config) return { externalRef: null };

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
    const msg = err instanceof Error ? err.message : String(err);
    return { externalRef: null, jiraError: msg.slice(0, 240) };
  }
}
