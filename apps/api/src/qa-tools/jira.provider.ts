import { prisma } from '@qaforge/database';
import {
  QA_TOOL_PROVIDER,
  browseJiraProjectIssues,
  createJiraIssue,
  expandJiraEpic,
  fetchJiraIssuesByKeys,
  parseJiraConnectionConfig,
  searchJiraIssuesByPrompt,
  type JiraConnectionConfig,
  type JiraTicketCandidate,
  type JiraTicketSelectionMode,
  type QaDefect,
  type QaDefectInput,
  type QaRequirement,
  type QaToolContext,
  type QaToolProvider,
} from '@qaforge/shared';

/**
 * Jira as an external tool provider (requirements in + defects out).
 * TCMS remains canonical memory.
 */
export function createJiraProvider(
  config: JiraConnectionConfig,
): QaToolProvider {
  return {
    id: QA_TOOL_PROVIDER.JIRA,
    requirement: {
      async list(_ctx: QaToolContext): Promise<QaRequirement[]> {
        const rows = await browseJiraProjectIssues(config, 50);
        return rows
          .filter((r) => r.selectable)
          .map((r) => ({
            id: r.id,
            key: r.key,
            title: r.summary,
            description: r.description,
          }));
      },
    },
    testcase: {
      async list() {
        return [];
      },
      async upsert() {
        throw new Error('Jira provider does not persist test cases');
      },
    },
    defect: {
      async create(
        _ctx: QaToolContext,
        input: QaDefectInput,
      ): Promise<QaDefect> {
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

export async function listJiraTicketCandidates(
  config: JiraConnectionConfig,
  opts: {
    mode: JiraTicketSelectionMode;
    prompt?: string;
    keys?: string[];
    epicKey?: string;
  },
): Promise<JiraTicketCandidate[]> {
  switch (opts.mode) {
    case 'PROMPT':
      return searchJiraIssuesByPrompt(config, opts.prompt ?? '', 50);
    case 'KEYS':
      return fetchJiraIssuesByKeys(config, opts.keys ?? []);
    case 'EPIC':
      return expandJiraEpic(config, opts.epicKey ?? '');
    case 'BROWSE':
    default:
      return browseJiraProjectIssues(config, 50);
  }
}

export type OrgJiraConfig = JiraConnectionConfig;

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

export async function dualWriteDefectExternalRef(opts: {
  bugId: string;
  orgId: string;
  projectId: string;
  title: string;
  description?: string;
  severity?: string;
  stepsToReproduce?: string;
  decryptFn: (payload: string) => string;
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
