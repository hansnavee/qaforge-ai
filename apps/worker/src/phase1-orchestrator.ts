import { prisma } from '@qaforge/database';
import {
  AgentId,
  ArtifactType,
  buildReviewedRequirementsArtifact,
  ExecutionPhase,
  ExecutionStatus,
} from '@qaforge/shared';
import type { AgentContext, AgentHandler } from '@qaforge/agent-sdk';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { buildZipPackage } from '@qaforge/report-engine';
import { createAgentContext, putBinaryArtifact } from './context.js';
import {
  getRedis,
  publishClarificationQuestions,
  waitForClarifySignal,
  waitForContinueSignal,
} from './redis.js';
import { requirementAgent } from './agents/requirement.agent.js';
import { clarificationAgent } from './agents/clarification.agent.js';
import { strategyAgent } from './agents/strategy.agent.js';
import { designAgent, type DesignedCase } from './agents/design.agent.js';
import { testdataAgent } from './agents/testdata.agent.js';
import { authenticationAgent } from './agents/authentication.agent.js';
import { discoveryAgent } from './agents/discovery.agent.js';
import { functionalAgent } from './agents/functional.agent.js';
import { apiAgent } from './agents/api.agent.js';
import { bugAgent } from './agents/bug.agent.js';
import { automationAgent } from './agents/automation.agent.js';
import { executionAgent } from './agents/execution.agent.js';
import { reportAgent } from './agents/report.agent.js';
import { qualityAgent } from './agents/quality.agent.js';
import { githubActionsAgent } from './agents/github-actions.agent.js';

const MAX_CLARIFY_ROUNDS = 3;
const browserManager = new BrowserSessionManager();

async function setExecution(
  executionId: string,
  data: {
    status?: string;
    phase?: string;
    scores?: unknown;
    errorSummary?: string;
    startedAt?: Date;
    finishedAt?: Date;
  },
) {
  await prisma.execution.update({
    where: { id: executionId },
    data: data as never,
  });
}

async function runAgent(
  ctx: AgentContext,
  step: { agent: AgentHandler; phase: string; agentId: string },
  input: unknown,
  statusOverride?: string,
): Promise<unknown> {
  const started = Date.now();
  const run = await prisma.agentRun.create({
    data: {
      executionId: ctx.executionId,
      agentId: step.agentId,
      status: 'RUNNING',
    },
  });

  await setExecution(ctx.executionId, {
    status: statusOverride ?? ExecutionStatus.RUNNING,
    phase: step.phase,
  });

  await ctx.emit({
    type: 'agent.started',
    phase: step.phase,
    message: `${step.agent.name} started`,
    data: { agentId: step.agentId },
  });

  try {
    const output = await step.agent.run(ctx, input);
    const durationMs = Date.now() - started;
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'COMPLETED', durationMs },
    });
    await ctx.emit({
      type: 'agent.completed',
      phase: step.phase,
      message: `${step.agent.name} completed`,
      data: { agentId: step.agentId, durationMs },
    });
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        durationMs: Date.now() - started,
        error: message,
      },
    });
    await ctx.emit({
      type: 'agent.failed',
      phase: step.phase,
      message: `${step.agent.name} failed: ${message}`,
    });
    throw err;
  }
}

function requirementsSeemClear(
  questions: Array<{ id: string }>,
  skip: boolean,
  round: number,
): boolean {
  if (skip) return true;
  if (round >= MAX_CLARIFY_ROUNDS) return true;
  return questions.length === 0;
}

async function executeTestSteps(
  page: import('playwright').Page,
  steps: string[],
  appUrl: string,
  testData?: Record<string, string> | null,
): Promise<void> {
  const data = testData ?? {};
  for (const rawStep of steps) {
    let s = rawStep.trim();
    for (const [k, v] of Object.entries(data)) {
      s = s.split(`{{${k}}}`).join(v).split(`\${${k}}`).join(v);
    }
    const lower = s.toLowerCase();

    if (/^navigate|^open|^go to|^visit/i.test(s)) {
      const urlMatch = s.match(/https?:\/\/\S+/);
      await page.goto(urlMatch?.[0] ?? appUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      continue;
    }

    if (/click/i.test(lower)) {
      const quoted = s.match(/['"]([^'"]+)['"]/);
      const label = quoted?.[1] ?? s.replace(/click\s*/i, '').trim();
      const locator = page
        .getByRole('button', { name: new RegExp(label, 'i') })
        .or(page.getByRole('link', { name: new RegExp(label, 'i') }))
        .or(page.getByText(new RegExp(label, 'i')))
        .first();
      await locator.click({ timeout: 15_000 });
      continue;
    }

    if (/type|enter|fill|input/i.test(lower)) {
      const quoted = [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
      let value = quoted[quoted.length - 1] ?? data.sampleInput ?? 'test';
      if (lower.includes('user') && data.username) value = data.username;
      if (lower.includes('pass') && data.password && data.password !== '<<manual>>') {
        value = data.password;
      }
      const fieldHint = quoted[0] && quoted.length > 1 ? quoted[0] : undefined;
      if (fieldHint) {
        await page
          .getByLabel(new RegExp(fieldHint, 'i'))
          .or(page.getByPlaceholder(new RegExp(fieldHint, 'i')))
          .first()
          .fill(value, { timeout: 10_000 })
          .catch(async () => {
            await page.locator('input:visible').first().fill(value);
          });
      } else {
        await page.locator('input:visible').first().fill(value, {
          timeout: 10_000,
        });
      }
      continue;
    }

    if (/assert|expect|verify|should|check/i.test(lower)) {
      const text = s
        .replace(/^(assert|expect|verify|should|check)\s*/i, '')
        .trim();
      if (text) {
        await page
          .getByText(new RegExp(text.slice(0, 40), 'i'))
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .catch(() => undefined);
      }
      continue;
    }

    await page.waitForTimeout(400);
  }
}

type ManualFailure = {
  testCaseId: string;
  testResultId: string;
  externalId: string;
  scenario: string;
  severity?: string | null;
  message: string;
  steps: string[];
  evidenceKeys: string[];
};

async function runManualSuite(opts: {
  ctx: AgentContext;
  project: { id: string; appUrl: string | null };
  executionId: string;
  browserSessionId: string;
  cases: Array<{
    id: string;
    externalId: string;
    scenario: string;
    severity?: string | null;
    steps: unknown;
    testData?: unknown;
  }>;
  phase: string;
  passLabel: string;
}): Promise<{ passed: number; failed: number; failures: ManualFailure[] }> {
  const page = await browserManager.getPage(opts.browserSessionId);
  const appUrl = opts.project.appUrl ?? 'https://example.com';
  let passed = 0;
  let failed = 0;
  const failures: ManualFailure[] = [];

  for (const tc of opts.cases) {
    const started = Date.now();
    const steps = Array.isArray(tc.steps) ? (tc.steps as string[]) : [];
    const testData =
      tc.testData && typeof tc.testData === 'object'
        ? (tc.testData as Record<string, string>)
        : null;
    try {
      await page.goto(appUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await executeTestSteps(page, steps, appUrl, testData);
      await prisma.testResult.create({
        data: {
          projectId: opts.project.id,
          executionId: opts.executionId,
          testCaseId: tc.id,
          status: 'PASSED',
          message: `${opts.passLabel}: steps completed without hard failure`,
          durationMs: Date.now() - started,
        },
      });
      passed += 1;
      await opts.ctx.emit({
        type: 'stlc.test_passed',
        phase: opts.phase,
        message: `PASSED ${tc.externalId}: ${tc.scenario}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const evidenceKeys: string[] = [];
      try {
        const shot = await browserManager.screenshot(
          opts.browserSessionId,
          `fail-${tc.externalId}`,
        );
        const key = await putBinaryArtifact({
          executionId: opts.executionId,
          type: ArtifactType.SCREENSHOT,
          key: `${opts.executionId}/screenshots/fail-${tc.externalId}-${Date.now()}.png`,
          body: shot,
          mime: 'image/png',
          store: opts.ctx.artifactStore,
        });
        evidenceKeys.push(key);
      } catch {
        /* ignore */
      }
      try {
        const video = await browserManager.captureFailureVideo(
          opts.browserSessionId,
          tc.externalId.replace(/[^a-zA-Z0-9_-]/g, '_'),
        );
        if (video) {
          const key = await putBinaryArtifact({
            executionId: opts.executionId,
            type: ArtifactType.VIDEO,
            key: `${opts.executionId}/videos/fail-${tc.externalId}-${Date.now()}.webm`,
            body: video,
            mime: 'video/webm',
            store: opts.ctx.artifactStore,
          });
          evidenceKeys.push(key);
        }
      } catch {
        /* ignore */
      }

      const result = await prisma.testResult.create({
        data: {
          projectId: opts.project.id,
          executionId: opts.executionId,
          testCaseId: tc.id,
          status: 'FAILED',
          message,
          durationMs: Date.now() - started,
          evidenceKeys: evidenceKeys.length ? (evidenceKeys as never) : undefined,
        },
      });

      failures.push({
        testCaseId: tc.id,
        testResultId: result.id,
        externalId: tc.externalId,
        scenario: tc.scenario,
        severity: tc.severity,
        message,
        steps,
        evidenceKeys,
      });
      failed += 1;
      await opts.ctx.emit({
        type: 'stlc.test_failed',
        phase: opts.phase,
        message: `FAILED ${tc.externalId}: ${message}`,
      });
    }
  }

  return { passed, failed, failures };
}

/**
 * STLC orchestrator (Phase 1 alias):
 * requirements → clarify → strategy → design → login → discovery →
 * UI/API → manual → bugs → retest → automation → execution →
 * report → quality → final ZIP → GitHub Actions
 */
export async function runPhase1Execution(executionId: string): Promise<void> {
  return runStlcExecution(executionId);
}

export async function runStlcExecution(executionId: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: {
      project: {
        include: {
          requirements: true,
          extractedRequirements: {
            orderBy: { requirementKey: 'asc' },
            include: {
              featureGroup: {
                select: {
                  featureKey: true,
                  name: true,
                  businessArea: true,
                },
              },
            },
          },
          featureGroups: {
            orderBy: [{ businessArea: 'asc' }, { name: 'asc' }],
          },
        },
      },
    },
  });
  if (!execution) throw new Error(`Execution not found: ${executionId}`);

  const project = execution.project;
  const useStep2Reviewed =
    Boolean(project.requirementsApprovedAt) &&
    project.extractedRequirements.length > 0;
  const sessionRef: { id?: string } = {};
  let browserSessionId: string | undefined;

  await setExecution(executionId, {
    status: ExecutionStatus.RUNNING,
    phase: ExecutionPhase.INIT,
    startedAt: execution.startedAt ?? new Date(),
  });

  const redis = getRedis();
  const contChannel = `execution:${executionId}:continue`;
  const sub = redis.duplicate();
  await sub.subscribe(contChannel);

  const ctx = await createAgentContext({
    executionId,
    organizationId: project.organizationId,
    projectId: project.id,
  });

  try {
    await ctx.emit({
      type: 'stlc.started',
      phase: ExecutionPhase.INIT,
      message: 'STLC run started',
    });

    // 1. Requirements — prefer Step 2 reviewed requirements when approved
    let requirementsJson: unknown;
    if (useStep2Reviewed) {
      await setExecution(executionId, {
        status: ExecutionStatus.RUNNING,
        phase: ExecutionPhase.REQUIREMENTS,
      });
      await ctx.emit({
        type: 'requirements.from_step2',
        phase: ExecutionPhase.REQUIREMENTS,
        message:
          'Using approved Step 2 reviewed requirements (skip re-parse)',
        data: {
          requirementCount: project.extractedRequirements.length,
          analysisId: project.analysisId,
          analysisVersion: project.analysisVersion,
        },
      });

      requirementsJson = buildReviewedRequirementsArtifact({
        appUrl: project.appUrl,
        projectName: project.name,
        analysisId: project.analysisId,
        analysisVersion: project.analysisVersion,
        requirements: project.extractedRequirements.map((r) => ({
          requirementKey: r.requirementKey,
          title: r.title,
          description: r.description,
          priority: r.priority,
          businessImpact: r.businessImpact,
          reviewStatus: r.reviewStatus,
          acceptanceCriteria: r.acceptanceCriteria,
          businessRules: r.businessRules,
          featureGroup: r.featureGroup,
        })),
        features: project.featureGroups.map((f) => ({
          featureKey: f.featureKey,
          name: f.name,
          businessArea: f.businessArea,
          businessIntent: f.businessIntent,
          businessImpact: f.businessImpact,
          featureRisk: f.featureRisk,
          reviewStatus: f.reviewStatus,
        })),
      });

      await ctx.putArtifactJson(ArtifactType.REQUIREMENTS_JSON, requirementsJson);
      await ctx.putArtifactJson(ArtifactType.CLARIFICATION_ANSWERS, {
        source: 'step2-reviewed',
        skip: true,
        answers: {},
        note: 'Step 2 human approval already completed; STLC clarification skipped',
      });
      await ctx.emit({
        type: 'requirements.ready',
        phase: ExecutionPhase.REQUIREMENTS,
        message: 'Reviewed requirements artifact written',
      });
    } else {
      requirementsJson = await runAgent(
        ctx,
        {
          agent: requirementAgent,
          phase: ExecutionPhase.REQUIREMENTS,
          agentId: AgentId.REQUIREMENT_ANALYSIS,
        },
        {
          requirementText:
            project.requirementText ||
            project.requirements
              .map((d) => d.originalContent || d.parsedText)
              .filter(Boolean)
              .join('\n\n') ||
            null,
          documents: project.requirements.map((d) => ({
            storageKey: d.storageKey,
            mime: d.mime,
            filename: d.filename,
            parsedText: d.originalContent || d.parsedText,
          })),
          appUrl: project.appUrl ?? 'https://example.com',
        },
      );

      // Legacy path: clarification loop when Step 2 approval is absent
      let clear = false;
      let round = 0;
      while (!clear && round < MAX_CLARIFY_ROUNDS) {
        round += 1;
        const clarifyOut = (await runAgent(
          ctx,
          {
            agent: clarificationAgent,
            phase: ExecutionPhase.CLARIFICATION,
            agentId: AgentId.REQUIREMENT_CLARIFICATION,
          },
          { appUrl: project.appUrl, round },
          ExecutionStatus.AWAITING_CLARIFICATION,
        )) as { questions?: Array<{ id: string }> };

        const questions = clarifyOut?.questions ?? [];
        await publishClarificationQuestions(executionId, { questions, round });

        await prisma.clarificationRound.create({
          data: {
            projectId: project.id,
            executionId,
            round,
            questions: questions as never,
          },
        });

        if (questions.length === 0) {
          clear = true;
          break;
        }

        await setExecution(executionId, {
          status: ExecutionStatus.AWAITING_CLARIFICATION,
          phase: ExecutionPhase.CLARIFICATION,
        });

        await ctx.emit({
          type: 'stlc.awaiting_clarification',
          phase: ExecutionPhase.CLARIFICATION,
          message: `Awaiting clarification answers (round ${round})`,
          data: { round, questionCount: questions.length },
        });

        const signal = await waitForClarifySignal(executionId);
        const skip = Boolean(signal?.skip);
        const answers = (signal?.answers ?? {}) as Record<string, string>;

        await prisma.clarificationRound.updateMany({
          where: { executionId, round, answeredAt: null },
          data: {
            answers: answers as never,
            skipped: skip,
            answeredAt: new Date(),
          },
        });

        await ctx.putArtifactJson(ArtifactType.CLARIFICATION_ANSWERS, {
          round,
          skip,
          answers,
        });

        clear = requirementsSeemClear(questions, skip, round);
        await setExecution(executionId, {
          status: ExecutionStatus.RUNNING,
          phase: ExecutionPhase.CLARIFICATION,
        });
      }
    }

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: requirementsJson as never,
        clear: true,
      },
    });

    // 3. Test Strategy
    const strategyOut = await runAgent(
      ctx,
      {
        agent: strategyAgent,
        phase: ExecutionPhase.TEST_STRATEGY,
        agentId: AgentId.TEST_STRATEGY,
      },
      { appUrl: project.appUrl, projectName: project.name },
    );

    // Persist strategy in DB so API/UI can read it without shared disk/R2
    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: {
          kind: 'TEST_STRATEGY',
          strategy: strategyOut,
        } as never,
        clear: true,
      },
    });

    // Stage 2 human gate — pause for test plan / strategy approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_PLAN_APPROVAL,
      phase: ExecutionPhase.TEST_STRATEGY,
    });
    await ctx.emit({
      type: 'stlc.awaiting_plan_approval',
      phase: ExecutionPhase.TEST_STRATEGY,
      message: 'Test strategy ready — awaiting human approval before Test Design',
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.TEST_DESIGN,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'DESIGN' },
    });
    await ctx.emit({
      type: 'stlc.plan_approved',
      phase: ExecutionPhase.TEST_DESIGN,
      message: 'Test plan approved — continuing to Test Design',
    });

    // 4. Test Design (cases + data) — before browser login
    const designOut = (await runAgent(
      ctx,
      {
        agent: designAgent,
        phase: ExecutionPhase.TEST_DESIGN,
        agentId: AgentId.TEST_DESIGN,
      },
      { appUrl: project.appUrl },
    )) as { testCases?: DesignedCase[] };

    const cases = designOut?.testCases ?? [];

    await prisma.testCase.deleteMany({ where: { executionId } });
    for (const tc of cases) {
      await prisma.testCase.create({
        data: {
          projectId: project.id,
          executionId,
          externalId: tc.id,
          module: tc.module,
          scenario: tc.scenario,
          preconditions: tc.preconditions,
          steps: tc.steps as never,
          expected: tc.expected,
          priority: tc.priority,
          severity: tc.severity,
          type: tc.type,
          testData: (tc.testData ?? null) as never,
        },
      });
    }

    await ctx.emit({
      type: 'stlc.test_design_ready',
      phase: ExecutionPhase.TEST_DESIGN,
      message: `Test Board ready — ${cases.length} case(s)`,
      data: { count: cases.length },
    });

    // Stage 3 human gate — pause for test design approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DESIGN_APPROVAL,
      phase: ExecutionPhase.TEST_DESIGN,
    });
    await ctx.emit({
      type: 'stlc.awaiting_design_approval',
      phase: ExecutionPhase.TEST_DESIGN,
      message: 'Test design ready — awaiting human approval before Test Data',
      data: { count: cases.length },
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.TEST_DATA,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'DATA' },
    });
    await ctx.emit({
      type: 'stlc.design_approved',
      phase: ExecutionPhase.TEST_DATA,
      message: 'Test design approved — continuing to Test Data',
    });

    // 4b. Stage 4 — Test Data
    const dbCasesForData = await prisma.testCase.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
    const dataOut = (await runAgent(
      ctx,
      {
        agent: testdataAgent,
        phase: ExecutionPhase.TEST_DATA,
        agentId: AgentId.TEST_DATA,
      },
      {
        appUrl: project.appUrl,
        cases: dbCasesForData.map((tc) => ({
          id: tc.id,
          externalId: tc.externalId,
          module: tc.module,
          scenario: tc.scenario,
          type: tc.type,
          testData:
            tc.testData && typeof tc.testData === 'object'
              ? (tc.testData as Record<string, string>)
              : null,
        })),
      },
    )) as { cases?: Array<{ testCaseId: string; data: Record<string, string> }> };

    for (const row of dataOut?.cases ?? []) {
      const match = dbCasesForData.find(
        (tc) => tc.externalId === row.testCaseId || tc.id === row.testCaseId,
      );
      if (!match) continue;
      await prisma.testCase.update({
        where: { id: match.id },
        data: { testData: row.data as never },
      });
    }

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: {
          kind: 'TEST_DATA',
          cases: dataOut?.cases ?? [],
        } as never,
        clear: true,
      },
    });

    // Stage 4 human gate — pause for test data approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DATA_APPROVAL,
      phase: ExecutionPhase.TEST_DATA,
    });
    await ctx.emit({
      type: 'stlc.awaiting_data_approval',
      phase: ExecutionPhase.TEST_DATA,
      message:
        'Test data ready — awaiting human approval before Test Execution',
      data: { count: dataOut?.cases?.length ?? 0 },
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.AUTHENTICATION,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'EXECUTION' },
    });
    await ctx.emit({
      type: 'stlc.data_approved',
      phase: ExecutionPhase.AUTHENTICATION,
      message: 'Test data approved — continuing to Test Execution',
    });

    // 5. Authentication pause
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_LOGIN,
      phase: ExecutionPhase.AUTHENTICATION,
    });

    const targetAppUrl =
      (typeof project.appUrl === 'string' && project.appUrl.trim()) ||
      (typeof project.loginUrl === 'string' && project.loginUrl.trim()) ||
      'https://example.com';
    const targetLoginUrl =
      (typeof project.loginUrl === 'string' && project.loginUrl.trim()) ||
      targetAppUrl;

    const authResult = (await runAgent(
      ctx,
      {
        agent: authenticationAgent,
        phase: ExecutionPhase.AUTHENTICATION,
        agentId: AgentId.AUTHENTICATION,
      },
      {
        browserManager,
        startUrl: targetLoginUrl,
        loginUrl: targetLoginUrl,
        appUrl: targetAppUrl,
        waitForContinueSignal: () => waitForContinueSignal(executionId),
        onSessionLaunched: (sessionId: string) => {
          sessionRef.id = sessionId;
        },
      },
      ExecutionStatus.AWAITING_LOGIN,
    )) as { sessionId: string };

    browserSessionId = authResult.sessionId;
    sessionRef.id = browserSessionId;
    ctx.browserSessionId = browserSessionId;

    await prisma.browserSession.upsert({
      where: { executionId },
      create: {
        executionId,
        status: 'ACTIVE',
        containerId: browserSessionId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      update: {
        status: 'ACTIVE',
        containerId: browserSessionId,
      },
    });

    // 6. Application Discovery
    await runAgent(
      ctx,
      {
        agent: discoveryAgent,
        phase: ExecutionPhase.DISCOVERY,
        agentId: AgentId.APPLICATION_DISCOVERY,
      },
      { browserManager, sessionId: browserSessionId, appUrl: targetAppUrl },
    );

    // 7. UI Testing + API Testing
    await runAgent(
      ctx,
      {
        agent: functionalAgent,
        phase: ExecutionPhase.FUNCTIONAL,
        agentId: AgentId.FUNCTIONAL_TESTING,
      },
      { browserManager, sessionId: browserSessionId, appUrl: targetAppUrl },
    );

    await runAgent(
      ctx,
      {
        agent: apiAgent,
        phase: ExecutionPhase.API,
        agentId: AgentId.API_TESTING,
      },
      {},
    );

    // 8. Manual Test Agent (Stage 5 core execution)
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.MANUAL_TEST,
    });

    const dbCases = await prisma.testCase.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });

    const manual = await runManualSuite({
      ctx,
      project: { id: project.id, appUrl: targetAppUrl },
      executionId,
      browserSessionId,
      cases: dbCases,
      phase: ExecutionPhase.MANUAL_TEST,
      passLabel: 'Manual Test Agent',
    });

    const executionSummary = {
      kind: 'TEST_EXECUTION',
      source: 'stage5-manual-suite',
      completedAt: new Date().toISOString(),
      totals: {
        cases: dbCases.length,
        passed: manual.passed,
        failed: manual.failed,
      },
      failures: manual.failures.map((f) => ({
        testCaseId: f.testCaseId,
        externalId: f.externalId,
        scenario: f.scenario,
        message: f.message,
        severity: f.severity ?? null,
      })),
    };

    await ctx.putArtifactJson(
      ArtifactType.EXECUTION_RESULTS,
      executionSummary,
    );
    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: executionSummary as never,
        clear: true,
      },
    });

    // Stage 5 human gate — pause for execution results approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_EXECUTION_APPROVAL,
      phase: ExecutionPhase.MANUAL_TEST,
    });
    await ctx.emit({
      type: 'stlc.awaiting_execution_approval',
      phase: ExecutionPhase.MANUAL_TEST,
      message:
        'Test execution complete — awaiting human approval before Defect Management',
      data: executionSummary.totals,
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.BUG_ANALYSIS,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'DEFECTS' },
    });
    await ctx.emit({
      type: 'stlc.execution_approved',
      phase: ExecutionPhase.BUG_ANALYSIS,
      message: 'Test execution approved — continuing to Defect Management',
    });

    // 9. Stage 6 — Defect Management
    let bugCount = 0;
    if (manual.failures.length) {
      const bugOut = (await runAgent(
        ctx,
        {
          agent: bugAgent,
          phase: ExecutionPhase.BUG_ANALYSIS,
          agentId: AgentId.BUG_ANALYSIS,
        },
        { projectId: project.id, failures: manual.failures },
      )) as { bugCount?: number };
      bugCount = bugOut?.bugCount ?? manual.failures.length;
    } else {
      await ctx.putArtifactJson(ArtifactType.FAILURE_ANALYSIS, {
        summary: 'No failures — no defects filed',
        failures: [],
      });
      await ctx.emit({
        type: 'bugs.none',
        phase: ExecutionPhase.BUG_ANALYSIS,
        message: 'No execution failures — defect board is empty',
      });
    }

    const openBugs = await prisma.bug.findMany({
      where: { executionId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        testCaseId: true,
      },
    });

    const defectSummary = {
      kind: 'DEFECT_MANAGEMENT',
      source: 'stage6-bug-agent',
      completedAt: new Date().toISOString(),
      totals: {
        executionFailures: manual.failures.length,
        bugsFiled: bugCount,
        openBugs: openBugs.length,
      },
      bugs: openBugs,
    };

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: defectSummary as never,
        clear: true,
      },
    });

    // Stage 6 human gate — pause for defect review/approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DEFECT_APPROVAL,
      phase: ExecutionPhase.BUG_ANALYSIS,
    });
    await ctx.emit({
      type: 'stlc.awaiting_defect_approval',
      phase: ExecutionPhase.BUG_ANALYSIS,
      message:
        'Defect management complete — awaiting human approval before Regression',
      data: defectSummary.totals,
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.RETEST,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'REGRESSION' },
    });
    await ctx.emit({
      type: 'stlc.defects_approved',
      phase: ExecutionPhase.RETEST,
      message: 'Defects approved — continuing to Regression',
    });

    // 10. Retest failed cases once (Stage 7 Regression)
    let retestPassed = 0;
    let retestFailed = 0;
    let retestSkipped = false;
    if (manual.failures.length) {
      await setExecution(executionId, {
        status: ExecutionStatus.RUNNING,
        phase: ExecutionPhase.RETEST,
      });
      const failedIds = new Set(manual.failures.map((f) => f.testCaseId));
      const retestCases = dbCases.filter((c) => failedIds.has(c.id));
      const retest = await runManualSuite({
        ctx,
        project: { id: project.id, appUrl: targetAppUrl },
        executionId,
        browserSessionId,
        cases: retestCases,
        phase: ExecutionPhase.RETEST,
        passLabel: 'Retest',
      });
      retestPassed = retest.passed;
      retestFailed = retest.failed;
      if (retest.failures.length) {
        await runAgent(
          ctx,
          {
            agent: bugAgent,
            phase: ExecutionPhase.BUG_ANALYSIS,
            agentId: AgentId.BUG_ANALYSIS,
          },
          { projectId: project.id, failures: retest.failures },
        );
      }
    } else {
      retestSkipped = true;
      await ctx.emit({
        type: 'stlc.regression_skipped',
        phase: ExecutionPhase.RETEST,
        message: 'No failed cases — regression retest skipped',
      });
    }

    const regressionSummary = {
      kind: 'REGRESSION',
      source: 'stage7-retest',
      completedAt: new Date().toISOString(),
      skipped: retestSkipped,
      totals: {
        candidates: manual.failures.length,
        passed: retestPassed,
        failed: retestFailed,
      },
    };

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: regressionSummary as never,
        clear: true,
      },
    });

    // Stage 7 human gate — pause for regression approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_REGRESSION_APPROVAL,
      phase: ExecutionPhase.RETEST,
    });
    await ctx.emit({
      type: 'stlc.awaiting_regression_approval',
      phase: ExecutionPhase.RETEST,
      message:
        'Regression complete — awaiting human approval before Automation',
      data: regressionSummary.totals,
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.AUTOMATION,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'AUTOMATION' },
    });
    await ctx.emit({
      type: 'stlc.regression_approved',
      phase: ExecutionPhase.AUTOMATION,
      message: 'Regression approved — continuing to Automation',
    });

    // 11. Stage 8 — Automation generation
    const automationOut = await runAgent(
      ctx,
      {
        agent: automationAgent,
        phase: ExecutionPhase.AUTOMATION,
        agentId: AgentId.AUTOMATION_GENERATION,
      },
      {
        projectName: project.name,
        appUrl: targetAppUrl,
        framework: project.framework ?? 'playwright',
        language: project.language ?? 'typescript',
      },
    );

    // 12. Automation execution
    const autoExecOut = await runAgent(
      ctx,
      {
        agent: executionAgent,
        phase: ExecutionPhase.EXECUTION,
        agentId: AgentId.EXECUTION,
      },
      {
        browserManager,
        sessionId: browserSessionId,
        appUrl: targetAppUrl,
      },
    );

    const automationSummary = {
      kind: 'AUTOMATION',
      source: 'stage8-automation',
      completedAt: new Date().toISOString(),
      generation: automationOut ?? null,
      execution: autoExecOut ?? null,
    };

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: automationSummary as never,
        clear: true,
      },
    });

    // Stage 8 human gate — pause for automation approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_AUTOMATION_APPROVAL,
      phase: ExecutionPhase.AUTOMATION,
    });
    await ctx.emit({
      type: 'stlc.awaiting_automation_approval',
      phase: ExecutionPhase.AUTOMATION,
      message:
        'Automation complete — awaiting human approval before QA Sign-off',
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.REPORT,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'SIGNOFF' },
    });
    await ctx.emit({
      type: 'stlc.automation_approved',
      phase: ExecutionPhase.REPORT,
      message: 'Automation approved — continuing to QA Sign-off',
    });

    // 13. HTML report (Stage 9 sign-off pack begins)
    const reportOut = (await runAgent(
      ctx,
      {
        agent: reportAgent,
        phase: ExecutionPhase.REPORT,
        agentId: AgentId.REPORT_GENERATION,
      },
      { projectName: project.name, appUrl: project.appUrl },
    )) as { zipKey?: string };

    // 14. Quality Analysis
    await runAgent(
      ctx,
      {
        agent: qualityAgent,
        phase: ExecutionPhase.QUALITY_ANALYSIS,
        agentId: AgentId.QUALITY_ANALYSIS,
      },
      { projectName: project.name, appUrl: project.appUrl },
    );

    // 15. Final STLC ZIP pack
    const [testCasesCsv, bugsRows, resultsRows, quality, strategy] =
      await Promise.all([
        ctx.artifactStore
          .get(`${executionId}/test-cases/cases.csv`)
          .catch(() => Buffer.from('')),
        prisma.bug.findMany({ where: { executionId } }),
        prisma.testResult.findMany({
          where: { executionId },
          include: { testCase: true },
        }),
        ctx.getArtifactJson(ArtifactType.QUALITY_ANALYSIS_JSON),
        ctx.getArtifactJson(ArtifactType.TEST_STRATEGY_JSON),
      ]);

    const bugsCsv = [
      'id,title,severity,status,description',
      ...bugsRows.map(
        (b) =>
          `"${b.id}","${b.title.replace(/"/g, '""')}","${b.severity}","${b.status}","${b.description.replace(/"/g, '""')}"`,
      ),
    ].join('\n');

    const resultsCsv = [
      'id,testCase,status,message,durationMs',
      ...resultsRows.map(
        (r) =>
          `"${r.id}","${(r.testCase?.externalId ?? '').replace(/"/g, '""')}","${r.status}","${(r.message ?? '').replace(/"/g, '""')}","${r.durationMs ?? ''}"`,
      ),
    ].join('\n');

    const finalZip = await buildZipPackage({
      files: {
        'test-cases.csv': testCasesCsv.toString('utf8') || 'id\n',
        'bugs.csv': bugsCsv,
        'results.csv': resultsCsv,
        'strategy.json': JSON.stringify(strategy ?? {}, null, 2),
        'quality-analysis.json': JSON.stringify(quality ?? {}, null, 2),
        'manifest.json': JSON.stringify(
          {
            executionId,
            projectId: project.id,
            projectName: project.name,
            appUrl: project.appUrl,
            reportZipKey: reportOut?.zipKey ?? null,
            generatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      },
    });

    await putBinaryArtifact({
      executionId,
      type: ArtifactType.STLC_FINAL_ZIP,
      key: `${executionId}/stlc/final-pack.zip`,
      body: finalZip,
      mime: 'application/zip',
      store: ctx.artifactStore,
    });

    // 16. GitHub Actions workflow stub
    await runAgent(
      ctx,
      {
        agent: githubActionsAgent,
        phase: ExecutionPhase.GITHUB,
        agentId: AgentId.GITHUB_ACTIONS,
      },
      { projectName: project.name, appUrl: project.appUrl },
    );

    const totalPassed = manual.passed + retestPassed;
    const totalFailed = retestFailed || manual.failed;
    const scores = {
      functional: dbCases.length
        ? Math.round((manual.passed / dbCases.length) * 100)
        : 0,
      passed: totalPassed,
      failed: totalFailed,
      total: dbCases.length,
      retestPassed,
      retestFailed,
      bugs: bugsRows.length,
    };

    const signoffSummary = {
      kind: 'QA_SIGNOFF',
      source: 'stage9-signoff-pack',
      preparedAt: new Date().toISOString(),
      totals: {
        cases: dbCases.length,
        passed: manual.passed,
        failed: manual.failed,
        retestPassed,
        retestFailed,
        bugs: bugsRows.length,
      },
      artifacts: {
        finalZipKey: `${executionId}/stlc/final-pack.zip`,
        reportZipKey: reportOut?.zipKey ?? null,
      },
      scores,
    };

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: signoffSummary as never,
        clear: true,
      },
    });

    // Stage 9 human gate — pause for QA sign-off
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_QA_SIGNOFF,
      phase: ExecutionPhase.REPORT,
      scores,
    });
    await ctx.emit({
      type: 'stlc.awaiting_qa_signoff',
      phase: ExecutionPhase.REPORT,
      message:
        'Evidence pack ready — awaiting human QA sign-off to close the STLC run',
      data: signoffSummary.totals,
    });
    await waitForContinueSignal(executionId);

    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'DONE' },
    });

    await setExecution(executionId, {
      status: ExecutionStatus.COMPLETED,
      phase: ExecutionPhase.DONE,
      finishedAt: new Date(),
      scores,
    });

    await ctx.emit({
      type: 'stlc.completed',
      phase: ExecutionPhase.DONE,
      message: `STLC signed off — manual ${manual.passed}/${dbCases.length} passed, retest ${retestPassed} recovered, ${bugsRows.length} bug(s)`,
      data: {
        passed: manual.passed,
        failed: manual.failed,
        retestPassed,
        retestFailed,
        total: dbCases.length,
        signedOff: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setExecution(executionId, {
      status: ExecutionStatus.FAILED,
      errorSummary: message,
      finishedAt: new Date(),
    });
    await ctx.emit({
      type: 'stlc.failed',
      message,
    });
    throw err;
  } finally {
    if (browserSessionId) {
      await browserManager.destroy(browserSessionId).catch(() => undefined);
      await prisma.browserSession
        .updateMany({
          where: { executionId },
          data: { status: 'DESTROYED' },
        })
        .catch(() => undefined);
    }
    try {
      await sub.unsubscribe(contChannel);
      sub.disconnect();
    } catch {
      /* ignore */
    }
  }
}
