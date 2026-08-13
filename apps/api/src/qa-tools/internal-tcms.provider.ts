import { prisma } from '@qaforge/database';
import {
  QA_TOOL_PROVIDER,
  classifyAgainstExisting,
  type QaTestCase,
  type QaTestCaseInput,
  type QaToolContext,
  type QaToolProvider,
} from '@qaforge/shared';

/**
 * Internal TCMS as the default QA tool provider (Agent → tools → TCMS).
 * Upsert uses the shared case fingerprint so AI phases do not clone coverage.
 */
export function createInternalTcmsProvider(): QaToolProvider {
  return {
    id: QA_TOOL_PROVIDER.INTERNAL_TCMS,
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
        const hit = input.forceCreate
          ? { disposition: 'new' as const, matchId: null }
          : classifyAgainstExisting({
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
            });

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
  };
}
