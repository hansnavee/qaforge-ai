import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  Role,
  createManualRequirementSchema,
  deriveFeatureImpact,
  deriveFeatureStatus,
  extractionAiResponseSchema,
  finalizeExtraction,
  parseRequirementDocument,
  updateManualRequirementSchema,
  type ExtractedRequirementInput,
  type ExtractionDecision,
} from '@qaforge/shared';
import { parseBody } from '../common/parse-body';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';

@Injectable()
export class RequirementExtractionService {
  private readonly llm = new OpenRouterLlmClient();

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
      include: {
        requirements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  mapRequirement(row: {
    id: string;
    projectId: string;
    requirementKey: string;
    title: string;
    description: string;
    type: string;
    primaryType?: string | null;
    secondaryType?: string | null;
    businessImpact?: string | null;
    intentSource?: string | null;
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
    duplicateSimilarity?: number | null;
    duplicateKind?: string | null;
    duplicateReason?: string | null;
    relationships?: unknown;
    featureGroupId?: string | null;
    reviewStatus?: string | null;
    businessReadiness?: string | null;
    functionalCompleteness?: string | null;
    businessReview?: unknown;
    functionalReview?: unknown;
    readinessScore?: number | null;
    reviewedAt?: Date | null;
    analysisStale?: boolean;
    createdAt: Date;
    updatedAt: Date;
    sourceDocument?: { filename: string } | null;
    featureGroup?: {
      id: string;
      featureKey: string;
      name: string;
      businessArea: string | null;
    } | null;
    relationsFrom?: Array<{
      relationType: string;
      toRequirement: { requirementKey: string; title: string };
    }>;
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
    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(String) : [];
    const openQuestions = (row.questions ?? []).filter((q) => q.status === 'OPEN');
    const biz = row.businessReview as { intent?: { text?: string } } | null;

    return {
      id: row.id,
      projectId: row.projectId,
      requirementKey: row.requirementKey,
      title: row.title,
      description: row.description,
      type: row.primaryType ?? row.type,
      primaryType: row.primaryType ?? row.type,
      secondaryType: row.secondaryType ?? null,
      businessImpact: row.businessImpact ?? null,
      intentSource: row.intentSource ?? null,
      businessIntent: biz?.intent?.text ?? null,
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
      // Never expose similarity % — legacy UIs used this as "Possible duplicate (67%)"
      duplicateSimilarity: null,
      duplicateKind: row.duplicateKind ?? null,
      duplicateReason: row.duplicateReason ?? null,
      relationships: Array.isArray(row.relationships) ? row.relationships : [],
      featureGroupId: row.featureGroupId ?? null,
      featureGroup: row.featureGroup
        ? {
            id: row.featureGroup.id,
            featureKey: row.featureGroup.featureKey,
            name: row.featureGroup.name,
            businessArea: row.featureGroup.businessArea,
          }
        : null,
      relatedRequirements: (row.relationsFrom ?? []).map((r) => ({
        relationType: r.relationType,
        requirementKey: r.toRequirement.requirementKey,
        title: r.toRequirement.title,
      })),
      reviewStatus: row.reviewStatus ?? null,
      businessReadiness: row.businessReadiness ?? null,
      functionalCompleteness: row.functionalCompleteness ?? null,
      businessReview: row.businessReview ?? null,
      functionalReview: row.functionalReview ?? null,
      readinessScore: row.readinessScore ?? null,
      reviewedAt: row.reviewedAt ?? null,
      analysisStale: row.analysisStale ?? false,
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
      sourceDocumentName: row.sourceDocument?.filename ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const rows = await prisma.requirement.findMany({
      where: { projectId },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: true,
        featureGroup: true,
        relationsFrom: {
          include: {
            toRequirement: { select: { requirementKey: true, title: true } },
          },
          take: 20,
        },
      },
      orderBy: { requirementKey: 'asc' },
    });
    return rows.map((r) => this.mapRequirement(r));
  }

  async getByKey(
    userId: string,
    orgId: string,
    projectId: string,
    requirementKey: string,
  ) {
    await this.requireProject(userId, orgId, projectId);
    const key = requirementKey.toUpperCase();
    const row = await prisma.requirement.findUnique({
      where: {
        projectId_requirementKey: { projectId, requirementKey: key },
      },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: { orderBy: { questionKey: 'asc' } },
        featureGroup: true,
        relationsFrom: {
          include: {
            toRequirement: { select: { requirementKey: true, title: true } },
          },
          take: 20,
        },
      },
    });
    if (!row) throw new NotFoundException('Requirement not found');
    return this.mapRequirement(row);
  }

  async getExtractionDebug(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const doc = await prisma.requirementDocument.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    const structure = (doc?.documentStructure ?? {}) as {
      sections?: unknown[];
      tables?: unknown[];
      lastExtractionDecisions?: ExtractionDecision[];
      lastExtractionStats?: Record<string, number>;
    };
    return {
      ok: true,
      documentId: doc?.id ?? null,
      stats: structure.lastExtractionStats ?? null,
      decisions: structure.lastExtractionDecisions ?? [],
      sections: structure.sections ?? [],
      tables: structure.tables ?? [],
    };
  }

  async extract(user: SessionUser, orgId: string, projectId: string) {
    const project = await this.requireProject(
      user.id,
      orgId,
      projectId,
      Role.MEMBER,
    );

    const doc = project.requirements[0];
    if (!doc) {
      throw new BadRequestException(
        'No readable requirement content was found. Please upload another document or paste the requirements manually.',
      );
    }

    const sourceText = (doc.originalContent || doc.parsedText || '').trim();
    if (!sourceText) {
      throw new BadRequestException(
        'No readable requirement content was found. Please upload another document or paste the requirements manually.',
      );
    }

    const existing = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
    });

    // AI candidates are NEVER written directly — finalize gate only.
    const aiCandidates = await this.collectAiCandidates(sourceText, doc.filename);
    const finalized = finalizeExtraction({
      sourceText,
      documentName: doc.filename,
      aiCandidates,
    });

    if (process.env.NODE_ENV !== 'production' || process.env.EXTRACTION_DEBUG === 'true') {
      for (const d of finalized.decisions) {
        if (d.decision === 'REJECT') {
          console.debug(
            `[extract] REJECT (${d.reason}): ${d.source?.slice(0, 80) ?? ''}`,
          );
        } else if (d.decision === 'SAVE') {
          console.debug(`[extract] SAVE ${d.requirementKey} ${d.title}`);
        } else if (d.decision === 'MERGE') {
          console.debug(`[extract] MERGE → ${d.intoKey}`);
        } else if (d.decision === 'TABLE_DATA') {
          console.debug('[extract] TABLE → TABLE_DATA');
        } else if (d.decision === 'SECTION_CONTEXT') {
          console.debug(`[extract] SECTION → CONTEXT: ${d.source}`);
        }
      }
    }

    if (!finalized.requirements.length) {
      throw new BadRequestException(
        'No clear requirements were detected. Please check the document or paste the requirements manually.',
      );
    }

    // IDs are assigned only after normalization (REQ-001…). Replace prior set entirely.
    const finals = finalized.requirements;

    await prisma.$transaction(async (tx) => {
      await tx.requirementDocument.update({
        where: { id: doc.id },
        data: {
          documentStructure: {
            sections: finalized.documentElements.sections,
            tables: finalized.documentElements.tables,
            lastExtractionDecisions: finalized.decisions,
            lastExtractionStats: {
              ...finalized.stats,
              previousCount: existing.length,
            },
          },
        },
      });

      await tx.requirement.deleteMany({ where: { projectId } });

      for (const item of finals) {
        await tx.requirement.create({
          data: {
            projectId,
            requirementKey: item.requirementKey,
            title: item.title,
            description: item.description,
            type: item.type,
            priority: item.priority ?? null,
            status: 'EXTRACTED',
            sourceDocumentId: doc.id,
            sourcePage: item.source?.page ?? null,
            sourceSection: item.source?.section ?? null,
            sourceText: item.source?.text ?? item.description,
            acceptanceCriteria: item.acceptanceCriteria,
            businessRules: item.businessRules,
            dependencies: item.dependencies,
            supportingInformation: item.supportingInformation ?? [],
            possibleDuplicateOf: null,
          },
        });
      }
    });

    const savedRows = await prisma.requirement.findMany({
      where: { projectId },
      include: { sourceDocument: { select: { filename: true } } },
      orderBy: { requirementKey: 'asc' },
    });
    const saved = savedRows.map((r) => this.mapRequirement(r));

    const summary = {
      total: saved.length,
      functional: saved.filter((r) => r.type === 'FUNCTIONAL').length,
      nonFunctional: saved.filter((r) => r.type === 'NON_FUNCTIONAL').length,
      businessRules: saved.filter((r) => r.type === 'BUSINESS_RULE').length,
      possibleDuplicates: 0,
      tables: finalized.documentElements.tables.length,
      sections: finalized.documentElements.sections.length,
      rejected: finalized.stats.rejected,
      merged: finalized.stats.merged,
      retitled: finalized.stats.retitled,
      reclassified: finalized.stats.reclassified,
      previousCount: existing.length,
      sourceDocument: doc.filename,
    };

    await prisma.project.update({
      where: { id: projectId },
      data: {
        analysisStatus: 'READY',
        staleRequirementCount: 0,
        analysisError: null,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.extract',
      resource: 'project',
      resourceId: projectId,
      metadata: summary,
    });

    return {
      ok: true,
      summary,
      requirements: saved,
      documentElements: finalized.documentElements,
      // Decision log for extraction debug view / API (not end-user CoT)
      debug: {
        decisions: finalized.decisions,
        stats: finalized.stats,
      },
    };
  }

  async createManual(
    user: SessionUser,
    orgId: string,
    projectId: string,
    body: unknown,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const input = parseBody(createManualRequirementSchema, body);

    const last = await prisma.requirement.findFirst({
      where: { projectId },
      orderBy: { requirementKey: 'desc' },
    });
    let next = 1;
    if (last) {
      const m = last.requirementKey.match(/^REQ-?(\d+)$/i);
      if (m) next = Number(m[1]) + 1;
    }
    const requirementKey = `REQ-${String(next).padStart(3, '0')}`;

    const exists = await prisma.requirement.findUnique({
      where: { projectId_requirementKey: { projectId, requirementKey } },
    });
    if (exists) {
      throw new BadRequestException(`Requirement ID ${requirementKey} already exists`);
    }

    const reqType = input.type ?? 'FUNCTIONAL';
    const row = await prisma.requirement.create({
      data: {
        projectId,
        requirementKey,
        title: input.title,
        description: input.description || input.title,
        type: reqType,
        primaryType: reqType,
        status: 'EXTRACTED',
        sourceText: input.description || input.title,
        analysisStale: false,
      },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: true,
        featureGroup: true,
      },
    });

    await this.markProjectAnalysisStale(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirement.create',
      resource: 'requirement',
      resourceId: row.id,
      metadata: { requirementKey },
    });

    return this.mapRequirement(row);
  }

  async updateManual(
    user: SessionUser,
    orgId: string,
    projectId: string,
    requirementKey: string,
    body: unknown,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const input = parseBody(updateManualRequirementSchema, body);
    const key = requirementKey.toUpperCase();
    const existing = await prisma.requirement.findUnique({
      where: { projectId_requirementKey: { projectId, requirementKey: key } },
    });
    if (!existing) throw new NotFoundException('Requirement not found');

    const wasAnalyzed = Boolean(existing.reviewedAt);
    const row = await prisma.requirement.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.type !== undefined
          ? { type: input.type, primaryType: input.type }
          : {}),
        analysisStale: wasAnalyzed ? true : existing.analysisStale,
      },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: true,
        featureGroup: true,
        relationsFrom: {
          include: {
            toRequirement: { select: { requirementKey: true, title: true } },
          },
          take: 20,
        },
      },
    });

    if (wasAnalyzed) await this.markProjectAnalysisStale(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirement.update',
      resource: 'requirement',
      resourceId: row.id,
      metadata: { requirementKey: key, analysisStale: row.analysisStale },
    });

    return this.mapRequirement(row);
  }

  async deleteManual(
    user: SessionUser,
    orgId: string,
    projectId: string,
    requirementKey: string,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const key = requirementKey.toUpperCase();
    const existing = await prisma.requirement.findUnique({
      where: { projectId_requirementKey: { projectId, requirementKey: key } },
      include: {
        _count: {
          select: {
            questions: true,
            relationsFrom: true,
            relationsTo: true,
          },
        },
        featureGroup: true,
      },
    });
    if (!existing) throw new NotFoundException('Requirement not found');

    const featureGroupId = existing.featureGroupId;

    await prisma.$transaction(async (tx) => {
      await tx.requirementRelation.deleteMany({
        where: {
          OR: [
            { fromRequirementId: existing.id },
            { toRequirementId: existing.id },
          ],
        },
      });
      await tx.requirementConflict.deleteMany({
        where: {
          OR: [
            { requirementAId: existing.id },
            { requirementBId: existing.id },
          ],
        },
      });
      await tx.requirementQuestion.deleteMany({
        where: { requirementId: existing.id },
      });
      await tx.requirement.delete({ where: { id: existing.id } });
    });

    if (featureGroupId) {
      const remaining = await prisma.requirement.count({
        where: { featureGroupId },
      });
      if (remaining === 0) {
        await prisma.featureGroup.delete({ where: { id: featureGroupId } }).catch(() => undefined);
      } else {
        // Refresh feature status from remaining requirements
        const siblings = await prisma.requirement.findMany({
          where: { featureGroupId },
          select: { reviewStatus: true, businessImpact: true },
        });
        await prisma.featureGroup.update({
          where: { id: featureGroupId },
          data: {
            reviewStatus: deriveFeatureStatus(
              siblings.map((s) => s.reviewStatus),
            ),
            businessImpact: deriveFeatureImpact(
              siblings.map((s) => s.businessImpact),
            ),
          },
        });
      }
    }

    await this.markProjectAnalysisStale(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirement.delete',
      resource: 'requirement',
      resourceId: existing.id,
      metadata: {
        requirementKey: key,
        questions: existing._count.questions,
        relations:
          existing._count.relationsFrom + existing._count.relationsTo,
      },
    });

    return {
      ok: true,
      requirementKey: key,
      removed: {
        questions: existing._count.questions,
        relationships:
          existing._count.relationsFrom + existing._count.relationsTo,
        featureGroup: existing.featureGroup?.name ?? null,
      },
    };
  }

  /**
   * Wipe extracted requirements, source docs, review artifacts, and Stage 1–10
   * approval stamps so the project can start STLC Requirements fresh.
   */
  async clearAllRequirements(
    user: SessionUser,
    orgId: string,
    projectId: string,
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);

    const before = await prisma.requirement.count({ where: { projectId } });
    const docsBefore = await prisma.requirementDocument.count({
      where: { projectId },
    });

    await prisma.$transaction(async (tx) => {
      await tx.requirementRelation.deleteMany({ where: { projectId } });
      await tx.requirementConflict.deleteMany({ where: { projectId } });
      await tx.requirementQuestion.deleteMany({ where: { projectId } });
      await tx.requirement.deleteMany({ where: { projectId } });
      await tx.featureGroup.deleteMany({ where: { projectId } });
      await tx.requirementDocument.deleteMany({ where: { projectId } });
      await tx.projectRequirementSnapshot.deleteMany({ where: { projectId } });
      await tx.clarificationRound.deleteMany({ where: { projectId } });
      await tx.project.update({
        where: { id: projectId },
        data: {
          status: 'DRAFT',
          analysisStatus: 'NOT_STARTED',
          analysisStartedAt: null,
          analysisCompletedAt: null,
          analysisError: null,
          analysisId: null,
          analysisVersion: null,
          analysisEngine: null,
          analysisMeta: null as never,
          staleRequirementCount: 0,
          requirementText: null,
          requirementsApprovedAt: null,
          requirementsApprovedBy: null,
          testPlanApprovedAt: null,
          testPlanApprovedBy: null,
          testDesignApprovedAt: null,
          testDesignApprovedBy: null,
          environmentApprovedAt: null,
          environmentApprovedBy: null,
          testDataApprovedAt: null,
          testDataApprovedBy: null,
          testExecutionApprovedAt: null,
          testExecutionApprovedBy: null,
          defectsApprovedAt: null,
          defectsApprovedBy: null,
          regressionApprovedAt: null,
          regressionApprovedBy: null,
          automationApprovedAt: null,
          automationApprovedBy: null,
          reportApprovedAt: null,
          reportApprovedBy: null,
          qaSignedOffAt: null,
          qaSignedOffBy: null,
          stlcPhaseDocs: null as never,
          stlcStage: 'REQUIREMENTS',
        },
      });
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.clear',
      resource: 'project',
      resourceId: projectId,
      metadata: { requirementsRemoved: before, documentsRemoved: docsBefore },
    });

    return {
      ok: true,
      removed: {
        requirements: before,
        documents: docsBefore,
      },
      stlcStage: 'REQUIREMENTS',
      analysisStatus: 'NOT_STARTED',
    };
  }

  private async markProjectAnalysisStale(projectId: string) {
    const staleCount = await prisma.requirement.count({
      where: { projectId, analysisStale: true },
    });
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { analysisStatus: true },
    });
    if (!project) return;
    if (
      project.analysisStatus === 'COMPLETED' ||
      project.analysisStatus === 'STALE' ||
      project.analysisStatus === 'FAILED'
    ) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          analysisStatus: 'STALE',
          staleRequirementCount: Math.max(staleCount, 1),
          requirementsApprovedAt: null,
          requirementsApprovedBy: null,
          testPlanApprovedAt: null,
          testPlanApprovedBy: null,
          testDesignApprovedAt: null,
          testDesignApprovedBy: null,
          testDataApprovedAt: null,
          testDataApprovedBy: null,
          testExecutionApprovedAt: null,
          testExecutionApprovedBy: null,
          defectsApprovedAt: null,
          defectsApprovedBy: null,
          regressionApprovedAt: null,
          regressionApprovedBy: null,
          automationApprovedAt: null,
          automationApprovedBy: null,
          qaSignedOffAt: null,
          qaSignedOffBy: null,
          stlcStage: 'REQUIREMENTS',
        },
      });
    } else if (project.analysisStatus === 'NOT_STARTED') {
      // leave
    } else {
      await prisma.project.update({
        where: { id: projectId },
        data: { staleRequirementCount: staleCount },
      });
    }
  }

  /**
   * Collect AI candidates only — never persisted until finalizeExtraction.
   */
  private async collectAiCandidates(
    sourceText: string,
    documentName: string,
  ): Promise<ExtractedRequirementInput[]> {
    try {
      return await this.callLlm(sourceText, documentName);
    } catch {
      return [];
    }
  }

  private async callLlm(
    sourceText: string,
    documentName: string,
  ): Promise<ExtractedRequirementInput[]> {
    const parsedDoc = parseRequirementDocument(sourceText);
    const structured = JSON.stringify(
      {
        document: documentName,
        elements: parsedDoc.elements,
        sectionHierarchy: parsedDoc.sections.map((s) => s.title),
      },
      null,
      2,
    ).slice(0, 60_000);

    const llm = await this.llm.complete({
      system: `You extract CANDIDATE software requirements from a PARSED document.

Return candidates only. A server-side quality gate will reject invalid ones.

Hard rules:
- Never return HEADING text as a candidate (including markdown # headings).
- Never return TABLE headers or rows as candidates.
- Never return Acceptance Criteria labels or individual AC bullets as candidates; attach them to parent acceptanceCriteria.
- Never return isolated formatting fragments or incomplete sentences ending with ':'.
- Section titles alone are not candidates.
- Prefer fewer accurate candidates over many fragments.
- sourceText must be the full original statement.
- requirementKey format: REQ-001, REQ-002, ...`,
      prompt: `Parsed document JSON:
${structured}

Return JSON only:
{
  "requirements": [
    {
      "requirementKey": "REQ-001",
      "title": "User Registration",
      "description": "full meaningful description",
      "type": "FUNCTIONAL",
      "priority": null,
      "section": "User Registration",
      "acceptanceCriteria": [],
      "businessRules": [],
      "dependencies": [],
      "supportingInformation": [],
      "sourceText": "exact full source statement"
    }
  ]
}`,
      json: true,
      model: 'fast',
    });

    let raw: unknown;
    try {
      raw = JSON.parse(llm.text);
    } catch {
      throw new Error('Invalid JSON from AI');
    }

    const validated = extractionAiResponseSchema.safeParse(raw);
    if (!validated.success) {
      throw new Error('AI response failed validation');
    }

    return validated.data.requirements.map((r) => ({
      ...r,
      supportingInformation: r.supportingInformation ?? [],
      source: {
        document: documentName,
        page: null,
        section: r.section ?? r.source?.section ?? null,
        text: r.sourceText || r.source?.text || r.description,
      },
      sourceText: r.sourceText || r.source?.text || r.description,
    }));
  }
}
