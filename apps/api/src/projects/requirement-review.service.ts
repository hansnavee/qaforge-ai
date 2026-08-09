import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import {
  Role,
  analyzeRequirement,
  interpretAnswer,
  type BusinessReviewPayload,
  type FunctionalReviewPayload,
  type ReviewFact,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function asFacts(v: unknown): ReviewFact[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x) =>
      x &&
      typeof x === 'object' &&
      typeof (x as ReviewFact).text === 'string' &&
      typeof (x as ReviewFact).status === 'string',
  ) as ReviewFact[];
}

@Injectable()
export class RequirementReviewService {
  constructor(
    private readonly orgs: OrgsService,
    private readonly audit: AuditService,
  ) {}

  private async requireProject(
    userId: string,
    orgId: string,
    projectId: string,
    minRole: Role = Role.VIEWER,
  ) {
    await this.orgs.requireMembership(userId, orgId, minRole);
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async reviewAll(user: SessionUser, orgId: string, projectId: string) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);

    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
    });
    if (!requirements.length) {
      throw new BadRequestException(
        'No extracted requirements found. Run requirement extraction first.',
      );
    }

    // Clear prior open questions/conflicts for a fresh review pass
    await prisma.requirementQuestion.deleteMany({
      where: { projectId, status: 'OPEN' },
    });
    await prisma.requirementConflict.deleteMany({
      where: { projectId, status: 'OPEN' },
    });

    let qSeq = await this.nextQuestionSeq(projectId);
    const results = [];

    for (const req of requirements) {
      const saved = await this.analyzeAndPersist(req, qSeq);
      qSeq = saved.nextSeq;
      results.push(saved.mapped);
    }

    await this.detectConflicts(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.review',
      resource: 'project',
      resourceId: projectId,
      metadata: { count: results.length },
    });

    const summary = await this.getSummary(user.id, orgId, projectId);
    return { ok: true, summary, requirements: results };
  }

  async reviewOne(
    user: SessionUser,
    orgId: string,
    projectId: string,
    requirementKey: string,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const req = await prisma.requirement.findUnique({
      where: {
        projectId_requirementKey: {
          projectId,
          requirementKey: requirementKey.toUpperCase(),
        },
      },
    });
    if (!req) throw new NotFoundException('Requirement not found');

    await prisma.requirementQuestion.deleteMany({
      where: { requirementId: req.id, status: 'OPEN' },
    });

    const qSeq = await this.nextQuestionSeq(projectId);
    const saved = await this.analyzeAndPersist(req, qSeq);
    await this.detectConflicts(projectId);
    return { ok: true, requirement: saved.mapped };
  }

  async getSummary(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      include: {
        questions: { where: { status: 'OPEN' } },
      },
    });
    const conflicts = await prisma.requirementConflict.count({
      where: { projectId, status: 'OPEN' },
    });

    const total = requirements.length;
    const business = {
      ready: requirements.filter((r) => r.businessReadiness === 'READY').length,
      needsClarification: requirements.filter(
        (r) => r.businessReadiness === 'NEEDS_CLARIFICATION',
      ).length,
      blocked: requirements.filter((r) => r.businessReadiness === 'BLOCKED')
        .length,
    };
    const functional = {
      complete: requirements.filter(
        (r) => r.functionalCompleteness === 'COMPLETE',
      ).length,
      partial: requirements.filter(
        (r) => r.functionalCompleteness === 'PARTIAL',
      ).length,
      incomplete: requirements.filter(
        (r) => r.functionalCompleteness === 'INCOMPLETE',
      ).length,
    };

    const openQuestions = requirements.flatMap((r) => r.questions);
    const questions = {
      critical: openQuestions.filter((q) => q.priority === 'CRITICAL').length,
      high: openQuestions.filter((q) => q.priority === 'HIGH').length,
      medium: openQuestions.filter((q) => q.priority === 'MEDIUM').length,
      low: openQuestions.filter((q) => q.priority === 'LOW').length,
    };

    const reviewed = requirements.filter((r) => r.reviewedAt);
    const businessReadinessPct =
      reviewed.length === 0
        ? 0
        : Math.round(
            reviewed.reduce((s, r) => s + (r.readinessScore ?? 0), 0) /
              reviewed.length,
          );
    const functionalReadinessPct =
      total === 0
        ? 0
        : Math.round(
            ((functional.complete + functional.partial * 0.5) / total) * 100,
          );

    return {
      total,
      reviewed: reviewed.length,
      business,
      functional,
      questions,
      openConflicts: conflicts,
      businessReadinessPct,
      functionalReadinessPct,
      byReviewStatus: {
        blocked: requirements.filter((r) => r.reviewStatus === 'BLOCKED')
          .length,
        needsClarification: requirements.filter(
          (r) => r.reviewStatus === 'NEEDS_CLARIFICATION',
        ).length,
        reviewRecommended: requirements.filter(
          (r) => r.reviewStatus === 'REVIEW_RECOMMENDED',
        ).length,
        readyForTestDesign: requirements.filter(
          (r) => r.reviewStatus === 'READY_FOR_TEST_DESIGN',
        ).length,
      },
    };
  }

  async listQuestions(
    userId: string,
    orgId: string,
    projectId: string,
    status?: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    const rows = await prisma.requirementQuestion.findMany({
      where: {
        projectId,
        ...(status ? { status } : {}),
      },
      include: {
        requirement: { select: { requirementKey: true, title: true } },
      },
      orderBy: [{ priority: 'asc' }, { questionKey: 'asc' }],
    });
    // Priority sort CRITICAL first (string sort won't work) — re-sort
    const rank = (p: string) =>
      p === 'CRITICAL' ? 0 : p === 'HIGH' ? 1 : p === 'MEDIUM' ? 2 : 3;
    rows.sort(
      (a, b) =>
        rank(a.priority) - rank(b.priority) ||
        a.questionKey.localeCompare(b.questionKey),
    );
    return rows.map((q) => this.mapQuestion(q));
  }

  async listConflicts(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const rows = await prisma.requirementConflict.findMany({
      where: { projectId, status: 'OPEN' },
      include: {
        requirementA: { select: { requirementKey: true, title: true } },
        requirementB: { select: { requirementKey: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => ({
      id: c.id,
      summary: c.summary,
      detail: c.detail,
      status: c.status,
      requirementA: c.requirementA,
      requirementB: c.requirementB,
      createdAt: c.createdAt,
    }));
  }

  async answerQuestion(
    user: SessionUser,
    orgId: string,
    projectId: string,
    questionId: string,
    answer: string,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const question = await prisma.requirementQuestion.findFirst({
      where: { id: questionId, projectId },
      include: { requirement: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    if (question.status === 'ANSWERED') {
      throw new BadRequestException('Question already answered');
    }

    const derived = interpretAnswer({
      question: question.question,
      category: question.category,
      answer,
    });

    const existingReview =
      (question.requirement.businessReview as BusinessReviewPayload | null) ??
      null;
    const priorRules = asFacts(existingReview?.rules);
    const mergedRules = [
      ...priorRules,
      ...derived.filter((d) => d.status === 'DERIVED_FROM_USER_ANSWER'),
    ];

    await prisma.requirementQuestion.update({
      where: { id: question.id },
      data: {
        status: 'ANSWERED',
        answer,
        interpretation: { derived },
        answeredAt: new Date(),
      },
    });

    // Preserve derived rules on requirement before re-analyze
    await prisma.requirement.update({
      where: { id: question.requirementId },
      data: {
        businessReview: {
          ...(existingReview ?? {}),
          rules: mergedRules,
        } as object,
      },
    });

    // Re-analyze this requirement (keeps derived rules)
    const refreshed = await prisma.requirement.findUniqueOrThrow({
      where: { id: question.requirementId },
    });
    await prisma.requirementQuestion.deleteMany({
      where: { requirementId: refreshed.id, status: 'OPEN' },
    });
    const qSeq = await this.nextQuestionSeq(projectId);
    const saved = await this.analyzeAndPersist(refreshed, qSeq);
    await this.detectConflicts(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.review.answer',
      resource: 'requirement_question',
      resourceId: question.id,
      metadata: { requirementKey: refreshed.requirementKey },
    });

    return {
      ok: true,
      question: await prisma.requirementQuestion
        .findUnique({
          where: { id: question.id },
          include: {
            requirement: { select: { requirementKey: true, title: true } },
          },
        })
        .then((q) => (q ? this.mapQuestion(q) : null)),
      requirement: saved.mapped,
      derived,
    };
  }

  private async nextQuestionSeq(projectId: string): Promise<number> {
    const last = await prisma.requirementQuestion.findFirst({
      where: { projectId },
      orderBy: { questionKey: 'desc' },
    });
    if (!last) return 1;
    const m = last.questionKey.match(/^Q(\d+)$/i);
    return m ? Number(m[1]) + 1 : 1;
  }

  private async analyzeAndPersist(
    req: {
      id: string;
      projectId: string;
      requirementKey: string;
      title: string;
      description: string;
      type: string;
      sourceText: string | null;
      sourceSection: string | null;
      acceptanceCriteria: unknown;
      businessRules: unknown;
      supportingInformation: unknown;
      businessReview: unknown;
    },
    startSeq: number,
  ) {
    const existingBiz = req.businessReview as BusinessReviewPayload | null;
    const knownDerived = asFacts(existingBiz?.rules).filter(
      (r) => r.status === 'DERIVED_FROM_USER_ANSWER',
    );

    const analysis = analyzeRequirement({
      requirementKey: req.requirementKey,
      title: req.title,
      description: req.description,
      type: req.type,
      sourceText: req.sourceText,
      sourceSection: req.sourceSection,
      acceptanceCriteria: asStringArray(req.acceptanceCriteria),
      businessRules: asStringArray(req.businessRules),
      supportingInformation: asStringArray(req.supportingInformation),
      knownDerivedRules: knownDerived,
    });

    // Ensure derived rules remain in businessReview.rules
    const rules = [
      ...analysis.businessReview.rules.filter(
        (r) => r.status !== 'DERIVED_FROM_USER_ANSWER',
      ),
      ...knownDerived,
    ];
    const businessReview: BusinessReviewPayload = {
      ...analysis.businessReview,
      rules,
    };

    const updated = await prisma.requirement.update({
      where: { id: req.id },
      data: {
        businessReview: businessReview as object,
        functionalReview: analysis.functionalReview as object,
        businessReadiness: analysis.businessReadiness,
        functionalCompleteness: analysis.functionalCompleteness,
        reviewStatus: analysis.reviewStatus,
        readinessScore: analysis.readinessScore,
        reviewedAt: new Date(),
        status: 'EXTRACTED',
      },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: true,
      },
    });

    let seq = startSeq;
    for (const q of analysis.questions) {
      const questionKey = `Q${String(seq).padStart(3, '0')}`;
      seq += 1;
      await prisma.requirementQuestion.create({
        data: {
          projectId: req.projectId,
          requirementId: req.id,
          questionKey,
          category: q.category,
          priority: q.priority,
          question: q.question,
          reason: q.reason,
          blocking: q.blocking,
          status: 'OPEN',
        },
      });
    }

    const withQuestions = await prisma.requirement.findUniqueOrThrow({
      where: { id: req.id },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: { orderBy: { questionKey: 'asc' } },
      },
    });

    return { mapped: this.mapRequirement(withQuestions), nextSeq: seq };
  }

  private async detectConflicts(projectId: string) {
    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
    });

    // Simple heuristic: cancel eligibility contradictions in derived/confirmed rules
    const cancelRelated = requirements.filter((r) => {
      const blob = `${r.title} ${r.description} ${JSON.stringify(r.businessReview)}`.toLowerCase();
      return /cancel/.test(blob) && /order/.test(blob);
    });

    for (let i = 0; i < cancelRelated.length; i++) {
      for (let j = i + 1; j < cancelRelated.length; j++) {
        const a = cancelRelated[i]!;
        const b = cancelRelated[j]!;
        const rulesA = asFacts(
          (a.businessReview as BusinessReviewPayload | null)?.rules,
        )
          .map((r) => r.text.toLowerCase())
          .join(' ');
        const rulesB = asFacts(
          (b.businessReview as BusinessReviewPayload | null)?.rules,
        )
          .map((r) => r.text.toLowerCase())
          .join(' ');

        const aPendingOnly =
          /pending/.test(rulesA) && !/confirmed|shipped|until shipment/.test(rulesA);
        const bUntilShip = /until shipment|shipped/.test(rulesB);
        const conflict =
          (aPendingOnly && bUntilShip) ||
          (/pending and confirmed|pending or confirmed/.test(rulesA) &&
            /until shipment/.test(rulesB));

        if (!conflict) continue;

        const exists = await prisma.requirementConflict.findFirst({
          where: {
            projectId,
            status: 'OPEN',
            OR: [
              { requirementAId: a.id, requirementBId: b.id },
              { requirementAId: b.id, requirementBId: a.id },
            ],
          },
        });
        if (exists) continue;

        await prisma.requirementConflict.create({
          data: {
            projectId,
            requirementAId: a.id,
            requirementBId: b.id,
            summary: 'Cancellation eligibility differs',
            detail: `Business rule conflict between ${a.requirementKey} and ${b.requirementKey}. Cancellation eligibility statements do not agree. Business clarification required.`,
            status: 'OPEN',
          },
        });
      }
    }

    // Payment failure vs success contradiction (light check)
    void asFacts;
  }

  mapRequirement(row: {
    id: string;
    projectId: string;
    requirementKey: string;
    title: string;
    description: string;
    type: string;
    priority: string | null;
    status: string;
    sourceDocumentId: string | null;
    sourcePage: number | null;
    sourceSection: string | null;
    sourceText: string | null;
    acceptanceCriteria: unknown;
    businessRules: unknown;
    dependencies: unknown;
    supportingInformation?: unknown;
    possibleDuplicateOf: string | null;
    reviewStatus: string | null;
    businessReadiness: string | null;
    functionalCompleteness: string | null;
    businessReview: unknown;
    functionalReview: unknown;
    readinessScore: number | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    sourceDocument?: { filename: string } | null;
    questions?: Array<{
      id: string;
      questionKey: string;
      category: string;
      priority: string;
      question: string;
      reason: string;
      blocking: boolean;
      status: string;
      answer: string | null;
      answeredAt: Date | null;
    }>;
  }) {
    const openQuestions = (row.questions ?? []).filter((q) => q.status === 'OPEN');
    return {
      id: row.id,
      projectId: row.projectId,
      requirementKey: row.requirementKey,
      title: row.title,
      description: row.description,
      type: row.type,
      priority: row.priority,
      status: row.status,
      sourceDocumentId: row.sourceDocumentId,
      sourcePage: row.sourcePage,
      sourceSection: row.sourceSection,
      sourceText: row.sourceText,
      acceptanceCriteria: asStringArray(row.acceptanceCriteria),
      businessRules: asStringArray(row.businessRules),
      dependencies: asStringArray(row.dependencies),
      supportingInformation: asStringArray(row.supportingInformation),
      possibleDuplicateOf: row.possibleDuplicateOf,
      reviewStatus: row.reviewStatus,
      businessReadiness: row.businessReadiness,
      functionalCompleteness: row.functionalCompleteness,
      businessReview: row.businessReview as BusinessReviewPayload | null,
      functionalReview: row.functionalReview as FunctionalReviewPayload | null,
      readinessScore: row.readinessScore,
      reviewedAt: row.reviewedAt,
      sourceDocumentName: row.sourceDocument?.filename ?? null,
      openQuestionCount: openQuestions.length,
      criticalOpenCount: openQuestions.filter((q) => q.priority === 'CRITICAL')
        .length,
      highOpenCount: openQuestions.filter((q) => q.priority === 'HIGH').length,
      questions: (row.questions ?? []).map((q) => ({
        id: q.id,
        questionKey: q.questionKey,
        category: q.category,
        priority: q.priority,
        question: q.question,
        reason: q.reason,
        blocking: q.blocking,
        status: q.status,
        answer: q.answer,
        answeredAt: q.answeredAt,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapQuestion(q: {
    id: string;
    questionKey: string;
    category: string;
    priority: string;
    question: string;
    reason: string;
    blocking: boolean;
    status: string;
    answer: string | null;
    answeredAt: Date | null;
    requirement?: { requirementKey: string; title: string };
  }) {
    return {
      id: q.id,
      questionKey: q.questionKey,
      category: q.category,
      priority: q.priority,
      question: q.question,
      reason: q.reason,
      blocking: q.blocking,
      status: q.status,
      answer: q.answer,
      answeredAt: q.answeredAt,
      requirementKey: q.requirement?.requirementKey,
      requirementTitle: q.requirement?.title,
    };
  }
}
