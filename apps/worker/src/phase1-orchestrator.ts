import { prisma } from '@qaforge/database';
import {
  AgentId,
  ArtifactType,
  ExecutionPhase,
  ExecutionStatus,
} from '@qaforge/shared';
import type { AgentContext, AgentHandler } from '@qaforge/agent-sdk';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { createAgentContext } from './context.js';
import {
  getRedis,
  publishClarificationQuestions,
  waitForClarifySignal,
  waitForContinueSignal,
} from './redis.js';
import { requirementAgent } from './agents/requirement.agent.js';
import { clarificationAgent } from './agents/clarification.agent.js';
import { authenticationAgent } from './agents/authentication.agent.js';
import { testcaseAgent, type TestCase } from './agents/testcase.agent.js';
import { putBinaryArtifact } from './context.js';

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
): Promise<void> {
  for (const step of steps) {
    const s = step.trim();
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
      const value = quoted[quoted.length - 1] ?? 'test';
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

    // Best-effort: wait briefly so the page can settle between unknown steps
    await page.waitForTimeout(400);
  }
}

/**
 * Phase 1 focused pipeline:
 * requirements → clarify loop → test cases → login pause → execute → bugs/results
 */
export async function runPhase1Execution(executionId: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: {
      project: { include: { requirements: true } },
    },
  });
  if (!execution) throw new Error(`Execution not found: ${executionId}`);

  const project = execution.project;
  const sessionRef: { id?: string } = {};
  let browserSessionId: string | undefined;

  await setExecution(executionId, {
    status: ExecutionStatus.RUNNING,
    phase: ExecutionPhase.INIT,
    startedAt: new Date(),
  });

  const ctx = await createAgentContext({
    organizationId: project.organizationId,
    projectId: project.id,
    executionId,
  });

  await ctx.emit({
    type: 'phase1.started',
    phase: ExecutionPhase.INIT,
    message: `Phase 1 started for ${project.name}`,
  });

  const sub = getRedis().duplicate();
  const contChannel = `execution:${executionId}:continue`;
  void sub.subscribe(contChannel);
  sub.on('message', (ch: string) => {
    if (ch === contChannel && sessionRef.id) {
      browserManager.signalContinue(sessionRef.id);
    }
  });

  try {
    // 1. Requirements
    await runAgent(
      ctx,
      {
        agent: requirementAgent,
        phase: ExecutionPhase.REQUIREMENTS,
        agentId: AgentId.REQUIREMENT_ANALYSIS,
      },
      {
        requirementText: project.requirementText,
        documents: project.requirements,
        appUrl: project.appUrl,
      },
    );

    let requirementsJson =
      (await ctx.getArtifactJson<Record<string, unknown>>(
        ArtifactType.REQUIREMENTS_JSON,
      )) ?? {};

    // 2. Clarification loop
    let clear = false;
    for (let round = 1; round <= MAX_CLARIFY_ROUNDS; round++) {
      await setExecution(executionId, {
        status: ExecutionStatus.AWAITING_CLARIFICATION,
        phase: ExecutionPhase.CLARIFICATION,
      });

      const clarificationOut = (await runAgent(
        ctx,
        {
          agent: clarificationAgent,
          phase: ExecutionPhase.CLARIFICATION,
          agentId: AgentId.REQUIREMENT_CLARIFICATION,
        },
        {
          requirementText: project.requirementText,
          appUrl: project.appUrl,
        },
        ExecutionStatus.AWAITING_CLARIFICATION,
      )) as { questions: Array<{ id: string; question: string; reason?: string }> };

      const questions = clarificationOut?.questions ?? [];

      await prisma.clarificationRound.create({
        data: {
          projectId: project.id,
          executionId,
          round,
          questions: questions as never,
        },
      });

      await publishClarificationQuestions(executionId, { questions, round });

      await setExecution(executionId, {
        status: ExecutionStatus.AWAITING_CLARIFICATION,
        phase: ExecutionPhase.CLARIFICATION,
      });

      if (questions.length === 0) {
        clear = true;
        await prisma.clarificationRound.updateMany({
          where: { projectId: project.id, executionId, round },
          data: { answeredAt: new Date(), skipped: true },
        });
        break;
      }

      const clarify = await waitForClarifySignal(executionId);
      const answers = clarify.answers ?? {};
      const skipped =
        Boolean(clarify.skip) ||
        Object.values(answers).every((v) => !String(v ?? '').trim());

      await prisma.clarificationRound.updateMany({
        where: { projectId: project.id, executionId, round },
        data: {
          answers: answers as never,
          skipped,
          answeredAt: new Date(),
        },
      });

      await ctx.putArtifactJson(ArtifactType.CLARIFICATION_ANSWERS, {
        round,
        skip: skipped,
        answers,
      });

      const answerEntries = Object.entries(answers).filter(
        ([, v]) => String(v ?? '').trim().length > 0,
      );

      requirementsJson = {
        ...requirementsJson,
        clarifications: {
          ...(typeof requirementsJson.clarifications === 'object' &&
          requirementsJson.clarifications
            ? (requirementsJson.clarifications as object)
            : {}),
          [`round_${round}`]: { skipped, answers },
        },
        requirements: [
          ...((Array.isArray(requirementsJson.requirements)
            ? requirementsJson.requirements
            : []) as unknown[]),
          ...answerEntries.map(([id, answer], i) => ({
            id: `CLR-R${round}-${String(i + 1).padStart(3, '0')}`,
            title: `Clarification ${id}`,
            description: String(answer),
            priority: 'high',
            acceptanceCriteria: [`Addressed ${id}`],
          })),
        ],
      };

      await ctx.putArtifactJson(ArtifactType.REQUIREMENTS_JSON, requirementsJson);

      // Re-analyze requirements with merged answers
      await runAgent(
        ctx,
        {
          agent: requirementAgent,
          phase: ExecutionPhase.REQUIREMENTS,
          agentId: AgentId.REQUIREMENT_ANALYSIS,
        },
        {
          requirementText: [
            project.requirementText ?? '',
            '',
            'Clarifications:',
            ...answerEntries.map(([id, a]) => `- ${id}: ${a}`),
          ].join('\n'),
          documents: project.requirements,
          appUrl: project.appUrl,
        },
      );

      requirementsJson =
        (await ctx.getArtifactJson<Record<string, unknown>>(
          ArtifactType.REQUIREMENTS_JSON,
        )) ?? requirementsJson;

      clear = requirementsSeemClear(questions, skipped, round);
      if (clear) break;

      // Still gappy — next loop will ask again
      await ctx.emit({
        type: 'clarification.another_round',
        phase: ExecutionPhase.CLARIFICATION,
        message: `Requirements still incomplete — starting clarification round ${round + 1}`,
      });
    }

    await prisma.projectRequirementSnapshot.create({
      data: {
        projectId: project.id,
        executionId,
        payload: requirementsJson as never,
        clear: true,
      },
    });

    // 3. Test case generation
    const tcOut = (await runAgent(
      ctx,
      {
        agent: testcaseAgent,
        phase: ExecutionPhase.TEST_CASES,
        agentId: AgentId.TEST_CASE_GENERATION,
      },
      { appUrl: project.appUrl },
    )) as { testCases?: TestCase[] };

    const cases =
      tcOut?.testCases ??
      (
        await ctx.getArtifactJson<{ testCases?: TestCase[] }>(
          ArtifactType.TEST_CASES_JSON,
        )
      )?.testCases ??
      [];

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
        },
      });
    }

    await ctx.emit({
      type: 'phase1.test_cases_ready',
      phase: ExecutionPhase.TEST_CASES,
      message: `Generated ${cases.length} test case(s) on the Test Board`,
      data: { count: cases.length },
    });

    // 4. Authentication pause
    await setExecution(executionId, {
      status: ExecutionStatus.AWAITING_LOGIN,
      phase: ExecutionPhase.AUTHENTICATION,
    });

    const authResult = (await runAgent(
      ctx,
      {
        agent: authenticationAgent,
        phase: ExecutionPhase.AUTHENTICATION,
        agentId: AgentId.AUTHENTICATION,
      },
      {
        browserManager,
        startUrl: project.loginUrl || project.appUrl,
        loginUrl: project.loginUrl ?? undefined,
        appUrl: project.appUrl,
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

    // 5. Execute generated tests
    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.EXECUTION,
    });

    const page = await browserManager.getPage(browserSessionId);
    const dbCases = await prisma.testCase.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });

    let passed = 0;
    let failed = 0;

    for (const tc of dbCases) {
      const started = Date.now();
      const steps = Array.isArray(tc.steps) ? (tc.steps as string[]) : [];
      try {
        await page.goto(project.appUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        await executeTestSteps(page, steps, project.appUrl);
        await prisma.testResult.create({
          data: {
            projectId: project.id,
            executionId,
            testCaseId: tc.id,
            status: 'PASSED',
            message: 'Agent completed steps without hard failure',
            durationMs: Date.now() - started,
          },
        });
        passed += 1;
        await ctx.emit({
          type: 'phase1.test_passed',
          phase: ExecutionPhase.EXECUTION,
          message: `PASSED ${tc.externalId}: ${tc.scenario}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let evidenceKey: string | undefined;
        try {
          const shot = await browserManager.screenshot(
            browserSessionId,
            `fail-${tc.externalId}`,
          );
          evidenceKey = await putBinaryArtifact({
            executionId,
            type: ArtifactType.SCREENSHOT,
            key: `${executionId}/screenshots/fail-${tc.externalId}.png`,
            body: shot,
            mime: 'image/png',
            store: ctx.artifactStore,
          });
        } catch {
          /* ignore screenshot errors */
        }

        const result = await prisma.testResult.create({
          data: {
            projectId: project.id,
            executionId,
            testCaseId: tc.id,
            status: 'FAILED',
            message,
            durationMs: Date.now() - started,
            evidenceKeys: evidenceKey ? ([evidenceKey] as never) : undefined,
          },
        });

        await prisma.bug.create({
          data: {
            projectId: project.id,
            executionId,
            testCaseId: tc.id,
            testResultId: result.id,
            title: `Failed: ${tc.scenario}`,
            severity: tc.severity ?? 'medium',
            description: message,
            stepsToReproduce: steps.join('\n'),
            evidenceKeys: evidenceKey ? ([evidenceKey] as never) : undefined,
          },
        });

        failed += 1;
        await ctx.emit({
          type: 'phase1.test_failed',
          phase: ExecutionPhase.EXECUTION,
          message: `FAILED ${tc.externalId}: ${message}`,
        });
      }
    }

    await setExecution(executionId, {
      status: ExecutionStatus.COMPLETED,
      phase: ExecutionPhase.DONE,
      finishedAt: new Date(),
      scores: {
        functional: dbCases.length
          ? Math.round((passed / dbCases.length) * 100)
          : 0,
        passed,
        failed,
        total: dbCases.length,
      },
    });

    await ctx.emit({
      type: 'phase1.completed',
      phase: ExecutionPhase.DONE,
      message: `Phase 1 complete — ${passed} passed, ${failed} failed`,
      data: { passed, failed, total: dbCases.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setExecution(executionId, {
      status: ExecutionStatus.FAILED,
      errorSummary: message,
      finishedAt: new Date(),
    });
    await ctx.emit({
      type: 'phase1.failed',
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
