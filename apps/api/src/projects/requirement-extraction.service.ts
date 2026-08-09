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
  extractRequirementsFromSource,
  filterExtractedRequirements,
  parseRequirementDocument,
  type ExtractedRequirementInput,
  type ExtractionResult,
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

function flagDuplicates(
  items: ExtractedRequirementInput[],
): Map<string, string | null> {
  const flags = new Map<string, string | null>();
  for (let i = 0; i < items.length; i++) {
    flags.set(items[i]!.requirementKey, null);
    const a = normalizeText(items[i]!.description);
    for (let j = 0; j < i; j++) {
      const b = normalizeText(items[j]!.description);
      if (!a || !b) continue;
      if (a === b || a.includes(b) || b.includes(a)) {
        flags.set(items[i]!.requirementKey, items[j]!.requirementKey);
        break;
      }
    }
  }
  return flags;
}

function toExtractedInput(
  result: ExtractionResult,
): ExtractedRequirementInput[] {
  return result.requirements.map((r) => ({
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
  }));
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

    const { requirements: parsed, documentElements } =
      await this.extractPipeline(sourceText, doc.filename);

    if (!parsed.length) {
      throw new BadRequestException(
        'No clear requirements were detected. Please check the document or paste the requirements manually.',
      );
    }

    // Persist parsed structure (sections/tables) on the source document
    await prisma.requirementDocument.update({
      where: { id: doc.id },
      data: {
        documentStructure: documentElements as object,
      },
    });

    const assigned = this.assignStableKeys(parsed, existing);
    const duplicateFlags = flagDuplicates(assigned);

    const saved = [];
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
        possibleDuplicateOf: duplicateFlags.get(item.requirementKey) ?? null,
      };

      const row = await prisma.requirement.upsert({
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
        include: { sourceDocument: { select: { filename: true } } },
      });
      saved.push(this.mapRequirement(row));
    }

    const summary = {
      total: saved.length,
      functional: saved.filter((r) => r.type === 'FUNCTIONAL').length,
      nonFunctional: saved.filter((r) => r.type === 'NON_FUNCTIONAL').length,
      businessRules: saved.filter((r) => r.type === 'BUSINESS_RULE').length,
      possibleDuplicates: saved.filter((r) => r.possibleDuplicateOf).length,
      tables: documentElements.tables.length,
      sections: documentElements.sections.length,
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
      documentElements,
    };
  }

  /**
   * Parser → AI (optional) → normalize → validate.
   * Deterministic semantic extract is the reliable baseline.
   */
  private async extractPipeline(
    sourceText: string,
    documentName: string,
  ): Promise<{
    requirements: ExtractedRequirementInput[];
    documentElements: ExtractionResult['documentElements'];
  }> {
    const parsedDoc = parseRequirementDocument(sourceText);
    const baseline = extractRequirementsFromSource(sourceText, documentName);
    const fallbackReqs = filterExtractedRequirements(
      toExtractedInput(baseline),
    );

    try {
      const fromLlm = await this.callLlm(parsedDoc, documentName);
      const filtered = filterExtractedRequirements(fromLlm).map((r) => ({
        ...r,
        supportingInformation: r.supportingInformation ?? [],
        source: {
          document: r.source?.document || documentName,
          page: r.source?.page ?? null,
          section: r.section ?? r.source?.section ?? null,
          text: r.sourceText || r.source?.text || r.description,
        },
        sourceText: r.sourceText || r.source?.text || r.description,
      }));

      if (
        filtered.length === 0 ||
        filtered.length < Math.max(1, Math.floor(fromLlm.length * 0.4))
      ) {
        return {
          requirements: fallbackReqs,
          documentElements: baseline.documentElements,
        };
      }

      return {
        requirements: filtered,
        documentElements: {
          sections: baseline.documentElements.sections,
          tables: baseline.documentElements.tables,
        },
      };
    } catch {
      return {
        requirements: fallbackReqs,
        documentElements: baseline.documentElements,
      };
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
      if (key) bySource.set(key, e.requirementKey);
    }

    let nextNum =
      existing.reduce((max, e) => {
        const m = e.requirementKey.match(/^REQ-(\d+)$/i);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0) + 1;

    return incoming.map((item) => {
      const sourceKey = normalizeText(
        item.sourceText || item.source?.text || item.description,
      );
      let key = bySource.get(sourceKey);

      if (!key) {
        const candidate = item.requirementKey.toUpperCase();
        const clash = existing.find((e) => e.requirementKey === candidate);
        if (
          !used.has(candidate) &&
          (!clash ||
            normalizeText(clash.sourceText || clash.description) === sourceKey)
        ) {
          key = candidate;
        }
      }

      if (!key || used.has(key)) {
        while (used.has(`REQ-${String(nextNum).padStart(3, '0')}`)) nextNum += 1;
        key = `REQ-${String(nextNum).padStart(3, '0')}`;
        nextNum += 1;
      }

      used.add(key);
      return { ...item, requirementKey: key };
    });
  }

  private async callLlm(
    parsedDoc: ReturnType<typeof parseRequirementDocument>,
    documentName: string,
  ): Promise<ExtractedRequirementInput[]> {
    const structured = JSON.stringify(
      {
        document: documentName,
        elements: parsedDoc.elements,
      },
      null,
      2,
    ).slice(0, 60_000);

    const llm = await this.llm.complete({
      system: `You perform SEMANTIC software requirement extraction from a PARSED document.

The input is already structured into HEADING, PARAGRAPH, LIST, and TABLE elements.

Hard rules:
- HEADING elements are NEVER requirements. Use section headings only as section context.
- Acceptance Criteria headings and their LIST items become acceptanceCriteria on the parent requirement.
- TABLE elements are NEVER requirements. Ignore table headers and rows.
- Do NOT create a requirement per bullet. LIST items under display/contain intros become supportingInformation.
- Separate clearly independent behaviors into distinct requirements.
- Only populate acceptanceCriteria / businessRules / dependencies / supportingInformation when present in source.
- Never invent information.
- Classify FUNCTIONAL | NON_FUNCTIONAL | BUSINESS_RULE correctly.
- Titles must be concise and complete (e.g. "User Login"), never truncated mid-phrase.
- sourceText must be the full original statement, never truncated.
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
  ],
  "documentElements": {
    "sections": [],
    "tables": []
  }
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
