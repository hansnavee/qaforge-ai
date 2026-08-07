import type { AgentHandler, AgentContext } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  AgentId,
  ExecutionPhase,
  ExecutionStatus,
  type ExecutionPhase as Phase,
} from '@qaforge/shared';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { createAgentContext, type ExecutionJobData } from './context.js';
import { getRedis, waitForContinueSignal } from './redis.js';
import { requirementAgent } from './agents/requirement.agent.js';
import { authenticationAgent } from './agents/authentication.agent.js';
import { discoveryAgent } from './agents/discovery.agent.js';
import { functionalAgent } from './agents/functional.agent.js';
import { accessibilityAgent } from './agents/accessibility.agent.js';
import { performanceAgent } from './agents/performance.agent.js';
import { securityAgent } from './agents/security.agent.js';
import { testcaseAgent } from './agents/testcase.agent.js';
import { automationAgent } from './agents/automation.agent.js';
import { executionAgent } from './agents/execution.agent.js';
import { failureAnalysisAgent } from './agents/failure-analysis.agent.js';
import { reportAgent } from './agents/report.agent.js';
import { uiuxAgent } from './agents/uiux.agent.js';
import { productAgent } from './agents/product.agent.js';
import { apiAgent } from './agents/api.agent.js';

export type { ExecutionJobData };

const browserManager = new BrowserSessionManager();

type Step = {
  agent: AgentHandler;
  phase: Phase;
  agentId: string;
};

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
  step: Step,
  input: unknown,
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
    status: ExecutionStatus.RUNNING,
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
      data: {
        status: 'COMPLETED',
        durationMs,
        outputRef: typeof output === 'string' ? output : undefined,
      },
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
      data: { agentId: step.agentId },
    });
    throw err;
  }
}

export async function runExecution(executionId: string): Promise<void> {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: {
      project: {
        include: {
          requirements: true,
          organization: true,
        },
      },
    },
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const project = execution.project;
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
    type: 'execution.started',
    phase: ExecutionPhase.INIT,
    message: `Execution started for ${project.name}`,
  });

  // Allow Redis continue messages to unblock BrowserSessionManager.waitForContinue
  const sub = getRedis().duplicate();
  const contChannel = `execution:${executionId}:continue`;
  void sub.subscribe(contChannel);
  sub.on('message', (ch: string) => {
    if (ch === contChannel && browserSessionId) {
      browserManager.signalContinue(browserSessionId);
    }
  });

  try {
    // 1. REQUIREMENTS
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

    // 2. AUTHENTICATION
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
      },
    )) as { sessionId: string };

    browserSessionId = authResult.sessionId;
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

    await setExecution(executionId, {
      status: ExecutionStatus.RUNNING,
      phase: ExecutionPhase.DISCOVERY,
    });

    // 3. DISCOVERY
    await runAgent(
      ctx,
      {
        agent: discoveryAgent,
        phase: ExecutionPhase.DISCOVERY,
        agentId: AgentId.APPLICATION_DISCOVERY,
      },
      { browserManager, sessionId: browserSessionId, appUrl: project.appUrl },
    );

    // 4. Parallel-ish analysis agents (non-browser in parallel; browser-bound sequential)
    const softRun = async (step: Step, input: unknown) => {
      try {
        await runAgent(ctx, step, input);
      } catch (err) {
        await ctx.emit({
          type: 'agent.soft_failed',
          phase: step.phase,
          message: `${step.agent.name} soft-failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    const sharedInput = {
      browserManager,
      sessionId: browserSessionId,
      appUrl: project.appUrl,
    };

    await Promise.all([
      softRun(
        {
          agent: functionalAgent,
          phase: ExecutionPhase.FUNCTIONAL,
          agentId: AgentId.FUNCTIONAL_TESTING,
        },
        sharedInput,
      ),
      softRun(
        {
          agent: securityAgent,
          phase: ExecutionPhase.SECURITY,
          agentId: AgentId.SECURITY_REVIEW,
        },
        sharedInput,
      ),
      softRun(
        {
          agent: productAgent,
          phase: ExecutionPhase.PRODUCT,
          agentId: AgentId.PRODUCT_IMPROVEMENT,
        },
        sharedInput,
      ),
      softRun(
        {
          agent: apiAgent,
          phase: ExecutionPhase.API,
          agentId: AgentId.API_TESTING,
        },
        sharedInput,
      ),
    ]);

    // Browser page is not concurrency-safe — run sequentially
    for (const step of [
      {
        agent: accessibilityAgent,
        phase: ExecutionPhase.ACCESSIBILITY,
        agentId: AgentId.ACCESSIBILITY,
      },
      {
        agent: performanceAgent,
        phase: ExecutionPhase.PERFORMANCE,
        agentId: AgentId.PERFORMANCE,
      },
      {
        agent: uiuxAgent,
        phase: ExecutionPhase.UI_UX,
        agentId: AgentId.UI_UX_REVIEW,
      },
    ] as Step[]) {
      await softRun(step, sharedInput);
    }

    // 5. TEST_CASES
    await runAgent(
      ctx,
      {
        agent: testcaseAgent,
        phase: ExecutionPhase.TEST_CASES,
        agentId: AgentId.TEST_CASE_GENERATION,
      },
      { appUrl: project.appUrl },
    );

    // 6. AUTOMATION
    await runAgent(
      ctx,
      {
        agent: automationAgent,
        phase: ExecutionPhase.AUTOMATION,
        agentId: AgentId.AUTOMATION_GENERATION,
      },
      {
        projectName: project.name,
        appUrl: project.appUrl,
        framework: project.framework,
        language: project.language,
      },
    );

    // 7. EXECUTION
    await runAgent(
      ctx,
      {
        agent: executionAgent,
        phase: ExecutionPhase.EXECUTION,
        agentId: AgentId.EXECUTION,
      },
      {
        browserManager,
        sessionId: browserSessionId,
        appUrl: project.appUrl,
      },
    );

    // 8. FAILURE_ANALYSIS
    await runAgent(
      ctx,
      {
        agent: failureAnalysisAgent,
        phase: ExecutionPhase.FAILURE_ANALYSIS,
        agentId: AgentId.FAILURE_ANALYSIS,
      },
      {},
    );

    // 9. REPORT
    const reportOut = (await runAgent(
      ctx,
      {
        agent: reportAgent,
        phase: ExecutionPhase.REPORT,
        agentId: AgentId.REPORT_GENERATION,
      },
      {
        projectName: project.name,
        appUrl: project.appUrl,
      },
    )) as { scores?: Record<string, number> } | undefined;

    // 10. COMPLETED
    await setExecution(executionId, {
      status: ExecutionStatus.COMPLETED,
      phase: ExecutionPhase.DONE,
      finishedAt: new Date(),
      scores: reportOut?.scores ?? undefined,
    });

    await ctx.emit({
      type: 'execution.completed',
      phase: ExecutionPhase.DONE,
      message: 'Execution completed successfully',
      data: { scores: reportOut?.scores },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setExecution(executionId, {
      status: ExecutionStatus.FAILED,
      errorSummary: message,
      finishedAt: new Date(),
    });
    await ctx.emit({
      type: 'execution.failed',
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

export { browserManager };
