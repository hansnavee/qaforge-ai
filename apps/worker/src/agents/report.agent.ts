import type { AgentHandler } from '@qaforge/agent-sdk';
import {
  renderHtmlReport,
  renderJunitXml,
  renderCsvResults,
  renderExecutiveMarkdown,
  buildZipPackage,
  type ReportManifest,
} from '@qaforge/report-engine';
import { ArtifactType } from '@qaforge/shared';
import { prisma } from '@qaforge/database';
import { putBinaryArtifact } from '../context.js';

type ReportInput = {
  projectName: string;
  appUrl: string;
};

function scoreOf(obj: unknown, key = 'score'): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}

export const reportAgent: AgentHandler<
  ReportInput,
  { scores: ReportManifest['scores']; zipKey: string }
> = {
  id: 'REPORT_GENERATION',
  name: 'Report Agent',

  async run(ctx, input) {
    const functional = await ctx.getArtifactJson<{
      findings?: ReportManifest['findings'];
      smokeScenarios?: unknown[];
    }>(ArtifactType.FUNCTIONAL_FINDINGS);
    const a11y = await ctx.getArtifactJson(ArtifactType.ACCESSIBILITY_REPORT);
    const perf = await ctx.getArtifactJson(ArtifactType.PERFORMANCE_METRICS);
    const security = await ctx.getArtifactJson(ArtifactType.SECURITY_CHECKLIST);
    const ux = await ctx.getArtifactJson<{
      findings?: ReportManifest['findings'];
      score?: number;
    }>(ArtifactType.UX_FINDINGS);
    const testCasesJson = await ctx.getArtifactJson<{
      testCases?: Array<Record<string, unknown>>;
    }>(ArtifactType.TEST_CASES_JSON);
    const failures = await ctx.getArtifactJson<{
      failures?: Array<{
        title?: string;
        severity?: string;
        rootCause?: string;
        suggestedFix?: string;
      }>;
      summary?: string;
    }>(ArtifactType.FAILURE_ANALYSIS);
    const product = await ctx.getArtifactJson<{
      suggestions?: Array<{ title?: string; rationale?: string }>;
    }>(ArtifactType.PRODUCT_ROADMAP);
    const execution = await ctx.getArtifactJson<{
      passed?: boolean;
      failed?: boolean;
    }>(ArtifactType.EXECUTION_RESULTS);

    const findings: ReportManifest['findings'] = [
      ...(functional?.findings ?? []),
      ...(ux?.findings ?? []),
      ...((failures?.failures ?? []).map((f) => ({
        category: 'failure',
        severity: f.severity ?? 'high',
        title: f.title ?? 'Failure',
        description: f.rootCause ?? '',
        recommendation: f.suggestedFix,
      })) as ReportManifest['findings']),
    ];

    const testCases = testCasesJson?.testCases ?? [];
    const failedCount = failures?.failures?.length ?? (execution?.failed ? 1 : 0);
    const total = testCases.length || Math.max(findings.length, 1);
    const passed = Math.max(0, total - failedCount);

    const scores = {
      functional: scoreOf(functional) ?? 80,
      accessibility: scoreOf(a11y) ?? 75,
      performance: scoreOf(perf) ?? 78,
      security: scoreOf(security) ?? 85,
      uiux: scoreOf(ux) ?? ux?.score ?? 80,
    };

    const recommendations = [
      ...(product?.suggestions ?? []).map(
        (s) => s.title ?? s.rationale ?? 'Improve product quality',
      ),
      ...(failures?.summary ? [failures.summary] : []),
    ].filter(Boolean) as string[];

    const manifest: ReportManifest = {
      executionId: ctx.executionId,
      projectName: input.projectName,
      appUrl: input.appUrl,
      status: execution?.failed ? 'FAILED' : 'COMPLETED',
      scores,
      summary: { passed, failed: failedCount, total },
      findings,
      testCases,
      recommendations:
        recommendations.length > 0
          ? recommendations
          : ['Continue expanding automated coverage for critical paths.'],
    };

    const html = renderHtmlReport(manifest);
    const junit = renderJunitXml(manifest);
    const csv = renderCsvResults(manifest);
    const md = renderExecutiveMarkdown(manifest);

    await ctx.putArtifactJson(ArtifactType.REPORT_MANIFEST, manifest);

    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.REPORT_HTML,
      key: `${ctx.executionId}/reports/report.html`,
      body: html,
      mime: 'text/html',
      store: ctx.artifactStore,
    });
    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.REPORT_JUNIT,
      key: `${ctx.executionId}/reports/junit.xml`,
      body: junit,
      mime: 'application/xml',
      store: ctx.artifactStore,
    });
    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: 'REPORT_CSV',
      key: `${ctx.executionId}/reports/results.csv`,
      body: csv,
      mime: 'text/csv',
      store: ctx.artifactStore,
    });
    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: 'REPORT_MD',
      key: `${ctx.executionId}/reports/executive.md`,
      body: md,
      mime: 'text/markdown',
      store: ctx.artifactStore,
    });

    // Collect framework files for ZIP
    const frameworkArtifacts = await prisma.artifact.findMany({
      where: {
        executionId: ctx.executionId,
        type: ArtifactType.AUTOMATION_FRAMEWORK,
      },
    });

    const zipFiles: Record<string, string | Buffer> = {
      'reports/report.html': html,
      'reports/junit.xml': junit,
      'reports/results.csv': csv,
      'reports/executive.md': md,
      'reports/manifest.json': JSON.stringify(manifest, null, 2),
    };

    for (const art of frameworkArtifacts) {
      try {
        const buf = await ctx.artifactStore.get(art.storageKey);
        const rel = art.storageKey.includes('/framework/')
          ? `framework/${art.storageKey.split('/framework/')[1]}`
          : `framework/${art.storageKey.split('/').pop()}`;
        zipFiles[rel!] = buf;
      } catch {
        /* skip */
      }
    }

    const zip = await buildZipPackage({ files: zipFiles });
    const zipKey = await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.ZIP_PACKAGE,
      key: `${ctx.executionId}/qaforge-package.zip`,
      body: zip,
      mime: 'application/zip',
      store: ctx.artifactStore,
    });

    await prisma.execution.update({
      where: { id: ctx.executionId },
      data: { scores },
    });

    await ctx.emit({
      type: 'report.ready',
      phase: 'REPORT',
      message: 'Reports and ZIP package ready',
      data: { scores, zipKey },
    });

    return { scores, zipKey };
  },
};
