import { prisma } from '@qaforge/database';
import {
  AgentId,
  ArtifactType,
  buildReviewedRequirementsArtifact,
  buildTechniqueCoverage,
  ExecutionPhase,
  ExecutionStatus,
  isUsableAppUrl,
  normalizeBrowserMode,
  normalizePriorityLabel,
  parseRequirementsFromArtifact,
  sortCasesByPriority,
  suggestExecutionSelection,
} from '@qaforge/shared';
import type { AgentContext, AgentHandler } from '@qaforge/agent-sdk';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { buildZipPackage } from '@qaforge/report-engine';
import { createAgentContext, putBinaryArtifact } from './context.js';
import { AwaitingHumanError } from './awaiting-human.js';
import {
  ExecutionCancelledError,
  getRedis,
  publishClarificationQuestions,
  waitForContinueSignal,
} from './redis.js';
import { requirementAgent } from './agents/requirement.agent.js';
import { clarificationAgent } from './agents/clarification.agent.js';
import { strategyAgent } from './agents/strategy.agent.js';
import { designAgent, type DesignedCase } from './agents/design.agent.js';
import { testdataAgent } from './agents/testdata.agent.js';
import { environmentAgent } from './agents/environment.agent.js';
import { authenticationAgent } from './agents/authentication.agent.js';
import { discoveryAgent } from './agents/discovery.agent.js';
import { groundExecutionCases } from './ground-cases-job.js';
import { functionalAgent } from './agents/functional.agent.js';
import { apiAgent } from './agents/api.agent.js';
import { bugAgent } from './agents/bug.agent.js';
import { automationAgent } from './agents/automation.agent.js';
import { executionAgent } from './agents/execution.agent.js';
import { reportAgent } from './agents/report.agent.js';
import { qualityAgent } from './agents/quality.agent.js';
import { githubActionsAgent } from './agents/github-actions.agent.js';
import { signoffAgent } from './agents/signoff.agent.js';
import { persistPhaseDocument } from './stlc-phase-docs.js';
import { executeTestSteps } from './execute-test-steps.js';

export { executeTestSteps };

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
    if (ctx.tokensUsed) ctx.tokensUsed.total = 0;
    const output = await step.agent.run(ctx, input);
    const durationMs = Date.now() - started;
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        durationMs,
        tokensUsed: ctx.tokensUsed?.total ?? 0,
      },
    });
    await ctx.emit({
      type: 'agent.completed',
      phase: step.phase,
      message: `${step.agent.name} completed`,
      data: {
        agentId: step.agentId,
        durationMs,
        tokensUsed: ctx.tokensUsed?.total ?? 0,
      },
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
        tokensUsed: ctx.tokensUsed?.total ?? 0,
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
  const appUrl = opts.project.appUrl;
  if (!appUrl) {
    throw new Error(
      'Application URL is required before execution — set it on the Environment step.',
    );
  }
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

    const loadGates = () =>
      prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        select: {
          testDesignApprovedAt: true,
          environmentApprovedAt: true,
          testDataApprovedAt: true,
        },
      });

    let gates = await loadGates();

    // 1–4. Requirements → strategy → design (async pause; skip on resume)
    if (!gates.testDesignApprovedAt) {
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
          appUrl: project.appUrl ?? '',
        },
      );

      // Legacy path: clarification loop when Step 2 approval is absent
      let clear = false;
      let round = 0;
      while (!clear && round < MAX_CLARIFY_ROUNDS) {
        round += 1;
        const priorRound = await prisma.clarificationRound.findFirst({
          where: { executionId, round },
          orderBy: { createdAt: 'desc' },
        });
        if (priorRound?.answeredAt) {
          const priorQuestions =
            (priorRound.questions as Array<{ id: string }>) ?? [];
          const skip = Boolean(priorRound.skipped);
          const answers = (priorRound.answers ?? {}) as Record<string, string>;
          await ctx.putArtifactJson(ArtifactType.CLARIFICATION_ANSWERS, {
            round,
            skip,
            answers,
          });
          clear = requirementsSeemClear(priorQuestions, skip, round);
          continue;
        }
        if (priorRound && !priorRound.answeredAt) {
          await setExecution(executionId, {
            status: ExecutionStatus.AWAITING_CLARIFICATION,
            phase: ExecutionPhase.CLARIFICATION,
          });
          throw new AwaitingHumanError(ExecutionStatus.AWAITING_CLARIFICATION);
        }

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
        throw new AwaitingHumanError(ExecutionStatus.AWAITING_CLARIFICATION);
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

    // 3. Test Strategy (+ design continues without a separate plan gate)
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.TEST_STRATEGY,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'PLANNING' },
    });
    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'PLANNING',
      status: 'RUNNING',
      document: { kind: 'TEST_STRATEGY', status: 'generating' },
      validation: {
        passed: false,
        blockers: [],
        summary: 'Generating test strategy…',
      },
    });
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

    const planningValidation = {
      passed: Boolean(strategyOut),
      blockers: strategyOut ? [] : ['Strategy document missing'],
      summary: strategyOut
        ? 'Test strategy package ready for Senior QA human review'
        : 'Strategy generation failed',
    };
    // Strategy is documented and auto-accepted; human review happens on Design
    // (Start Planning generates strategy + cases in one AI pass).
    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'PLANNING',
      status: 'ACCEPTED',
      document: {
        kind: 'TEST_STRATEGY',
        strategy: strategyOut,
        testingLevels: [
          'SMOKE',
          'SANITY',
          'FUNCTIONAL',
          'INTEGRATION',
          'REGRESSION',
          'UAT_READY',
        ],
      },
      validation: planningValidation,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: {
        stlcStage: 'DESIGN',
        testPlanApprovedAt: new Date(),
      },
    });
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.TEST_DESIGN,
    });
    await ctx.emit({
      type: 'stlc.plan_ready',
      phase: ExecutionPhase.TEST_DESIGN,
      message:
        'Test strategy documented — designing test cases next (review on Design)',
    });

    // 4. Test Design (cases + data) — before browser login
    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'DESIGN',
      status: 'RUNNING',
      document: { kind: 'TEST_DESIGN', status: 'generating', testCases: [] },
      validation: {
        passed: false,
        blockers: [],
        summary: 'Designing documented test cases…',
      },
    });
    const designOut = (await runAgent(
      ctx,
      {
        agent: designAgent,
        phase: ExecutionPhase.TEST_DESIGN,
        agentId: AgentId.TEST_DESIGN,
      },
      { appUrl: project.appUrl ?? '' },
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
          requirementKey: tc.requirementKey ?? null,
          designTechnique: tc.designTechnique
            ? String(tc.designTechnique)
            : null,
          featureKey: tc.featureKey ?? null,
          designMode:
            tc.designMode === 'UI_GROUNDED' ? 'UI_GROUNDED' : 'GENERIC',
          priorityLabel:
            tc.priorityLabel ?? normalizePriorityLabel(tc.priority),
          readyForExecution: Boolean(tc.readyForExecution),
          caseStatus: tc.readyForExecution ? 'READY' : 'DRAFT',
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

    const crudOps = ['CREATE', 'READ', 'UPDATE', 'DELETE'] as const;
    const crudMatrix = Array.from(
      new Set(cases.map((c) => c.module || 'General')),
    ).map((feature) => {
      const featureCases = cases.filter(
        (c) => (c.module || 'General') === feature,
      );
      const blob = featureCases
        .map((c) => `${c.scenario} ${c.type ?? ''}`.toLowerCase())
        .join(' ');
      return {
        feature,
        CREATE:
          /create|add|new|register|post/.test(blob) || featureCases.length > 0,
        READ: /read|view|list|get|display|open/.test(blob) || true,
        UPDATE: /update|edit|modify|change|put|patch/.test(blob),
        DELETE: /delete|remove|cancel/.test(blob),
        caseCount: featureCases.length,
      };
    });

    const techniqueCoverage = buildTechniqueCoverage(
      cases,
      parseRequirementsFromArtifact(
        await ctx.getArtifactJson(ArtifactType.REQUIREMENTS_JSON),
      ),
    );
    const designValidation = {
      passed: cases.length > 0,
      blockers: cases.length ? [] : ['No test cases generated'],
      summary: `${cases.length} technique-based case(s) across ${techniqueCoverage.requirementCount} requirement(s) — ${techniqueCoverage.requirementsWithMultiTechnique} with multi-technique coverage`,
    };
    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'DESIGN',
      status: 'READY_FOR_REVIEW',
      document: {
        kind: 'TEST_DESIGN',
        testCases: cases.map((tc) => ({
          ...tc,
          testingLevel:
            /smoke/i.test(tc.type ?? '') || /smoke/i.test(tc.scenario)
              ? 'SMOKE'
              : /sanity/i.test(tc.type ?? '')
                ? 'SANITY'
                : 'FUNCTIONAL',
          crudHints: crudOps.filter((op) =>
            new RegExp(op, 'i').test(`${tc.scenario} ${tc.type ?? ''}`),
          ),
        })),
        crudMatrix,
        techniqueCoverage,
        testingLevelsCovered: [
          'SMOKE',
          'SANITY',
          'FUNCTIONAL',
          'INTEGRATION',
          'REGRESSION',
          'UAT_READY',
        ],
      },
      validation: designValidation,
    });

    // Stage 3 human gate — release worker slot for other STLC runs
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DESIGN_APPROVAL,
      phase: ExecutionPhase.TEST_DESIGN,
    });
    await ctx.emit({
      type: 'stlc.awaiting_design_approval',
      phase: ExecutionPhase.TEST_DESIGN,
      message:
        'Test design ready — awaiting human approval before Environment Setup',
      data: { count: cases.length },
    });
    throw new AwaitingHumanError(ExecutionStatus.AWAITING_DESIGN_APPROVAL);
    } else {
      await ctx.emit({
        type: 'stlc.resume_skip',
        phase: ExecutionPhase.TEST_DESIGN,
        message: 'Skipping requirements/strategy/design — already approved',
      });
    }

    gates = await loadGates();

    // Stage 4 — Environment Setup
    if (!gates.environmentApprovedAt) {
    const envOut = (await runAgent(
      ctx,
      {
        agent: environmentAgent,
        phase: ExecutionPhase.ENVIRONMENT,
        agentId: AgentId.ENVIRONMENT_SETUP,
      },
      {
        appUrl: project.appUrl,
        loginUrl: project.loginUrl,
        environment: project.environment,
        framework: project.framework,
        language: project.language,
        browserMode:
          normalizeBrowserMode(project.browserMode) === 'HEADED'
            ? 'CLOUD_HEADED'
            : 'CLOUD_HEADLESS',
        hasEncryptedConfig: Boolean(project.encryptedConfig),
      },
    )) as {
      validation?: { passed: boolean; blockers: string[]; summary: string };
      checklist?: unknown[];
      summary?: string;
    };

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'ENVIRONMENT',
      status: 'READY_FOR_REVIEW',
      document: envOut as Record<string, unknown>,
      validation: envOut.validation ?? {
        passed: true,
        blockers: [],
        summary: envOut.summary ?? 'Environment checklist ready',
      },
    });

    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_ENV_APPROVAL,
      phase: ExecutionPhase.ENVIRONMENT,
    });
    await ctx.emit({
      type: 'stlc.awaiting_env_approval',
      phase: ExecutionPhase.ENVIRONMENT,
      message:
        'Environment checklist ready — awaiting human approval before Test Data',
    });
    throw new AwaitingHumanError(ExecutionStatus.AWAITING_ENV_APPROVAL);
    } else {
      await ctx.emit({
        type: 'stlc.resume_skip',
        phase: ExecutionPhase.ENVIRONMENT,
        message: 'Skipping environment setup — already approved',
      });
    }

    gates = await loadGates();

    const liveEnv = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: {
        appUrl: true,
        loginUrl: true,
        browserMode: true,
        encryptedConfig: true,
      },
    });
    await groundExecutionCases({
      projectId: project.id,
      executionId,
      browserManager,
      ctx,
    });

    // Stage 5 — Test Data
    if (!gates.testDataApprovedAt) {
    const dbCasesForData = await prisma.testCase.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
    const needsGenerate = dbCasesForData.some((tc) => {
      if (!tc.testData || typeof tc.testData !== 'object') return true;
      return Object.keys(tc.testData as object).length === 0;
    });
    let dataOut: {
      cases?: Array<{ testCaseId: string; data: Record<string, string> }>;
    } = {
      cases: dbCasesForData.map((tc) => ({
        testCaseId: tc.id,
        data:
          tc.testData && typeof tc.testData === 'object'
            ? (tc.testData as Record<string, string>)
            : {},
      })),
    };
    if (needsGenerate) {
      dataOut = (await runAgent(
        ctx,
        {
          agent: testdataAgent,
          phase: ExecutionPhase.TEST_DATA,
          agentId: AgentId.TEST_DATA,
        },
        {
          appUrl: liveEnv.appUrl ?? project.appUrl,
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
      )) as {
        cases?: Array<{ testCaseId: string; data: Record<string, string> }>;
      };

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

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'DATA',
      status: 'READY_FOR_REVIEW',
      document: {
        kind: 'TEST_DATA',
        cases: dataOut?.cases ?? [],
      },
      validation: {
        passed: (dataOut?.cases?.length ?? 0) > 0,
        blockers:
          (dataOut?.cases?.length ?? 0) > 0
            ? []
            : ['No test data rows generated'],
        summary: `${dataOut?.cases?.length ?? 0} test data set(s) ready for review`,
      },
    });

    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DATA_APPROVAL,
      phase: ExecutionPhase.TEST_DATA,
    });
    await ctx.emit({
      type: 'stlc.awaiting_data_approval',
      phase: ExecutionPhase.TEST_DATA,
      message:
        'Pick ready cases to run (High → Medium → Low across features), then Accept',
      data: { count: dataOut?.cases?.length ?? 0 },
    });
    throw new AwaitingHumanError(ExecutionStatus.AWAITING_DATA_APPROVAL);
    } else {
      await ctx.emit({
        type: 'stlc.resume_skip',
        phase: ExecutionPhase.TEST_DATA,
        message: 'Skipping test data — already approved',
      });
    }

    // Confirm latest Environment URL and rewrite generic steps before run.
    await groundExecutionCases({
      projectId: project.id,
      executionId,
      browserManager,
      ctx,
    });

    // 5. Authentication pause
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_LOGIN,
      phase: ExecutionPhase.AUTHENTICATION,
    });

    const liveForRun = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { appUrl: true, loginUrl: true, browserMode: true },
    });
    const targetAppUrl = isUsableAppUrl(liveForRun.appUrl)
      ? String(liveForRun.appUrl).trim()
      : isUsableAppUrl(liveForRun.loginUrl)
        ? String(liveForRun.loginUrl).trim()
        : '';
    if (!targetAppUrl) {
      throw new Error(
        'Application URL is required before execution — set it on the Environment step.',
      );
    }
    const targetLoginUrl =
      (typeof liveForRun.loginUrl === 'string' && liveForRun.loginUrl.trim()) ||
      targetAppUrl;
    const headed = normalizeBrowserMode(liveForRun.browserMode) === 'HEADED';

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
        headless: !headed,
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

    const allBoard = await prisma.testCase.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
    const execRow = await prisma.execution.findUnique({
      where: { id: executionId },
      select: { selection: true },
    });
    const selection = (execRow?.selection ?? null) as {
      testCaseIds?: string[];
      runKind?: 'SPRINT' | 'REGRESSION' | 'SYSTEM';
      featureKey?: string | null;
    } | null;
    const readyBoard = allBoard.filter((c) => c.readyForExecution);
    const suggested = suggestExecutionSelection(readyBoard, {
      runKind: selection?.runKind ?? 'SPRINT',
      featureKey: selection?.featureKey ?? null,
    });
    const selectedIds = new Set(
      selection?.testCaseIds?.length ? selection.testCaseIds : suggested.testCaseIds,
    );
    const dbCases = sortCasesByPriority(
      readyBoard.filter((c) => selectedIds.has(c.id)),
    );

    for (const skipped of allBoard.filter((c) => !selectedIds.has(c.id))) {
      await prisma.testResult.create({
        data: {
          projectId: project.id,
          executionId,
          testCaseId: skipped.id,
          status: 'SKIPPED',
          message: skipped.readyForExecution
            ? 'Not selected for this run'
            : 'Not marked ready for execution',
        },
      });
    }

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

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'EXECUTION',
      status: 'READY_FOR_REVIEW',
      document: executionSummary as Record<string, unknown>,
      validation: {
        passed: true,
        blockers: [],
        summary: `Execution complete — ${executionSummary.totals?.passed ?? 0} passed, ${executionSummary.totals?.failed ?? 0} failed`,
      },
    });

    // Stage 6 human gate — pause for execution results approval
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

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'DEFECTS',
      status: 'READY_FOR_REVIEW',
      document: defectSummary as Record<string, unknown>,
      validation: {
        passed: true,
        blockers: [],
        summary:
          bugCount > 0
            ? `${bugCount} defect(s) filed for review`
            : 'No defects — board empty',
      },
    });

    // Stage 7 human gate — pause for defect review/approval
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_DEFECT_APPROVAL,
      phase: ExecutionPhase.BUG_ANALYSIS,
    });
    await ctx.emit({
      type: 'stlc.awaiting_defect_approval',
      phase: ExecutionPhase.BUG_ANALYSIS,
      message:
        'Defect management complete — awaiting human approval before Automation',
      data: defectSummary.totals,
    });
    await waitForContinueSignal(executionId);

    // Inline regression retest (not a separate human gate)
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

    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.AUTOMATION,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'AUTOMATION' },
    });
    await ctx.emit({
      type: 'stlc.defects_approved',
      phase: ExecutionPhase.AUTOMATION,
      message: 'Defects approved — continuing to Automation',
      data: { retestPassed, retestFailed, retestSkipped },
    });

    // Stage 8 — Automation generation
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

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'AUTOMATION',
      status: 'READY_FOR_REVIEW',
      document: automationSummary as Record<string, unknown>,
      validation: {
        passed: true,
        blockers: [],
        summary: 'Automation package ready for review',
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
        'Automation complete — awaiting human approval before Test Reporting',
    });
    await waitForContinueSignal(executionId);
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.REPORT,
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { stlcStage: 'REPORTING' },
    });
    await ctx.emit({
      type: 'stlc.automation_approved',
      phase: ExecutionPhase.REPORT,
      message: 'Automation approved — continuing to Test Reporting',
    });

    // Stage 9 — HTML report
    const reportOut = (await runAgent(
      ctx,
      {
        agent: reportAgent,
        phase: ExecutionPhase.REPORT,
        agentId: AgentId.REPORT_GENERATION,
      },
      { projectName: project.name, appUrl: project.appUrl },
    )) as { zipKey?: string };

    await runAgent(
      ctx,
      {
        agent: qualityAgent,
        phase: ExecutionPhase.QUALITY_ANALYSIS,
        agentId: AgentId.QUALITY_ANALYSIS,
      },
      { projectName: project.name, appUrl: project.appUrl },
    );

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

    const reportingDoc = {
      kind: 'TEST_REPORTING',
      preparedAt: new Date().toISOString(),
      scores,
      artifacts: {
        finalZipKey: `${executionId}/stlc/final-pack.zip`,
        reportZipKey: reportOut?.zipKey ?? null,
      },
      quality,
      testingLevelSummary: {
        SMOKE: 'included in execution suite',
        SANITY: 'included in execution suite',
        FUNCTIONAL: `score ${scores.functional}`,
        INTEGRATION: 'API + UI flows when discovered',
        REGRESSION: retestSkipped
          ? 'skipped (no failures)'
          : `retest pass=${retestPassed} fail=${retestFailed}`,
        UAT_READY: 'packaged in final ZIP for stakeholder review',
      },
    };

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'REPORTING',
      status: 'READY_FOR_REVIEW',
      document: reportingDoc,
      validation: {
        passed: true,
        blockers: [],
        summary: 'HTML report and STLC pack ready for review',
      },
    });

    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_REPORT_APPROVAL,
      phase: ExecutionPhase.REPORT,
      scores,
    });
    await ctx.emit({
      type: 'stlc.awaiting_report_approval',
      phase: ExecutionPhase.REPORT,
      message:
        'Test report ready — awaiting human approval before QA Sign-off',
      data: reportingDoc.scores,
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

    // Stage 10 — Sign-off recommendation
    const signoffOut = (await runAgent(
      ctx,
      {
        agent: signoffAgent,
        phase: ExecutionPhase.REPORT,
        agentId: AgentId.QA_SIGNOFF,
      },
      {
        strategy,
        scores: {
          functionalScore: scores.functional,
          passed: scores.passed,
          failed: scores.failed,
          bugsOpen: scores.bugs,
        },
        bugCount: bugsRows.length,
        failedCount: scores.failed,
        passedCount: scores.passed,
        reportReady: true,
      },
    )) as {
      validation?: { passed: boolean; blockers: string[]; summary: string };
      recommendation?: string;
      summary?: string;
    };

    await persistPhaseDocument({
      projectId: project.id,
      phaseId: 'SIGNOFF',
      status: 'READY_FOR_REVIEW',
      document: signoffOut as Record<string, unknown>,
      validation: signoffOut.validation ?? {
        passed: signoffOut.recommendation === 'READY',
        blockers: [],
        summary: signoffOut.summary ?? 'Sign-off recommendation ready',
      },
    });

    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_QA_SIGNOFF,
      phase: ExecutionPhase.REPORT,
      scores,
    });
    await ctx.emit({
      type: 'stlc.awaiting_qa_signoff',
      phase: ExecutionPhase.REPORT,
      message:
        'Sign-off scorecard ready — awaiting human QA Accept to close STLC',
      data: { recommendation: signoffOut.recommendation },
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
    // Human gates release the BullMQ slot — status already set to AWAITING_*.
    if (err instanceof AwaitingHumanError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ExecutionCancelledError) {
      await setExecution(executionId, {
        status: ExecutionStatus.CANCELLED,
        errorSummary: message,
        finishedAt: new Date(),
      });
      await ctx.emit({
        type: 'stlc.cancelled',
        message,
      });
      return;
    }
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
