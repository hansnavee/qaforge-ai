import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import { prisma } from '@qaforge/database';
import {
  Role,
  extractionAiResponseSchema,
  finalizeExtraction,
  parseRequirementDocument,
  type ExtractedRequirementInput,
  type ExtractionDecision,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\busers\b/g, 'user')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

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
    createdAt: Date;
    updatedAt: Date;
    sourceDocument?: { filename: string } | null;
  }) {
    const asStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(String) : [];

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
      sourceDocumentName: row.sourceDocument?.filename ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(userId: string, orgId: string, projectId: string) {
    await this.requireProject(userId, orgId, projectId);
    const rows = await prisma.requirement.findMany({
      where: { projectId },
      include: { sourceDocument: { select: { filename: true } } },
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
      include: { sourceDocument: { select: { filename: true } } },
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

    // Preserve stable keys by source text when possible, then replace DB set
    const assigned = this.assignStableKeys(
      finalized.requirements.map((r) => ({
        requirementKey: r.requirementKey,
        title: r.title,
        description: r.description,
        type: r.type,
        priority: r.priority,
        acceptanceCriteria: r.acceptanceCriteria,
        businessRules: r.businessRules,
        dependencies: r.dependencies,
        supportingInformation: r.supportingInformation,
        source: r.source,
        sourceText: r.source.text,
        section: r.source.section,
      })),
      existing,
    );

    const finalKeys = assigned.map((a) => a.requirementKey);

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

      // Remove invalid/orphan rows from prior extractions (headings, tables, etc.)
      if (finalKeys.length) {
        await tx.requirement.deleteMany({
          where: {
            projectId,
            requirementKey: { notIn: finalKeys },
          },
        });
      } else {
        await tx.requirement.deleteMany({ where: { projectId } });
      }

      for (const item of assigned) {
        const data = {
          title: item.title,
          description: item.description,
          type: item.type,
          priority: item.priority ?? null,
          status: 'EXTRACTED',
          sourceDocumentId: doc.id,
          sourcePage: item.source?.page ?? null,
          sourceSection: item.section ?? item.source?.section ?? null,
          sourceText: item.sourceText ?? item.source?.text ?? item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          businessRules: item.businessRules,
          dependencies: item.dependencies,
          supportingInformation: item.supportingInformation ?? [],
          possibleDuplicateOf: null as string | null,
        };

        await tx.requirement.upsert({
          where: {
            projectId_requirementKey: {
              projectId,
              requirementKey: item.requirementKey,
            },
          },
          create: {
            projectId,
            requirementKey: item.requirementKey,
            ...data,
          },
          update: data,
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
      previousCount: existing.length,
      sourceDocument: doc.filename,
    };

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

  private assignStableKeys(
    incoming: ExtractedRequirementInput[],
    existing: Array<{
      requirementKey: string;
      sourceText: string | null;
      description: string;
    }>,
  ): ExtractedRequirementInput[] {
    const used = new Set<string>();
    const bySource = new Map<string, string>();
    for (const e of existing) {
      const key = normalizeText(e.sourceText || e.description);
      // Only reuse keys for content that would still be valid finals
      if (key) bySource.set(key, e.requirementKey);
    }

    let nextNum = 1;

    return incoming.map((item) => {
      const sourceKey = normalizeText(
        item.sourceText || item.source?.text || item.description,
      );
      let key = bySource.get(sourceKey);

      if (key && used.has(key)) key = undefined;

      if (!key) {
        while (used.has(`REQ-${String(nextNum).padStart(3, '0')}`)) nextNum += 1;
        key = `REQ-${String(nextNum).padStart(3, '0')}`;
        nextNum += 1;
      }

      used.add(key);
      return { ...item, requirementKey: key };
    });
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
