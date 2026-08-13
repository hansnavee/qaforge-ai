import { prisma } from '@qaforge/database';
import { buildTcmsTcrHtml } from '@qaforge/report-engine';
import {
  ArtifactType,
  QA_TOOL_PROVIDER,
  classifyAgainstExisting,
  type QaTestCase,
  type QaTestCaseInput,
  type QaToolContext,
  type QaToolProvider,
} from '@qaforge/shared';
import { buildTcrPayload } from '../phase1/tcms-support.js';

/**
 * Internal TCMS as the default QA tool provider (Agent → tools → TCMS).
 * Upsert uses the shared case fingerprint so AI phases do not clone coverage.
 */
export function createInternalTcmsProvider(): QaToolProvider {
  return {
    id: QA_TOOL_PROVIDER.INTERNAL_TCMS,
    requirement: {
      async list(ctx: QaToolContext) {
        const rows = await prisma.requirement.findMany({
          where: { projectId: ctx.projectId },
          orderBy: { requirementKey: 'asc' },
          take: 200,
          select: {
            id: true,
            requirementKey: true,
            title: true,
            description: true,
          },
        });
        return rows.map((r) => ({
          id: r.id,
          key: r.requirementKey,
          title: r.title,
          description: r.description,
        }));
      },
    },
    testcase: {
      async list(ctx: QaToolContext): Promise<QaTestCase[]> {
        const rows = await prisma.testCase.findMany({
          where: { projectId: ctx.projectId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        return rows.map((r) => ({
          id: r.id,
          externalId: r.externalId,
          scenario: r.scenario,
          module: r.module,
          designTechnique: r.designTechnique,
          requirementKey: r.requirementKey,
          preconditions: r.preconditions,
          steps: Array.isArray(r.steps) ? (r.steps as string[]) : [],
          expected: r.expected,
          priorityLabel: (r.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW') ?? 'MEDIUM',
          type: r.type,
          testData:
            r.testData && typeof r.testData === 'object'
              ? (r.testData as Record<string, string>)
              : null,
        }));
      },
      async upsert(ctx, input: QaTestCaseInput) {
        const existing = await prisma.testCase.findMany({
          where: { projectId: ctx.projectId, deletedAt: null },
          select: {
            id: true,
            scenario: true,
            module: true,
            designTechnique: true,
            requirementKey: true,
            steps: true,
            expected: true,
            externalId: true,
          },
        });
        const exclude = new Set(input.excludeIds ?? []);
        let hit: { disposition: 'new' | 'updateCandidate'; matchId: string | null } =
          input.forceCreate
            ? { disposition: 'new', matchId: null }
            : { disposition: 'new', matchId: null };

        if (!input.forceCreate && input.preferredId && !exclude.has(input.preferredId)) {
          const preferred = existing.find((c) => c.id === input.preferredId);
          if (preferred) {
            hit = { disposition: 'updateCandidate', matchId: preferred.id };
          }
        }
        if (!hit.matchId && !input.forceCreate && input.externalId?.trim()) {
          const byExt = existing.find(
            (c) =>
              !exclude.has(c.id) &&
              c.externalId.toLowerCase() ===
                input.externalId!.trim().toLowerCase(),
          );
          if (byExt) {
            hit = { disposition: 'updateCandidate', matchId: byExt.id };
          }
        }
        if (!hit.matchId && !input.forceCreate) {
          const classified = classifyAgainstExisting({
            candidate: input,
            existing: existing.map((c) => ({
              id: c.id,
              scenario: c.scenario,
              module: c.module,
              designTechnique: c.designTechnique,
              requirementKey: c.requirementKey,
              steps: Array.isArray(c.steps) ? (c.steps as string[]) : [],
              expected: c.expected,
            })),
            usedIds: exclude,
          });
          hit = {
            disposition:
              classified.disposition === 'new' ? 'new' : 'updateCandidate',
            matchId: classified.matchId,
          };
        }

        if (hit.matchId) {
          const updated = await prisma.testCase.update({
            where: { id: hit.matchId },
            data: {
              scenario: input.scenario.trim(),
              module: input.module ?? 'General',
              designTechnique: input.designTechnique ?? null,
              requirementKey: input.requirementKey ?? null,
              preconditions: input.preconditions ?? '',
              steps: (input.steps ?? []) as never,
              expected: input.expected.trim(),
              priorityLabel: input.priorityLabel ?? 'MEDIUM',
              type: input.type ?? 'functional',
              testData: (input.testData ?? null) as never,
              caseStatus: 'DRAFT',
              readyForExecution: false,
            },
          });
          return {
            created: false,
            updated: true,
            case: {
              id: updated.id,
              externalId: updated.externalId,
              scenario: updated.scenario,
              module: updated.module,
              designTechnique: updated.designTechnique,
              requirementKey: updated.requirementKey,
              preconditions: updated.preconditions,
              steps: Array.isArray(updated.steps)
                ? (updated.steps as string[])
                : [],
              expected: updated.expected,
              priorityLabel:
                (updated.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW') ?? 'MEDIUM',
              type: updated.type,
              testData:
                updated.testData && typeof updated.testData === 'object'
                  ? (updated.testData as Record<string, string>)
                  : null,
            },
          };
        }

        const count = await prisma.testCase.count({
          where: { projectId: ctx.projectId },
        });
        const created = await prisma.testCase.create({
          data: {
            projectId: ctx.projectId,
            externalId:
              input.externalId?.trim() ||
              `TC-${String(count + 1).padStart(3, '0')}`,
            scenario: input.scenario.trim(),
            module: input.module ?? 'General',
            designTechnique: input.designTechnique ?? null,
            requirementKey: input.requirementKey ?? null,
            preconditions: input.preconditions ?? '',
            steps: (input.steps ?? []) as never,
            expected: input.expected.trim(),
            priorityLabel: input.priorityLabel ?? 'MEDIUM',
            type: input.type ?? 'functional',
            testData: (input.testData ?? null) as never,
            caseStatus: 'DRAFT',
            readyForExecution: false,
            designMode: 'GENERIC',
          },
        });
        return {
          created: true,
          updated: false,
          case: {
            id: created.id,
            externalId: created.externalId,
            scenario: created.scenario,
            module: created.module,
            designTechnique: created.designTechnique,
            requirementKey: created.requirementKey,
            preconditions: created.preconditions,
            steps: Array.isArray(created.steps)
              ? (created.steps as string[])
              : [],
            expected: created.expected,
            priorityLabel:
              (created.priorityLabel as 'HIGH' | 'MEDIUM' | 'LOW') ?? 'MEDIUM',
            type: created.type,
            testData:
              created.testData && typeof created.testData === 'object'
                ? (created.testData as Record<string, string>)
                : null,
          },
        };
      },
    },
    defect: {
      async create(ctx, input) {
        const created = await prisma.bug.create({
          data: {
            projectId: ctx.projectId,
            executionId: input.executionId ?? null,
            testCaseId: input.testCaseId ?? null,
            title: input.title.trim(),
            description: input.description ?? '',
            severity: input.severity ?? 'medium',
            externalRef: input.externalRef ?? null,
          },
        });
        return {
          id: created.id,
          title: created.title,
          description: created.description,
          severity: created.severity,
          testCaseId: created.testCaseId ?? undefined,
          executionId: created.executionId ?? undefined,
          externalRef: created.externalRef ?? undefined,
        };
      },
    },
    report: {
      async generate(ctx, executionId) {
        const project = await prisma.project.findFirst({
          where: { id: ctx.projectId },
          select: { name: true },
        });
        const payload = await buildTcrPayload(
          ctx.projectId,
          project?.name ?? 'Project',
          [executionId],
        );
        const pack = buildTcmsTcrHtml(payload);
        const body = Buffer.from(pack.body, 'utf8');
        const key = `${executionId}/reports/${pack.filename}`;
        await prisma.artifact.create({
          data: {
            executionId,
            type: ArtifactType.REPORT_HTML,
            storageKey: key,
            mime: pack.contentType,
            size: body.length,
          },
        });
        await prisma.artifactBlob.upsert({
          where: { storageKey: key },
          create: {
            storageKey: key,
            mime: pack.contentType,
            size: body.length,
            body: body as never,
          },
          update: {
            mime: pack.contentType,
            size: body.length,
            body: body as never,
          },
        });
        return {
          url: `/api/v1/orgs/${ctx.orgId}/projects/${ctx.projectId}/tcms/runs/${executionId}/tcr?format=html`,
        };
      },
    },
  };
}
