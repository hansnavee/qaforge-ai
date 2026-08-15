import { prisma } from '@qaforge/database';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import {
  SENIOR_QA_GENERATE_SYSTEM,
  assembleGeneratedCases,
  buildLlmGeneratePrompt,
  expandJiraEpic,
  fetchJiraIssuesByKeys,
  listTestrailLibraryCases,
  listXrayLibraryCases,
  orchestrateSuggestions,
  parseJiraConnectionConfig,
  parseJsonFromLlm,
  resolveGenerateTechniques,
  type LibraryCase,
  type StoredRequirementForLlm,
} from '@qaforge/shared';
import { decrypt, hasEncryptionKey } from './crypto.js';

function parseBlob(raw: string | null | undefined): unknown {
  if (!raw || !hasEncryptionKey()) return null;
  try {
    return JSON.parse(decrypt(raw));
  } catch {
    return null;
  }
}

export async function processAiGenerateRun(runId: string): Promise<void> {
  const claimed = await prisma.aiGenerateRun.updateMany({
    where: { id: runId, status: 'PENDING' },
    data: { status: 'RUNNING', error: null },
  });
  if (!claimed.count) {
    const existing = await prisma.aiGenerateRun.findUnique({
      where: { id: runId },
    });
    if (!existing || existing.status !== 'RUNNING') return;
  }

  const run = await prisma.aiGenerateRun.findUnique({ where: { id: runId } });
  if (!run) return;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: run.organizationId },
      select: {
        jiraEncrypted: true,
        xrayEncrypted: true,
        testrailEncrypted: true,
      },
    });
    const project = await prisma.project.findUnique({
      where: { id: run.projectId },
      select: { name: true, appUrl: true, loginUrl: true },
    });
    const jiraKeys = Array.isArray(run.jiraKeys)
      ? (run.jiraKeys as unknown[]).map(String).filter(Boolean)
      : [];
    const stored: StoredRequirementForLlm[] = [];
    const jiraCfg = parseJiraConnectionConfig(parseBlob(org?.jiraEncrypted));
    if (jiraCfg && jiraKeys.length) {
      const seen = new Set<string>();
      for (const key of jiraKeys) {
        const tickets = await expandJiraEpic(jiraCfg, key).catch(() =>
          fetchJiraIssuesByKeys(jiraCfg, [key]),
        );
        for (const t of tickets) {
          if (t.isBug || seen.has(t.key)) continue;
          seen.add(t.key);
          stored.push({
            requirementKey: t.key,
            title: t.summary,
            description: t.description || t.summary,
          });
        }
      }
    }

    const existing: LibraryCase[] = [];
    if (run.includeTcms) {
      const rows = await prisma.testCase.findMany({
        where: { projectId: run.projectId, deletedAt: null },
        take: 400,
        select: {
          id: true,
          scenario: true,
          module: true,
          designTechnique: true,
          requirementKey: true,
          steps: true,
          expected: true,
        },
      });
      existing.push(
        ...rows.map((r) => ({
          id: r.id,
          scenario: r.scenario,
          module: r.module,
          designTechnique: r.designTechnique,
          requirementKey: r.requirementKey,
          steps: Array.isArray(r.steps) ? r.steps.map(String) : [],
          expected: r.expected,
          source: 'tcms' as const,
        })),
      );
    }
    if (run.includeXray) {
      const xray = parseBlob(org?.xrayEncrypted) as {
        clientId?: string;
        clientSecret?: string;
      } | null;
      if (xray?.clientId && xray.clientSecret) {
        existing.push(
          ...(await listXrayLibraryCases({
            clientId: xray.clientId,
            clientSecret: xray.clientSecret,
          })),
        );
      }
    }
    if (run.includeTestrail) {
      const tr = parseBlob(org?.testrailEncrypted) as {
        baseUrl?: string;
        email?: string;
        apiKey?: string;
        projectId?: string;
      } | null;
      if (tr?.baseUrl && tr.email && tr.apiKey && tr.projectId) {
        existing.push(
          ...(await listTestrailLibraryCases({
            baseUrl: tr.baseUrl,
            email: tr.email,
            apiKey: tr.apiKey,
            projectId: tr.projectId,
          })),
        );
      }
    }

    const sourceText =
      (run.prompt ?? '').trim() ||
      stored.map((r) => `${r.requirementKey}: ${r.title}\n${r.description}`).join('\n\n') ||
      'Generate tests from connected sources.';
    const techniques = resolveGenerateTechniques(sourceText, null);
    const llm = new OpenRouterLlmClient();
    const prompt = buildLlmGeneratePrompt({
      userPrompt: sourceText,
      projectName: project?.name,
      appUrl: project?.appUrl,
      loginUrl: project?.loginUrl,
      storedRequirements: stored.slice(0, 20),
      techniques,
    });
    let llmCases: unknown[] = [];
    try {
      const result = await llm.complete({
        system: SENIOR_QA_GENERATE_SYSTEM,
        prompt,
        json: true,
        model: 'fast',
        maxTokens: 3500,
        temperature: 0.2,
        timeoutMs: 20_000,
        maxAttempts: 2,
      });
      const parsed = parseJsonFromLlm(result.text) as { cases?: unknown[] };
      llmCases = Array.isArray(parsed?.cases) ? parsed.cases : [];
    } catch {
      llmCases = [];
    }
    const assembled = assembleGeneratedCases({
      sourceText,
      llmCases: { cases: llmCases },
      techniques,
      appUrl: project?.appUrl,
      fillMissing: true,
    });
    const suggestions = orchestrateSuggestions({
      cases: assembled.cases,
      existing,
    });
    await prisma.aiGenerateSuggestion.deleteMany({ where: { runId } });
    await prisma.aiGenerateSuggestion.createMany({
      data: suggestions.map((s) => ({
        runId,
        scenario: s.scenario,
        preconditions: s.preconditions,
        steps: s.steps as never,
        expected: s.expected,
        type: s.type,
        designTechnique: s.designTechnique,
        requirementKey: s.requirementKey,
        priorityLabel: s.priorityLabel,
        module: s.module,
        testData: s.testData as never,
        kind: s.kind,
        score: s.score,
        reason: s.reason,
        status: s.kind === 'duplicate' ? 'rejected' : 'pending',
        embedding: s.embedding as never,
        matchCaseId: s.matchCaseId,
        externalRef: s.externalRef,
      })),
    });
    await prisma.aiGenerateRun.update({
      where: { id: runId },
      data: { status: 'READY', error: null },
    });
  } catch (err) {
    await prisma.aiGenerateRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        error: err instanceof Error ? err.message.slice(0, 800) : 'Generate failed',
      },
    });
  }
}
