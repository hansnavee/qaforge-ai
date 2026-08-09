import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '@qaforge/database';
import {
  Role,
  analyzeRequirement,
  computeReadinessScore,
  detectBusinessConflicts,
  detectSemanticRelations,
  toCanonicalRelationships,
  detectRequirementRelations,
  dedupeQuestionsAgainstExisting,
  FEATURE_DEPENDENCY_EDGES,
  deriveStatuses,
  generateSemanticTitle,
  groupRequirementsIntoFeatures,
  interpretAnswer,
  isTruncatedTitle,
  mergeAiIntoAnalysis,
  titleAgreesWithBody,
  questionBucket,
  summarizeFeature,
  SEMANTIC_ANALYSIS_ENGINE,
  SEMANTIC_ANALYSIS_VERSION,
  type AiRequirementIntelligence,
  type BusinessReviewPayload,
  type FunctionalReviewPayload,
  type RequirementRelationship,
  type ReviewFact,
  type StructuredRequirementSemantics,
} from '@qaforge/shared';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';
import { extractStructuredSemanticsBatch } from './structured-semantic-extract';
import {
  extractAiFeatureGroups,
  extractAiRequirementIntelligence,
} from './ai-review-intelligence-extract';

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
  private readonly logger = new Logger(RequirementReviewService.name);
  private readonly llm = new OpenRouterLlmClient();
  /** Per-run structured semantics (LLM + heuristic), keyed by requirementKey */
  private structuredByKey = new Map<string, StructuredRequirementSemantics>();
  /** Per-run AI review intelligence (intent/impact/questions), keyed by requirementKey */
  private aiIntelByKey = new Map<string, AiRequirementIntelligence>();
  /** True when feature groups came from AI (skip ecommerce FEATURE_DEPENDENCY_EDGES) */
  private usedAiFeatureGrouping = false;

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
    const project = await this.requireProject(
      user.id,
      orgId,
      projectId,
      Role.MEMBER,
    );

    if (project.analysisStatus === 'RUNNING') {
      throw new BadRequestException(
        'Analysis is already running. Please wait for it to finish.',
      );
    }

    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
    });
    if (!requirements.length) {
      throw new BadRequestException(
        'No extracted requirements found. Run requirement extraction first.',
      );
    }

    await prisma.project.update({
      where: { id: projectId },
      data: {
        analysisStatus: 'RUNNING',
        analysisStartedAt: new Date(),
        analysisError: null,
      },
    });

    try {
      return await this.runReviewAll(user, orgId, projectId, requirements);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Analysis failed unexpectedly';
      await prisma.project.update({
        where: { id: projectId },
        data: {
          analysisStatus: 'FAILED',
          analysisError: message,
        },
      });
      throw err;
    }
  }

  private async runReviewAll(
    user: SessionUser,
    orgId: string,
    projectId: string,
    requirements: Array<{
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
      featureGroupId: string | null;
    }>,
  ) {
    // Fresh review pass — keep ANSWERED questions for provenance; clear OPEN
    await prisma.requirementQuestion.deleteMany({
      where: { projectId, status: 'OPEN' },
    });
    await prisma.requirementConflict.deleteMany({
      where: { projectId, status: 'OPEN' },
    });
    await prisma.requirementRelation.deleteMany({ where: { projectId } });
    await prisma.featureGroup.deleteMany({ where: { projectId } });
    // Invalidate ALL legacy duplicate fields so stale similarity % cannot resurface
    await prisma.requirement.updateMany({
      where: { projectId },
      data: {
        featureGroupId: null,
        possibleDuplicateOf: null,
        duplicateSimilarity: null,
        duplicateKind: null,
        duplicateReason: null,
        relationships: [],
      },
    });

    const analysisId = `ANL-${randomUUID().slice(0, 8)}`;
    await prisma.project.update({
      where: { id: projectId },
      data: {
        analysisId,
        analysisVersion: SEMANTIC_ANALYSIS_VERSION,
        analysisEngine: SEMANTIC_ANALYSIS_ENGINE,
        analysisMeta: {
          status: 'RUNNING',
          engine: SEMANTIC_ANALYSIS_ENGINE,
          version: SEMANTIC_ANALYSIS_VERSION,
          startedAt: new Date().toISOString(),
        },
      },
    });

    // Repair truncated / section-mismatched titles before grouping + relationships.
    // Derive from description only (null section) so headings like "Mobile Support"
    // cannot retitle an email-uniqueness body.
    for (const r of requirements) {
      const improved = generateSemanticTitle(
        r.description,
        null,
        (r.type as 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'BUSINESS_RULE') ||
          'FUNCTIONAL',
      );
      if (
        improved &&
        improved !== 'Requirement' &&
        improved !== r.title &&
        (isTruncatedTitle(r.title) ||
          !titleAgreesWithBody(r.title, r.description) ||
          improved.length < r.title.length)
      ) {
        await prisma.requirement.update({
          where: { id: r.id },
          data: { title: improved },
        });
        r.title = improved;
      }
    }

    // Feature grouping — AI-first (domain-agnostic), heuristic fallback
    const groupable = requirements.map((r) => ({
      requirementKey: r.requirementKey,
      title: r.title,
      description: r.description,
      sourceSection: r.sourceSection,
      sourceText: r.sourceText,
      type: r.type,
    }));
    const aiFeatureDrafts = await extractAiFeatureGroups({
      requirements: groupable,
      llm: this.llm,
      logger: this.logger,
    });
    this.usedAiFeatureGrouping = !!aiFeatureDrafts?.length;
    const featureDrafts =
      aiFeatureDrafts ?? groupRequirementsIntoFeatures(groupable);
    this.logger.log(
      `Feature grouping: ${featureDrafts.length} features via ${
        this.usedAiFeatureGrouping ? 'AI' : 'heuristic fallback'
      }`,
    );

    // AI requirement intelligence (intent / impact / gaps / questions)
    this.aiIntelByKey = await extractAiRequirementIntelligence({
      requirements: groupable,
      llm: this.llm,
      logger: this.logger,
    });

    const featureIdByKey = new Map<string, string>();
    const featureNameToId = new Map<string, string>();
    const featureNameToReqKeys = new Map<string, string[]>();
    for (const fg of featureDrafts) {
      const created = await prisma.featureGroup.create({
        data: {
          projectId,
          featureKey: fg.featureKey,
          name: fg.name,
          businessArea: fg.businessArea,
          businessCapability: fg.businessCapability ?? null,
          businessIntent: fg.businessIntent ?? null,
          businessImpact: 'MEDIUM',
          featureRisk: null,
          featureRiskReason: null,
          reviewStatus: null,
          analysis: {
            dependsOn: [],
            affects: [],
            relatedTo: [],
          },
        },
      });
      featureIdByKey.set(fg.featureKey, created.id);
      featureNameToId.set(fg.name, created.id);
      featureNameToReqKeys.set(fg.name, fg.requirementKeys);
      for (const reqKey of fg.requirementKeys) {
        await prisma.requirement.updateMany({
          where: { projectId, requirementKey: reqKey },
          data: { featureGroupId: created.id },
        });
      }
    }

    // Legacy ecommerce journey edges — only when heuristic feature names are used.
    // AI grouping is domain-agnostic and must not depend on static feature catalogs.
    const keyToId = new Map(requirements.map((r) => [r.requirementKey, r.id]));
    if (!this.usedAiFeatureGrouping) {
      for (const [fromName, toName] of FEATURE_DEPENDENCY_EDGES) {
        const fromFeatureId = featureNameToId.get(fromName);
        const toFeatureId = featureNameToId.get(toName);
        if (!fromFeatureId || !toFeatureId) continue;
        const fromKeys = featureNameToReqKeys.get(fromName) ?? [];
        const toKeys = featureNameToReqKeys.get(toName) ?? [];
        const fromReqId = keyToId.get(fromKeys[0] ?? '');
        const toReqId = keyToId.get(toKeys[0] ?? '');
        await prisma.featureGroup.update({
          where: { id: fromFeatureId },
          data: {
            analysis: {
              dependsOn: [toName],
              affects: [],
              relatedTo: [],
            },
          },
        });
        if (fromReqId && toReqId) {
          try {
            await prisma.requirementRelation.create({
              data: {
                projectId,
                fromRequirementId: fromReqId,
                toRequirementId: toReqId,
                relationType: 'DEPENDS_ON',
                confidence: 0.9,
                source: 'REVIEW',
                detail: `${fromName} DEPENDS_ON ${toName}`,
              },
            });
          } catch {
            // unique — ignore
          }
        }
      }
    }

    // Semantic relations (never delete/merge; similarity is never primary)
    const featureMetaByReq = new Map<
      string,
      { featureName: string; businessArea: string }
    >();
    for (const fg of featureDrafts) {
      for (const rk of fg.requirementKeys) {
        featureMetaByReq.set(rk, {
          featureName: fg.name,
          businessArea: fg.businessArea,
        });
      }
    }
    // Step 2.5 — structured semantic extraction (LLM when available, else heuristic)
    this.structuredByKey = await extractStructuredSemanticsBatch({
      requirements: requirements.map((r) => ({
        requirementKey: r.requirementKey,
        title: r.title,
        description: r.description,
        sourceText: r.sourceText,
        type: r.type,
      })),
      llm: this.llm,
      logger: this.logger,
    });
    const accepted = [...this.structuredByKey.values()].filter(
      (s) => !s.uncertain && s.confidence >= 0.85,
    ).length;
    this.logger.log(
      `Structured semantics: ${accepted}/${requirements.length} accepted (≥0.85); engine uses structured actor/action/object/capability for relationships`,
    );

    const comparable = requirements.map((r) => ({
      requirementKey: r.requirementKey,
      title: r.title,
      description: r.description,
      sourceText: r.sourceText,
      featureName: featureMetaByReq.get(r.requirementKey)?.featureName,
      businessArea: featureMetaByReq.get(r.requirementKey)?.businessArea,
      type: r.type,
      structured: this.structuredByKey.get(r.requirementKey) ?? null,
    }));
    // Canonical semantic relationships (source of truth for API + UI)
    const canonical = toCanonicalRelationships(comparable);
    if (process.env.NODE_ENV !== 'production') {
      const sampleKeys = [
        'REQ-032',
        'REQ-014',
        'REQ-034',
        'REQ-035',
        'REQ-033',
        'REQ-027',
        'REQ-026',
        'REQ-011',
        'REQ-010',
      ];
      for (const key of sampleKeys) {
        const hits = canonical.filter(
          (r) =>
            r.sourceRequirementId === key || r.targetRequirementId === key,
        );
        if (!hits.length) continue;
        this.logger.debug(
          `ANALYSIS DEBUG ${key} → ${hits
            .map(
              (h) =>
                `${h.relationship} ${h.sourceRequirementId === key ? h.targetRequirementId : h.sourceRequirementId}`,
            )
            .join(' | ')}`,
        );
      }
    }
    const relsByKey = new Map<string, RequirementRelationship[]>();
    for (const rel of canonical) {
      const list = relsByKey.get(rel.sourceRequirementId) ?? [];
      list.push(rel);
      relsByKey.set(rel.sourceRequirementId, list);
      // Mirror onto target for bidirectional UI lookup
      const mirror: RequirementRelationship = {
        ...rel,
        sourceRequirementId: rel.targetRequirementId,
        targetRequirementId: rel.sourceRequirementId,
      };
      const listB = relsByKey.get(rel.targetRequirementId) ?? [];
      listB.push(mirror);
      relsByKey.set(rel.targetRequirementId, listB);
    }

    for (const [reqKey, rels] of relsByKey) {
      const reqId = keyToId.get(reqKey);
      if (!reqId) continue;

      // Legacy soft-flags ONLY for true/possible duplicates — never for RELATED.
      // (Old UIs treated possibleDuplicateOf as "Possible duplicate (N%)".)
      const dupLike = rels.find(
        (r) =>
          r.relationship === 'DUPLICATE' ||
          r.relationship === 'POSSIBLE_DUPLICATE',
      );
      const related = rels.find(
        (r) =>
          r.relationship === 'RELATED' ||
          r.relationship === 'SEQUENTIAL' ||
          r.relationship === 'PRECEDES' ||
          r.relationship === 'BUSINESS_RULE_CONSTRAINT' ||
          r.relationship === 'CONFLICT' ||
          r.relationship === 'CONFLICTS_WITH' ||
          r.relationship === 'DEPENDS_ON',
      );
      // Persist only positive relationships (missing edge = independent)
      const positiveRels = rels.filter(
        (r) => r.relationship !== 'NOT_DUPLICATE',
      );

      await prisma.requirement.update({
        where: { id: reqId },
        data: {
          relationships: positiveRels as object[],
          possibleDuplicateOf: dupLike?.targetRequirementId ?? null,
          duplicateSimilarity: null,
          duplicateKind: dupLike
            ? dupLike.relationship
            : related
              ? related.relationship
              : null,
          duplicateReason:
            dupLike?.reason ?? related?.reason ?? positiveRels[0]?.reason ?? null,
        },
      });
    }

    const semanticPairs = detectSemanticRelations(comparable);
    for (const pair of semanticPairs) {
      const aId = keyToId.get(pair.requirementKeyA);
      const bId = keyToId.get(pair.requirementKeyB);
      if (!aId || !bId) continue;
      if (pair.kind === 'NOT_DUPLICATE' || pair.kind === 'NOT_RELATED') {
        continue;
      }

      const relationType =
        pair.relationType === 'PRECEDES'
          ? 'PRECEDES'
          : pair.kind === 'DUPLICATE'
            ? 'DUPLICATE_OF'
            : pair.kind === 'POSSIBLE_DUPLICATE'
              ? 'OVERLAPS'
              : pair.kind === 'DEPENDS_ON'
                ? 'DEPENDS_ON'
                : 'RELATED_TO';

      try {
        await prisma.requirementRelation.create({
          data: {
            projectId,
            fromRequirementId:
              pair.relationType === 'PRECEDES' ? aId : bId,
            toRequirementId: pair.relationType === 'PRECEDES' ? bId : aId,
            relationType,
            confidence: null,
            source: 'REVIEW',
            detail: pair.reason,
          },
        });
      } catch {
        // unique — ignore
      }
    }

    // Reload with feature assignment
    const refreshed = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
      include: { featureGroup: true },
    });

    let qSeq = await this.nextQuestionSeq(projectId);
    const answered = await prisma.requirementQuestion.findMany({
      where: { projectId, status: 'ANSWERED' },
    });
    const existingTexts = answered.map((q) => q.question);
    const results = [];

    for (const req of refreshed) {
      const saved = await this.analyzeAndPersist(req, qSeq, existingTexts);
      qSeq = saved.nextSeq;
      for (const q of saved.createdQuestions) {
        existingTexts.push(q.question);
      }
      results.push(saved.mapped);
    }

    // Typed relationships
    const featureNameByReq = new Map(
      refreshed.map((r) => [
        r.requirementKey,
        r.featureGroup?.name ?? null,
      ]),
    );
    const relDrafts = detectRequirementRelations(
      refreshed.map((r) => ({
        requirementKey: r.requirementKey,
        title: r.title,
        description: r.description,
        sourceText: r.sourceText,
        featureName: featureNameByReq.get(r.requirementKey),
      })),
    );
    for (const rel of relDrafts) {
      const fromId = keyToId.get(rel.fromKey);
      const toId = keyToId.get(rel.toKey);
      if (!fromId || !toId) continue;
      try {
        await prisma.requirementRelation.create({
          data: {
            projectId,
            fromRequirementId: fromId,
            toRequirementId: toId,
            relationType: rel.relationType,
            confidence: rel.confidence,
            source: 'REVIEW',
            detail: rel.detail ?? null,
          },
        });
      } catch {
        // unique constraint — ignore
      }
    }

    await this.detectConflicts(projectId);
    await this.refreshFeatureStatuses(projectId);

    await prisma.requirement.updateMany({
      where: { projectId },
      data: { analysisStale: false },
    });

    const completedAt = new Date();
    await prisma.project.update({
      where: { id: projectId },
      data: {
        analysisStatus: 'COMPLETED',
        analysisCompletedAt: completedAt,
        analysisError: null,
        staleRequirementCount: 0,
        analysisId,
        analysisVersion: SEMANTIC_ANALYSIS_VERSION,
        analysisEngine: SEMANTIC_ANALYSIS_ENGINE,
        analysisMeta: {
          status: 'COMPLETED',
          engine: SEMANTIC_ANALYSIS_ENGINE,
          version: SEMANTIC_ANALYSIS_VERSION,
          analysisId,
          analyzedAt: completedAt.toISOString(),
          relationshipCount: canonical.length,
          relationships: canonical,
          structuredSemantics: {
            total: this.structuredByKey.size,
            accepted: [...this.structuredByKey.values()].filter(
              (s) => !s.uncertain && s.confidence >= 0.85,
            ).length,
            uncertain: [...this.structuredByKey.values()].filter(
              (s) => s.uncertain || s.confidence < 0.85,
            ).length,
            llmEnabled: Boolean(process.env.OPENROUTER_API_KEY),
          },
          aiReviewIntelligence: {
            llmEnabled: Boolean(process.env.OPENROUTER_API_KEY),
            featureGrouping: this.usedAiFeatureGrouping ? 'ai' : 'heuristic',
            requirementIntelligenceAccepted: this.aiIntelByKey.size,
            requirementIntelligenceTotal: requirements.length,
          },
        },
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.review',
      resource: 'project',
      resourceId: projectId,
      metadata: { count: results.length, features: featureDrafts.length },
    });

    const summary = await this.getSummary(user.id, orgId, projectId);
    const features = await this.listFeatures(user.id, orgId, projectId);
    return { ok: true, summary, features, requirements: results };
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

    const answered = await prisma.requirementQuestion.findMany({
      where: { projectId, status: { in: ['ANSWERED', 'OPEN'] } },
      include: { requirement: { select: { requirementKey: true } } },
    });
    const existingTexts = answered
      .filter((q) => q.requirementId !== req.id)
      .map((q) => q.question);

    const qSeq = await this.nextQuestionSeq(projectId);
    const saved = await this.analyzeAndPersist(req, qSeq, existingTexts);
    await this.detectConflicts(projectId);
    if (req.featureGroupId) await this.refreshFeatureStatuses(projectId);
    return { ok: true, requirement: saved.mapped };
  }

  async getSummary(userId: string, orgId: string, projectId: string) {
    const project = await this.requireProject(userId, orgId, projectId);
    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      include: {
        questions: { where: { status: 'OPEN' } },
      },
    });
    const conflicts = await prisma.requirementConflict.count({
      where: { projectId, status: 'OPEN' },
    });
    const features = await prisma.featureGroup.count({ where: { projectId } });
    const duplicates = requirements.filter(
      (r) =>
        r.possibleDuplicateOf &&
        (r.duplicateKind === 'DUPLICATE' ||
          r.duplicateKind === 'POSSIBLE_DUPLICATE'),
    ).length;

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

    const impact = {
      critical: requirements.filter((r) => r.businessImpact === 'CRITICAL')
        .length,
      high: requirements.filter((r) => r.businessImpact === 'HIGH').length,
      medium: requirements.filter((r) => r.businessImpact === 'MEDIUM').length,
      low: requirements.filter((r) => r.businessImpact === 'LOW').length,
    };

    return {
      total,
      reviewed: reviewed.length,
      features,
      duplicates,
      analysisId: project.analysisId ?? null,
      analysisVersion: project.analysisVersion ?? null,
      analysisEngine: project.analysisEngine ?? null,
      analyzedAt: project.analysisCompletedAt ?? null,
      business,
      functional,
      questions,
      impact,
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

  async listFeatures(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const features = await prisma.featureGroup.findMany({
      where: { projectId },
      include: {
        requirements: {
          orderBy: { requirementKey: 'asc' },
          include: {
            questions: { where: { status: 'OPEN' } },
          },
        },
        questions: { where: { status: 'OPEN' } },
      },
      orderBy: [{ businessArea: 'asc' }, { name: 'asc' }],
    });

    return features.map((f) => {
      const openQs = [
        ...f.questions,
        ...f.requirements.flatMap((r) => r.questions),
      ];
      // Deduplicate question ids (feature-level + requirement-level)
      const seenQ = new Set<string>();
      const uniqueOpenQs = openQs.filter((q) => {
        if (seenQ.has(q.id)) return false;
        seenQ.add(q.id);
        return true;
      });
      const analysis =
        f.analysis && typeof f.analysis === 'object'
          ? (f.analysis as Record<string, unknown>)
          : {};
      const impactCounts = {
        critical: f.requirements.filter((r) => r.businessImpact === 'CRITICAL')
          .length,
        high: f.requirements.filter((r) => r.businessImpact === 'HIGH').length,
        medium: f.requirements.filter((r) => r.businessImpact === 'MEDIUM')
          .length,
        low: f.requirements.filter((r) => r.businessImpact === 'LOW').length,
      };
      const statusCounts = {
        blocked: f.requirements.filter((r) => r.reviewStatus === 'BLOCKED')
          .length,
        needsClarification: f.requirements.filter(
          (r) => r.reviewStatus === 'NEEDS_CLARIFICATION',
        ).length,
        reviewRecommended: f.requirements.filter(
          (r) => r.reviewStatus === 'REVIEW_RECOMMENDED',
        ).length,
        ready: f.requirements.filter(
          (r) => r.reviewStatus === 'READY_FOR_TEST_DESIGN',
        ).length,
      };
      return {
        id: f.id,
        featureKey: f.featureKey,
        name: f.name,
        businessArea: f.businessArea,
        businessCapability: f.businessCapability,
        businessIntent: f.businessIntent,
        businessImpact: f.businessImpact,
        featureRisk: f.featureRisk,
        featureRiskReason: f.featureRiskReason,
        reviewStatus: f.reviewStatus,
        requirementCount: f.requirements.length,
        impactCounts,
        statusCounts,
        openQuestionCount: uniqueOpenQs.length,
        questionCount: uniqueOpenQs.length,
        // legacy fields kept for older UI — mapped from impact, not questions
        criticalQuestions: impactCounts.critical,
        highQuestions: impactCounts.high,
        dependsOn: Array.isArray(analysis.dependsOn) ? analysis.dependsOn : [],
        businessRules: Array.isArray(analysis.businessRules)
          ? analysis.businessRules
          : [],
        duplicateRequirements: f.requirements
          .filter(
            (r) =>
              r.possibleDuplicateOf &&
              (r.duplicateKind === 'DUPLICATE' ||
                r.duplicateKind === 'POSSIBLE_DUPLICATE'),
          )
          .map((r) => r.requirementKey),
        actors: [
          ...new Set(
            f.requirements
              .map((r) => {
                const biz = r.businessReview as BusinessReviewPayload | null;
                return biz?.semantic?.actor;
              })
              .filter(Boolean),
          ),
        ],
        entities: [
          ...new Set(
            f.requirements
              .map((r) => {
                const biz = r.businessReview as BusinessReviewPayload | null;
                return biz?.semantic?.entity;
              })
              .filter(Boolean),
          ),
        ],
        requirements: f.requirements.map((r) => {
          const biz = r.businessReview as BusinessReviewPayload | null;
          const relationships = Array.isArray(r.relationships)
            ? (r.relationships as RequirementRelationship[])
            : [];
          return {
            id: r.id,
            requirementKey: r.requirementKey,
            title: r.title,
            type: r.primaryType ?? r.type,
            primaryType: r.primaryType ?? r.type,
            secondaryType: r.secondaryType,
            businessImpact: r.businessImpact,
            reviewStatus: r.reviewStatus,
            openQuestionCount: r.questions.length,
            criticalOpenCount: r.questions.filter(
              (q) => q.priority === 'CRITICAL',
            ).length,
            highOpenCount: r.questions.filter((q) => q.priority === 'HIGH')
              .length,
            possibleDuplicateOf: r.possibleDuplicateOf,
            duplicateSimilarity: null,
            duplicateKind: r.duplicateKind,
            duplicateReason: r.duplicateReason,
            relationships,
            semantic: biz?.semantic ?? null,
          };
        }),
      };
    });
  }

  /**
   * User decision on a potential duplicate — never auto-merges content.
   * keep_both | mark_not_duplicate → clear flags
   * merge → soft link only (keeps both IDs; records user intent)
   */
  async resolveDuplicateDecision(
    user: SessionUser,
    orgId: string,
    projectId: string,
    requirementKey: string,
    decision: 'keep_both' | 'mark_not_duplicate' | 'merge',
  ) {
    await this.requireProject(user.id, orgId, projectId, Role.MEMBER);
    const req = await prisma.requirement.findFirst({
      where: { projectId, requirementKey },
    });
    if (!req) throw new NotFoundException('Requirement not found');

    if (decision === 'merge') {
      await prisma.requirement.update({
        where: { id: req.id },
        data: {
          duplicateKind: 'DUPLICATE',
          duplicateReason: `${req.duplicateReason ?? ''}\nUser chose Merge — both requirement IDs retained pending manual consolidation.`.trim(),
        },
      });
    } else {
      await prisma.requirement.update({
        where: { id: req.id },
        data: {
          possibleDuplicateOf: null,
          duplicateSimilarity: null,
          duplicateKind: 'NOT_DUPLICATE',
          duplicateReason:
            decision === 'mark_not_duplicate'
              ? 'User marked as not duplicate.'
              : 'User chose to keep both requirements.',
        },
      });
    }

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirement.duplicate_decision',
      resource: 'requirement',
      resourceId: req.id,
      metadata: { requirementKey, decision },
    });

    const mapped = await prisma.requirement.findUniqueOrThrow({
      where: { id: req.id },
      include: {
        sourceDocument: { select: { filename: true } },
        questions: { orderBy: { questionKey: 'asc' } },
        featureGroup: true,
      },
    });
    return this.mapRequirement(mapped);
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
        featureGroup: { select: { featureKey: true, name: true } },
      },
      orderBy: [{ priority: 'asc' }, { questionKey: 'asc' }],
    });
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
      conflictType: c.conflictType,
      status: c.status,
      requirementA: c.requirementA,
      requirementB: c.requirementB,
      createdAt: c.createdAt,
    }));
  }

  async listRelations(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const rows = await prisma.requirementRelation.findMany({
      where: { projectId },
      include: {
        fromRequirement: { select: { requirementKey: true, title: true } },
        toRequirement: { select: { requirementKey: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      relationType: r.relationType,
      confidence: r.confidence,
      detail: r.detail,
      from: r.fromRequirement,
      to: r.toRequirement,
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
    if (!question.requirement) {
      throw new BadRequestException('Feature-only questions are not answerable yet');
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
      ...derived.filter((d: ReviewFact) => d.status === 'DERIVED_FROM_USER_ANSWER'),
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

    await prisma.requirement.update({
      where: { id: question.requirementId! },
      data: {
        businessReview: {
          ...(existingReview ?? {}),
          rules: mergedRules,
        } as object,
        intentSource: 'USER_CONFIRMED',
      },
    });

    // Cross-requirement impact: related requirements via graph
    const relatedIds = await this.findRelatedRequirementIds(
      projectId,
      question.requirementId!,
    );
    const affectedKeys: string[] = [question.requirement.requirementKey];

    const answeredQs = await prisma.requirementQuestion.findMany({
      where: { projectId, status: { in: ['ANSWERED', 'OPEN'] } },
    });
    const existingTexts = answeredQs.map((q) => q.question);

    for (const reqId of [question.requirementId!, ...relatedIds]) {
      const req = await prisma.requirement.findUnique({ where: { id: reqId } });
      if (!req) continue;
      await prisma.requirementQuestion.deleteMany({
        where: { requirementId: req.id, status: 'OPEN' },
      });
      // Propagate derived cancel/payment rules to related when relevant
      if (reqId !== question.requirementId) {
        const biz = (req.businessReview as BusinessReviewPayload | null) ?? null;
        const rules = [
          ...asFacts(biz?.rules),
          ...derived.filter(
            (d: ReviewFact) => d.status === 'DERIVED_FROM_USER_ANSWER',
          ),
        ];
        await prisma.requirement.update({
          where: { id: req.id },
          data: {
            businessReview: { ...(biz ?? {}), rules } as object,
          },
        });
      }
      const refreshed = await prisma.requirement.findUniqueOrThrow({
        where: { id: req.id },
      });
      const qSeq = await this.nextQuestionSeq(projectId);
      await this.analyzeAndPersist(refreshed, qSeq, existingTexts);
      if (req.requirementKey !== question.requirement.requirementKey) {
        affectedKeys.push(req.requirementKey);
      }
    }

    await this.detectConflicts(projectId);
    await this.refreshFeatureStatuses(projectId);

    await this.audit.log({
      organizationId: orgId,
      userId: user.id,
      action: 'requirements.review.answer',
      resource: 'requirement_question',
      resourceId: question.id,
      metadata: {
        requirementKey: question.requirement.requirementKey,
        affected: affectedKeys,
      },
    });

    const savedReq = await prisma.requirement.findUniqueOrThrow({
      where: { id: question.requirementId! },
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
      requirement: this.mapRequirement(savedReq),
      derived,
      affectedRequirements: affectedKeys,
    };
  }

  private async findRelatedRequirementIds(
    projectId: string,
    requirementId: string,
  ): Promise<string[]> {
    const rels = await prisma.requirementRelation.findMany({
      where: {
        projectId,
        OR: [
          { fromRequirementId: requirementId },
          { toRequirementId: requirementId },
        ],
        relationType: {
          in: ['DEPENDS_ON', 'AFFECTS', 'RELATED_TO', 'CONFLICTS_WITH'],
        },
      },
    });
    const ids = new Set<string>();
    for (const r of rels) {
      if (r.fromRequirementId !== requirementId) ids.add(r.fromRequirementId);
      if (r.toRequirementId !== requirementId) ids.add(r.toRequirementId);
    }
    // Same feature group
    const self = await prisma.requirement.findUnique({
      where: { id: requirementId },
    });
    if (self?.featureGroupId) {
      const siblings = await prisma.requirement.findMany({
        where: {
          projectId,
          featureGroupId: self.featureGroupId,
          id: { not: requirementId },
        },
        select: { id: true },
      });
      for (const s of siblings) ids.add(s.id);
    }
    return [...ids].slice(0, 12);
  }

  private async refreshFeatureStatuses(projectId: string) {
    const features = await prisma.featureGroup.findMany({
      where: { projectId },
      include: {
        requirements: {
          include: { questions: { where: { status: 'OPEN' } } },
        },
        questions: { where: { status: 'OPEN' } },
      },
    });
    const openConflicts = await prisma.requirementConflict.findMany({
      where: { projectId, status: 'OPEN' },
      select: { requirementAId: true, requirementBId: true },
    });

    for (const f of features) {
      const openQs = [
        ...f.questions,
        ...f.requirements.flatMap((r) => r.questions),
      ];
      const seenQ = new Set<string>();
      const uniqueOpenQs = openQs.filter((q) => {
        if (seenQ.has(q.id)) return false;
        seenQ.add(q.id);
        return true;
      });
      const reqIds = new Set(f.requirements.map((r) => r.id));
      const conflictCount = openConflicts.filter(
        (c) => reqIds.has(c.requirementAId) || reqIds.has(c.requirementBId),
      ).length;

      const summary = summarizeFeature({
        requirementCount: f.requirements.length,
        businessImpacts: f.requirements.map((r) => r.businessImpact),
        reviewStatuses: f.requirements.map((r) => r.reviewStatus),
        openQuestionPriorities: uniqueOpenQs.map((q) => q.priority),
        openConflictCount: conflictCount,
      });

      // Prefer curated feature intent from grouping; do not overwrite with shallow req text
      const intentText =
        f.businessIntent && !/^Support\s+/i.test(f.businessIntent)
          ? f.businessIntent
          : ((
              f.requirements.find((r) => {
                const biz = r.businessReview as BusinessReviewPayload | null;
                return biz?.intent?.text && !/^Support\s+/i.test(biz.intent.text);
              })?.businessReview as BusinessReviewPayload | null
            )?.intent?.text ?? f.businessIntent);

      const confirmedRules = this.collectFeatureBusinessRules(f.requirements);
      const prev =
        f.analysis && typeof f.analysis === 'object'
          ? (f.analysis as Record<string, unknown>)
          : {};

      await prisma.featureGroup.update({
        where: { id: f.id },
        data: {
          reviewStatus: summary.reviewStatus,
          businessImpact: summary.businessImpact,
          featureRisk: summary.featureRisk,
          featureRiskReason: summary.featureRiskReason,
          businessIntent: intentText,
          analysis: {
            ...prev,
            requirementCount: summary.requirementCount,
            impactCounts: summary.impactCounts,
            statusCounts: summary.statusCounts,
            openQuestionCount: summary.openQuestionCount,
            businessRules: confirmedRules,
          },
        },
      });
    }
  }

  private collectFeatureBusinessRules(
    requirements: Array<{
      title: string;
      description: string;
      businessRules: unknown;
      businessReview: unknown;
    }>,
  ): Array<{ text: string; source: 'CONFIRMED' | 'AI_INFERRED'; requirementKey?: string }> {
    const rules: Array<{
      text: string;
      source: 'CONFIRMED' | 'AI_INFERRED';
      requirementKey?: string;
    }> = [];
    const seen = new Set<string>();

    for (const r of requirements) {
      const fromField = Array.isArray(r.businessRules)
        ? r.businessRules.map(String)
        : typeof r.businessRules === 'string' && r.businessRules.trim()
          ? r.businessRules
              .split(/\n+/)
              .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
              .filter(Boolean)
          : [];
      for (const text of fromField) {
        const key = text.toLowerCase();
        if (seen.has(key) || text.length < 12) continue;
        seen.add(key);
        rules.push({ text, source: 'CONFIRMED' });
      }

      const biz = r.businessReview as BusinessReviewPayload | null;
      for (const fact of biz?.rules ?? []) {
        if (!fact?.text) continue;
        const key = fact.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push({
          text: fact.text,
          source:
            fact.status === 'CONFIRMED' ||
            fact.status === 'DERIVED_FROM_USER_ANSWER' ||
            fact.intentSource === 'USER_CONFIRMED' ||
            fact.intentSource === 'EXPLICIT'
              ? 'CONFIRMED'
              : 'AI_INFERRED',
        });
      }
    }
    return rules.slice(0, 12);
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
      featureGroupId?: string | null;
    },
    startSeq: number,
    existingQuestionTexts: string[] = [],
  ) {
    const existingBiz = req.businessReview as BusinessReviewPayload | null;
    const knownDerived = asFacts(existingBiz?.rules).filter(
      (r) => r.status === 'DERIVED_FROM_USER_ANSWER',
    );

    const heuristicAnalysis = analyzeRequirement({
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
      existingQuestionTexts,
      structured: this.structuredByKey.get(req.requirementKey) ?? null,
    });
    // AI overlay for intent / impact / gaps / questions (domain-agnostic)
    const analysis = mergeAiIntoAnalysis(
      heuristicAnalysis,
      this.aiIntelByKey.get(req.requirementKey) ?? null,
    );

    const projectQs = await prisma.requirementQuestion.findMany({
      where: {
        projectId: req.projectId,
        status: { in: ['OPEN', 'ANSWERED'] },
        NOT: { requirementId: req.id },
      },
      include: { requirement: { select: { requirementKey: true } } },
    });
    const { keep, suppressed } = dedupeQuestionsAgainstExisting(
      analysis.questions,
      projectQs.map((q) => ({
        question: q.question,
        fingerprint: q.fingerprint,
        questionKey: q.questionKey,
        requirementKey: q.requirement?.requirementKey,
        status: q.status,
      })),
    );

    const rules = [
      ...analysis.businessReview.rules.filter(
        (r: ReviewFact) => r.status !== 'DERIVED_FROM_USER_ANSWER',
      ),
      ...knownDerived,
    ];
    const businessReview: BusinessReviewPayload = {
      ...analysis.businessReview,
      rules,
    };

    // Recompute status from kept (non-duplicate) questions only
    const statuses = deriveStatuses({
      openQuestions: keep,
      functionalCompleteness: analysis.functionalCompleteness,
    });
    const readinessScore = computeReadinessScore(
      keep.map((q) => ({
        priority: q.priority,
        category: q.category,
        blocking: q.blocking,
      })),
    );

    await prisma.requirement.update({
      where: { id: req.id },
      data: {
        businessReview: businessReview as object,
        functionalReview: analysis.functionalReview as object,
        businessReadiness: statuses.businessReadiness,
        functionalCompleteness: analysis.functionalCompleteness,
        reviewStatus: statuses.reviewStatus,
        readinessScore,
        reviewedAt: new Date(),
        status: 'EXTRACTED',
        primaryType: analysis.primaryType,
        secondaryType: analysis.secondaryType,
        businessImpact: analysis.businessImpact,
        intentSource: analysis.intentSource,
        // keep legacy type in sync with primary for list filters
        type: analysis.primaryType,
        analysisStale: false,
      },
    });

    let seq = startSeq;
    const createdQuestions: Array<{ question: string; questionKey: string }> =
      [];
    for (const draft of keep) {
      const questionKey = `Q${String(seq).padStart(3, '0')}`;
      seq += 1;
      await prisma.requirementQuestion.create({
        data: {
          projectId: req.projectId,
          requirementId: req.id,
          featureGroupId: req.featureGroupId ?? null,
          scope: 'REQUIREMENT',
          questionKey,
          category: draft.category,
          priority: draft.priority,
          question: draft.question,
          reason: draft.reason,
          blocking: draft.blocking,
          fingerprint: draft.fingerprint ?? questionBucket(draft.question),
          status: 'OPEN',
        },
      });
      createdQuestions.push({ question: draft.question, questionKey });
    }

    // Note suppressed duplicates in reason trail (no new questions)
    void suppressed;

    const withQuestions = await prisma.requirement.findUniqueOrThrow({
      where: { id: req.id },
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

    return {
      mapped: this.mapRequirement(withQuestions),
      nextSeq: seq,
      createdQuestions,
    };
  }

  private async detectConflicts(projectId: string) {
    const requirements = await prisma.requirement.findMany({
      where: { projectId },
      orderBy: { requirementKey: 'asc' },
    });

    const conflictDrafts = detectBusinessConflicts(
      requirements.map((r) => ({
        requirementKey: r.requirementKey,
        title: r.title,
        description: r.description,
        rulesText: asFacts(
          (r.businessReview as BusinessReviewPayload | null)?.rules,
        )
          .map((x) => x.text)
          .join(' '),
      })),
    );

    const keyToId = new Map(requirements.map((r) => [r.requirementKey, r.id]));

    for (const c of conflictDrafts) {
      const aId = keyToId.get(c.keyA);
      const bId = keyToId.get(c.keyB);
      if (!aId || !bId) continue;
      const exists = await prisma.requirementConflict.findFirst({
        where: {
          projectId,
          status: 'OPEN',
          OR: [
            { requirementAId: aId, requirementBId: bId },
            { requirementAId: bId, requirementBId: aId },
          ],
        },
      });
      if (exists) continue;

      await prisma.requirementConflict.create({
        data: {
          projectId,
          requirementAId: aId,
          requirementBId: bId,
          summary: c.summary,
          detail: c.detail,
          conflictType: 'BUSINESS',
          status: 'OPEN',
        },
      });

      // Conflicts block readiness — importance (CRITICAL impact) is separate
      await prisma.requirement.updateMany({
        where: { id: { in: [aId, bId] } },
        data: {
          reviewStatus: 'BLOCKED',
          businessReadiness: 'BLOCKED',
        },
      });

      const conflictQuestion =
        /cancel/i.test(c.summary) || /cancel/i.test(c.detail)
          ? 'Which order statuses actually allow cancellation?'
          : /stock|inventory/i.test(c.summary)
            ? 'Which out-of-stock purchase rule is authoritative when requirements disagree?'
            : `How should the business resolve the conflict between ${c.keyA} and ${c.keyB}?`;
      const fp = questionBucket(conflictQuestion);
      const already = await prisma.requirementQuestion.findFirst({
        where: {
          projectId,
          status: { in: ['OPEN', 'ANSWERED'] },
          OR: [{ fingerprint: fp }, { question: conflictQuestion }],
        },
      });
      if (!already) {
        const seq = await this.nextQuestionSeq(projectId);
        const questionKey = `Q${String(seq).padStart(3, '0')}`;
        const aReq = requirements.find((r) => r.id === aId);
        await prisma.requirementQuestion.create({
          data: {
            projectId,
            requirementId: aId,
            featureGroupId: aReq?.featureGroupId ?? null,
            scope: 'REQUIREMENT',
            questionKey,
            category: 'BUSINESS_RULE',
            priority: 'CRITICAL',
            question: conflictQuestion,
            reason: c.detail,
            blocking: true,
            fingerprint: fp,
            status: 'OPEN',
          },
        });
      }

      try {
        await prisma.requirementRelation.create({
          data: {
            projectId,
            fromRequirementId: aId,
            toRequirementId: bId,
            relationType: 'CONFLICTS_WITH',
            confidence: 0.9,
            source: 'REVIEW',
            detail: c.summary,
          },
        });
      } catch {
        // ignore unique
      }
    }
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
    reviewStatus: string | null;
    businessReadiness: string | null;
    functionalCompleteness: string | null;
    businessReview: unknown;
    functionalReview: unknown;
    readinessScore: number | null;
    reviewedAt: Date | null;
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
      fingerprint?: string | null;
      linkedQuestionId?: string | null;
    }>;
  }) {
    const openQuestions = (row.questions ?? []).filter((q) => q.status === 'OPEN');
    const biz = row.businessReview as BusinessReviewPayload | null;
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
      // Never expose similarity as a decision signal (prevents legacy "67%" UI)
      duplicateSimilarity: null,
      duplicateKind: row.duplicateKind ?? null,
      duplicateReason: row.duplicateReason ?? null,
      relationships: Array.isArray(row.relationships)
        ? (row.relationships as RequirementRelationship[])
        : [],
      analysisDetails: {
        engine: SEMANTIC_ANALYSIS_ENGINE,
        version: SEMANTIC_ANALYSIS_VERSION,
        internalOverlap:
          row.duplicateSimilarity != null
            ? Number(row.duplicateSimilarity)
            : null,
      },
      semantic: biz?.semantic ?? null,
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
      reviewStatus: row.reviewStatus,
      businessReadiness: row.businessReadiness,
      functionalCompleteness: row.functionalCompleteness,
      businessReview: row.businessReview as BusinessReviewPayload | null,
      functionalReview: row.functionalReview as FunctionalReviewPayload | null,
      readinessScore: row.readinessScore,
      reviewedAt: row.reviewedAt,
      analysisStale: row.analysisStale ?? false,
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
        fingerprint: q.fingerprint ?? null,
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
    scope?: string;
    fingerprint?: string | null;
    requirement?: { requirementKey: string; title: string } | null;
    featureGroup?: { featureKey: string; name: string } | null;
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
      scope: q.scope ?? 'REQUIREMENT',
      fingerprint: q.fingerprint ?? null,
      requirementKey: q.requirement?.requirementKey,
      requirementTitle: q.requirement?.title,
      featureKey: q.featureGroup?.featureKey,
      featureName: q.featureGroup?.name,
    };
  }
}
