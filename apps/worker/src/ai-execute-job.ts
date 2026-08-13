import { prisma } from '@qaforge/database';
import { BrowserSessionManager, createPlaywrightBrowserProvider } from '@qaforge/browser-session';
import {
  ArtifactType,
  ExecutionStatus,
  QA_TOOL_PROVIDER,
  caseStartUrl,
  classifyAiFailureMessage,
  createQaToolRegistry,
  credsFromCases,
  isUsableAppUrl,
  normalizePriorityLabel,
  sortCasesByPriority,
} from '@qaforge/shared';
import { buildZipPackage } from '@qaforge/report-engine';
import { createAgentContext, putBinaryArtifact } from './context.js';
import { buildAutomationHtml, playwrightSpec } from './ai-execute-playwright.js';
import { executeTestSteps } from './execute-test-steps.js';
import { parseActionLog } from './replay-action-log.js';
import { runFailurePipeline } from './failure-pipeline.js';
import {
  ExecutionCancelledError,
  throwIfCancelled,
  waitWhilePaused,
} from './redis.js';

export type AiExecuteJobData = {
  executionId: string;
  testCaseIds?: string[];
  browser?: string;
  headless?: boolean;
  username?: string;
  password?: string;
  appUrl?: string;
  loginUrl?: string;
  browserstackUsername?: string;
  browserstackAccessKey?: string;
};

type Selection = {
  name?: string;
  testCaseIds?: string[];
  runKind?: string;
  /** RECORD forces NL re-record; REPLAY uses ActionLog when present; omit = legacy AUTOMATION heuristic */
  executeMode?: 'RECORD' | 'REPLAY';
};

function readSelection(raw: unknown): Selection {
  if (!raw || typeof raw !== 'object') return {};
  return raw as Selection;
}

function forceHeadless(requestedHeadless: boolean): boolean {
  if (process.env.BROWSER_HEADLESS === 'true') return true;
  if (process.platform === 'linux' && !process.env.DISPLAY) return true;
  return requestedHeadless;
}

export async function runAiExecuteJob(data: AiExecuteJobData): Promise<void> {
  const executionId = data.executionId;
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { project: true },
  });
  if (!execution) throw new Error(`Execution ${executionId} not found`);
  if (
    execution.status === ExecutionStatus.CANCELLED ||
    execution.status === ExecutionStatus.COMPLETED
  ) {
    return;
  }

  const project = execution.project;
  const selection = readSelection(execution.selection);
  const requested = data.testCaseIds?.length
    ? data.testCaseIds
    : selection.testCaseIds ?? [];
  const cases = requested.length
    ? await prisma.testCase.findMany({
        where: { id: { in: requested }, projectId: project.id, deletedAt: null },
      })
    : [];
  const ordered = sortCasesByPriority(
    cases.map((c) => ({
      ...c,
      priorityLabel: c.priorityLabel ?? normalizePriorityLabel(c.priority),
    })),
  );
  if (!ordered.length) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        finishedAt: null,
        errorSummary: 'No cases to execute',
      },
    });
    throw new Error('No cases to execute');
  }

  let appUrl = data.appUrl || project.appUrl;
  if (!isUsableAppUrl(appUrl)) {
    for (const tc of ordered) {
      const dataObj =
        tc.testData && typeof tc.testData === 'object'
          ? (tc.testData as Record<string, string>)
          : {};
      const fromData = dataObj.appUrl;
      if (typeof fromData === 'string' && isUsableAppUrl(fromData)) {
        appUrl = fromData;
        break;
      }
      const steps = Array.isArray(tc.steps) ? (tc.steps as string[]) : [];
      for (const step of steps) {
        const found = String(step).match(/https?:\/\/\S+/i)?.[0];
        if (found && isUsableAppUrl(found)) {
          appUrl = found;
          break;
        }
      }
      if (isUsableAppUrl(appUrl)) break;
    }
  }
  if (!isUsableAppUrl(appUrl)) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        finishedAt: null,
        errorSummary: 'Application URL is required before AI execution',
      },
    });
    throw new Error('Application URL is required before AI execution');
  }

  const fromCases = credsFromCases(ordered, {
    username: data.username,
    password: data.password,
  });
  data.username = fromCases.username || data.username;
  data.password = fromCases.password || data.password;

  const browserKind =
    data.browser === 'firefox' || data.browser === 'webkit'
      ? data.browser
      : 'chromium';
  const useBstack = Boolean(
    data.browserstackUsername && data.browserstackAccessKey,
  );
  const headless = useBstack
    ? data.headless !== false
    : forceHeadless(data.headless !== false);
  const browserManager = new BrowserSessionManager();
  let launched: { sessionId: string } | null = null;
  let ctx: Awaited<ReturnType<typeof createAgentContext>> | null = null;

  try {
    launched = useBstack
      ? await browserManager.launchBrowserStack({
          executionId,
          startUrl: appUrl as string,
          username: data.browserstackUsername!,
          accessKey: data.browserstackAccessKey!,
          browser: browserKind,
          headless,
          name: selection.name,
        })
      : await browserManager.launch({
          executionId,
          startUrl: appUrl as string,
          headless,
          browser: browserKind,
        });
    if (!launched) throw new Error('Browser session failed');
    ctx = await createAgentContext({
      organizationId: project.organizationId,
      projectId: project.id,
      executionId,
      browserSessionId: launched.sessionId,
    });
  } catch (err) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        finishedAt: null,
        errorSummary:
          err instanceof Error
            ? `Browser failed to start: ${err.message}`
            : 'Browser failed to start',
      },
    });
    if (launched) {
      await browserManager.destroy(launched.sessionId).catch(() => undefined);
    }
    throw err;
  }

  if (!launched || !ctx) {
    throw new Error('Browser session failed');
  }

  const tools = createQaToolRegistry([
    createPlaywrightBrowserProvider(browserManager, launched.sessionId),
  ]);
  const browserTool = tools.get(QA_TOOL_PROVIDER.PLAYWRIGHT)?.browser;

  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: ExecutionStatus.RUNNING,
      startedAt: execution.startedAt ?? new Date(),
      errorSummary: null,
    },
  });

  let passed = 0;
  let failed = 0;
  let cancelled = false;
  const htmlRows: Array<{
    externalId: string;
    scenario: string;
    priority: string;
    status: string;
    durationMs: number | null;
    message: string | null;
    thumbDataUrl?: string | null;
  }> = [];
  const zipFiles: Record<string, Buffer | string> = {};

  try {
    for (const tc of ordered) {
      await throwIfCancelled(executionId);
      await waitWhilePaused(executionId);
      await throwIfCancelled(executionId);

      // Isolate each case on a fresh page so prior auth/cart state does not cascade.
      const casePage = await browserManager.freshPage(launched.sessionId);

      const steps = Array.isArray(tc.steps) ? (tc.steps as string[]) : [];
      const started = Date.now();
      const evidenceKeys: string[] = [];
      let status: 'PASSED' | 'FAILED' = 'PASSED';
      let message: string | null =
        'AI Executor: steps completed without hard failure';
      let thumb: string | null = null;
      const testData: Record<string, string> = {
        ...(tc.testData && typeof tc.testData === 'object'
          ? (tc.testData as Record<string, string>)
          : {}),
      };
      const fromCase = credsFromCases([{ testData, steps }], {});
      if (!testData.username && fromCase.username) testData.username = fromCase.username;
      if (!testData.password && fromCase.password) testData.password = fromCase.password;
      if (!testData.username && data.username) testData.username = data.username;
      if (!testData.password && data.password) testData.password = data.password;

      let actions: Awaited<ReturnType<typeof executeTestSteps>> = [];
      const forceRecord = selection.executeMode === 'RECORD';
      const forceReplay = selection.executeMode === 'REPLAY';
      const preferReplay =
        !forceRecord &&
        (forceReplay || selection.runKind === 'AUTOMATION');
      try {
        const startUrl = caseStartUrl(tc.testData, steps, appUrl as string);
        if (preferReplay) {
          const existingScript = await prisma.automatedScript.findUnique({
            where: {
              projectId_testCaseId: {
                projectId: project.id,
                testCaseId: tc.id,
              },
            },
          });
          const recorded = parseActionLog(existingScript?.actionLog);
          if (recorded.length) {
            const env = {
              appUrl: appUrl as string,
              loginUrl: data.loginUrl || project.loginUrl,
              username: testData.username || data.username,
              password: testData.password || data.password,
              firstName: testData.firstName,
              lastName: testData.lastName,
              postalCode: testData.postalCode,
            };
            const pipeline = await runFailurePipeline({
              page: casePage,
              actions: recorded,
              env,
              startUrl,
              healAttempts: existingScript?.healCount ?? 0,
              stabilityStatus: existingScript?.stabilityStatus,
              healRequiresReview: Boolean(
                (project as { healRequiresReview?: boolean }).healRequiresReview,
              ),
              llmHealRequiresApproval:
                (project as { llmHealRequiresApproval?: boolean })
                  .llmHealRequiresApproval !== false,
              isP0: (tc.priorityLabel ?? '').toUpperCase() === 'HIGH',
              gotoStart: async () => {
                await casePage.goto(startUrl, {
                  waitUntil: 'domcontentloaded',
                  timeout: 45_000,
                });
              },
            });
            status = pipeline.status;
            message = pipeline.message;
            actions = pipeline.actions;
            if (pipeline.quarantined || pipeline.committedHeal || pipeline.pendingReview) {
              await prisma.automationHealLog.create({
                data: {
                  projectId: project.id,
                  testCaseId: tc.id,
                  scriptVersion: existingScript?.scriptVersion ?? 1,
                  healerKind: 'RULE',
                  status: pipeline.quarantined
                    ? 'QUARANTINED'
                    : pipeline.pendingReview
                      ? 'PENDING_REVIEW'
                      : pipeline.committedHeal
                        ? 'COMMITTED'
                        : 'VERIFIED',
                  patchDiff: pipeline.appliedRules.join(', ') || null,
                  patchedLog:
                    pipeline.committedHeal || pipeline.pendingReview
                      ? ((pipeline.patchedActions ?? pipeline.actions) as never)
                      : undefined,
                  verificationRuns: pipeline.verificationRuns as never,
                  rationale: pipeline.decision.rationale as never,
                  committed: pipeline.committedHeal,
                },
              });
              await prisma.automatedScript.update({
                where: { id: existingScript!.id },
                data: {
                  lastRunId: executionId,
                  lastStatus: status,
                  healCount: pipeline.committedHeal || pipeline.quarantined
                    ? { increment: 1 }
                    : undefined,
                  stabilityStatus: pipeline.quarantined
                    ? 'QUARANTINED'
                    : pipeline.committedHeal
                      ? 'WATCH'
                      : existingScript?.stabilityStatus,
                  ...(pipeline.committedHeal
                    ? {
                        actionLog: pipeline.actions as never,
                        recordedBy: 'HEALER',
                        scriptVersion: { increment: 1 },
                        lastVerifiedAt: new Date(),
                      }
                    : {}),
                },
              });
            }
          } else {
            if (browserTool?.open) await browserTool.open(startUrl);
            else {
              await casePage.goto(startUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 45_000,
              });
            }
            actions = await executeTestSteps(
              casePage,
              steps,
              startUrl,
              testData,
              browserTool,
            );
          }
        } else {
          if (browserTool?.open) await browserTool.open(startUrl);
          else {
            await casePage.goto(startUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 45_000,
            });
          }
          actions = await executeTestSteps(
            casePage,
            steps,
            startUrl,
            testData,
            browserTool,
          );
        }
      } catch (err) {
        status = 'FAILED';
        const raw = err instanceof Error ? err.message : String(err);
        message = classifyAiFailureMessage(raw, Date.now() - started);
      }

      if (status === 'FAILED' && message) {
        message = classifyAiFailureMessage(message, Date.now() - started);
      }

      // On replay, do not overwrite a healthy recorded script with empty/partial log.
      const shouldWriteScript = !preferReplay || actions.length > 0;
      const spec = playwrightSpec({
        externalId: tc.externalId,
        scenario: tc.scenario,
        steps,
        expected: tc.expected,
        appUrl: appUrl as string,
        username: data.username,
        password: data.password,
        actions,
      });
      const specPath = `tests/${tc.externalId.replace(/[^a-zA-Z0-9._-]/g, '_')}.spec.ts`;
      if (shouldWriteScript && !preferReplay) {
        await prisma.automatedScript.upsert({
          where: {
            projectId_testCaseId: { projectId: project.id, testCaseId: tc.id },
          },
          create: {
            projectId: project.id,
            testCaseId: tc.id,
            path: specPath,
            source: spec,
            language: 'TYPESCRIPT',
            framework: 'PLAYWRIGHT',
            lastRunId: executionId,
            lastStatus: status,
            recordedBy: 'EXECUTOR',
            scriptVersion: 1,
            actionLog: actions as never,
          },
          update: {
            path: specPath,
            source: spec,
            lastRunId: executionId,
            lastStatus: status,
            recordedBy: 'EXECUTOR',
            scriptVersion: { increment: 1 },
            actionLog: actions as never,
          },
        });
        zipFiles[specPath] = spec;
      } else {
        await prisma.automatedScript.updateMany({
          where: { projectId: project.id, testCaseId: tc.id },
          data: { lastRunId: executionId, lastStatus: status },
        });
        if (actions.length) zipFiles[specPath] = spec;
      }

      try {
        const shotBytes = browserTool?.screenshot
          ? await browserTool.screenshot(
              `${status.toLowerCase()}-${tc.externalId}`,
            )
          : await browserManager.screenshot(
              launched.sessionId,
              `${status.toLowerCase()}-${tc.externalId}`,
            );
        const shot = shotBytes ? Buffer.from(shotBytes) : Buffer.alloc(0);
        if (!shot.length) throw new Error('empty screenshot');
        const shotName = `screenshots/${tc.externalId}-${status.toLowerCase()}.png`;
        zipFiles[shotName] = shot;
        const key = await putBinaryArtifact({
          executionId,
          type: ArtifactType.SCREENSHOT,
          key: `${executionId}/${shotName}`,
          body: shot,
          mime: 'image/png',
          store: ctx.artifactStore,
        });
        evidenceKeys.push(key);
        if (shot.length < 250_000) {
          thumb = `data:image/png;base64,${shot.toString('base64')}`;
        }
      } catch {
        /* ignore screenshot errors */
      }

      const durationMs = Date.now() - started;
      const existingResult = await prisma.testResult.findFirst({
        where: { executionId, testCaseId: tc.id },
        orderBy: { createdAt: 'desc' },
      });
      if (existingResult) {
        await prisma.testResult.update({
          where: { id: existingResult.id },
          data: {
            status,
            message,
            durationMs,
            executedBy: 'AI',
            evidenceKeys: evidenceKeys.length
              ? (evidenceKeys as never)
              : existingResult.evidenceKeys ?? undefined,
          },
        });
      } else {
        await prisma.testResult.create({
          data: {
            projectId: project.id,
            executionId,
            testCaseId: tc.id,
            status,
            message,
            durationMs,
            executedBy: 'AI',
            evidenceKeys: evidenceKeys.length
              ? (evidenceKeys as never)
              : undefined,
          },
        });
      }
      if (status === 'PASSED') passed += 1;
      else failed += 1;
      htmlRows.push({
        externalId: tc.externalId,
        scenario: tc.scenario,
        priority: tc.priorityLabel ?? 'MEDIUM',
        status,
        durationMs,
        message,
        thumbDataUrl: thumb,
      });
      await ctx.emit({
        type: status === 'PASSED' ? 'stlc.test_passed' : 'stlc.test_failed',
        phase: 'EXECUTION',
        message: `${status} ${tc.externalId}: ${tc.scenario}`,
      });
    }
  } catch (err) {
    if (err instanceof ExecutionCancelledError) {
      cancelled = true;
    } else {
      await prisma.execution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.RUNNING,
          finishedAt: null,
          errorSummary: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  } finally {
    try {
      const suiteVideos = await browserManager.flushAndCollectVideos(
        launched.sessionId,
      );
      for (const file of suiteVideos) {
        zipFiles[`videos/suite-${file.filename}`] = file.body;
        await putBinaryArtifact({
          executionId,
          type: ArtifactType.VIDEO,
          key: `${executionId}/videos/suite-${file.filename}`,
          body: file.body,
          mime: 'video/webm',
          store: ctx.artifactStore,
        });
      }
    } catch {
      /* ignore */
    }
    await browserManager.destroy(launched.sessionId).catch(() => undefined);
  }

  if (htmlRows.length) {
    const runName =
      selection.name?.trim() ||
      `AI run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const html = buildAutomationHtml({
      projectName: project.name,
      runName,
      rows: htmlRows,
    });
    const stamp = Date.now();
    const htmlKey = `${executionId}/automation-reports/${stamp}.html`;
    const storedHtml = await putBinaryArtifact({
      executionId,
      type: ArtifactType.REPORT_HTML,
      key: htmlKey,
      body: html,
      mime: 'text/html',
      store: ctx.artifactStore,
    });
    zipFiles['report.html'] = html;
    const zipBuf = await buildZipPackage({ files: zipFiles });
    const zipKey = `${executionId}/automation-reports/${stamp}.zip`;
    const storedZip = await putBinaryArtifact({
      executionId,
      type: ArtifactType.ZIP_PACKAGE,
      key: zipKey,
      body: zipBuf,
      mime: 'application/zip',
      store: ctx.artifactStore,
    });
    const reportStatus = cancelled
      ? 'CANCELLED'
      : failed > 0
        ? 'FAILED'
        : 'PASSED';
    await prisma.automationReport.create({
      data: {
        projectId: project.id,
        executionId,
        name: `${runName} ${new Date(stamp).toISOString().slice(0, 16).replace('T', ' ')}`,
        status: reportStatus,
        passed,
        failed,
        htmlKey: storedHtml,
        zipKey: storedZip,
      },
    });
  }

  const latest = await prisma.execution.findUnique({
    where: { id: executionId },
    select: { status: true },
  });
  if (cancelled || latest?.status === ExecutionStatus.CANCELLED) {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.CANCELLED,
        finishedAt: new Date(),
        errorSummary: latest?.status === ExecutionStatus.CANCELLED
          ? undefined
          : 'Stopped by user',
      },
    });
    return;
  }
  // Do not reopen a human-signed-off COMPLETED cycle (race with Complete button).
  if (latest?.status === ExecutionStatus.COMPLETED) {
    return;
  }
  await prisma.execution.updateMany({
    where: {
      id: executionId,
      status: {
        in: [
          ExecutionStatus.PENDING,
          ExecutionStatus.RUNNING,
          ExecutionStatus.FAILED,
          ExecutionStatus.QUEUED,
        ],
      },
    },
    data: {
      status: ExecutionStatus.RUNNING,
      finishedAt: null,
      errorSummary: null,
    },
  });
}
