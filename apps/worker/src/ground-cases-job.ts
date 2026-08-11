import type { AgentContext } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  ArtifactType,
  groundCasesAgainstUi,
  isUsableAppUrl,
  type UiPageMap,
} from '@qaforge/shared';
import { BrowserSessionManager } from '@qaforge/browser-session';
import { createAgentContext } from './context.js';
import { crawlSameOrigin } from './agents/discovery.agent.js';

export async function groundExecutionCases(opts: {
  projectId: string;
  executionId: string;
  browserManager?: BrowserSessionManager;
  ctx?: Pick<AgentContext, 'getArtifactJson' | 'putArtifactJson' | 'emit'>;
}): Promise<{ grounded: number; appUrl: string | null; crawled: boolean }> {
  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { organizationId: true, appUrl: true, loginUrl: true },
  });
  const appUrl = (project?.appUrl || project?.loginUrl || '').trim();
  if (!project || !isUsableAppUrl(appUrl)) {
    return { grounded: 0, appUrl: null, crawled: false };
  }

  const cases = await prisma.testCase.findMany({
    where: { executionId: opts.executionId },
    orderBy: { createdAt: 'asc' },
  });
  if (!cases.length) {
    return { grounded: 0, appUrl, crawled: false };
  }

  const ctx =
    opts.ctx ??
    (await createAgentContext({
      organizationId: project.organizationId,
      projectId: opts.projectId,
      executionId: opts.executionId,
    }));

  let pages: UiPageMap[] = [];
  const existingMap = (await ctx.getArtifactJson(
    ArtifactType.APPLICATION_MAP,
  )) as { pages?: UiPageMap[]; appUrl?: string } | null;
  pages = existingMap?.pages ?? [];
  const mapUrl = existingMap?.appUrl ?? '';
  let crawled = false;

  if (!pages.length || (mapUrl && mapUrl !== appUrl)) {
    const browserManager = opts.browserManager ?? new BrowserSessionManager();
    let probeId: string | undefined;
    try {
      await ctx.emit({
        type: 'stlc.ui_explore',
        phase: 'ENVIRONMENT',
        message: `Exploring UI at ${appUrl} to ground test cases`,
      });
      const probe = await browserManager.launch({
        executionId: opts.executionId,
        startUrl: appUrl,
        headless: true,
      });
      probeId = probe.sessionId;
      const page = await browserManager.getPage(probeId);
      const crawl = await crawlSameOrigin(page, appUrl, 8);
      pages = crawl.pages;
      crawled = true;
      await ctx.putArtifactJson(ArtifactType.APPLICATION_MAP, {
        appUrl,
        crawledAt: new Date().toISOString(),
        pages,
        visitedUrls: crawl.visited,
        source: 'environment-explore',
      });
    } catch (err) {
      await ctx.emit({
        type: 'stlc.ui_explore_failed',
        phase: 'ENVIRONMENT',
        message: `UI explore skipped: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (probeId) {
        await browserManager.destroy(probeId).catch(() => undefined);
      }
    }
  }

  for (const tc of cases) {
    const grounded = groundCasesAgainstUi(
      [
        {
          steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
          designMode: tc.designMode,
          preconditions: tc.preconditions,
        },
      ],
      { appUrl, pages },
    )[0];
    if (!grounded) continue;
    const becameGrounded =
      tc.designMode !== 'UI_GROUNDED' &&
      (grounded.designMode ?? 'UI_GROUNDED') === 'UI_GROUNDED';
    await prisma.testCase.update({
      where: { id: tc.id },
      data: {
        steps: grounded.steps as never,
        preconditions: grounded.preconditions,
        designMode: grounded.designMode ?? 'UI_GROUNDED',
        ...(becameGrounded ? { readyForExecution: false } : {}),
      },
    });
  }

  await ctx.emit({
    type: 'stlc.cases_grounded',
    phase: 'ENVIRONMENT',
    message: `Grounded ${cases.length} case(s) against ${appUrl} — review Ready before execution`,
  });

  return { grounded: cases.length, appUrl, crawled };
}
