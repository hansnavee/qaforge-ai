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
  filterExtractedRequirements,
  semanticExtractRequirements,
  type ExtractedRequirementInput,
} from '@qaforge/shared';
import { AuditService } from '../common/audit.service';
import type { SessionUser } from '../auth/auth';
import { OrgsService } from '../orgs/orgs.service';

function normalizeText(value: string): string {
  return value
    .toLowerCase()
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
  items: ReturnType<typeof semanticExtractRequirements>,
): ExtractedRequirementInput[] {
  return items.map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    type: r.type,
    priority: r.priority,
    acceptanceCriteria: r.acceptanceCriteria,
    businessRules: r.businessRules,
    dependencies: r.dependencies,
    source: r.source,
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

    let parsed = await this.extractSemantically(sourceText, doc.filename);

    if (!parsed.length) {
      throw new BadRequestException(
        'No clear requirements were detected. Please check the document or paste the requirements manually.',
      );
    }

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
        sourceSection: item.source?.section ?? null,
        sourceText: item.source?.text ?? item.description,
        acceptanceCriteria: item.acceptanceCriteria,
        businessRules: item.businessRules,
        dependencies: item.dependencies,
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
    };
  }

  /**
   * Prefer live LLM semantic extraction when available; always validate/filter.
   * Fall back to deterministic semantic extractor (never line-splitting).
   */
  private async extractSemantically(
    sourceText: string,
    documentName: string,
  ): Promise<ExtractedRequirementInput[]> {
    const fallback = () =>
      toExtractedInput(semanticExtractRequirements(sourceText, documentName));

    try {
      const fromLlm = await this.callLlm(sourceText, documentName);
      const filtered = filterExtractedRequirements(fromLlm).map((r) => ({
        ...r,
        source: {
          document: r.source?.document || documentName,
          page: r.source?.page ?? null,
          section: r.source?.section ?? null,
          text: r.source?.text || r.description,
        },
      }));

      // If the model still produced mostly junk, use deterministic semantic extract
      if (
        filtered.length === 0 ||
        filtered.length < Math.max(1, Math.floor(fromLlm.length * 0.4))
      ) {
        return fallback();
      }
      return filtered;
    } catch {
      return fallback();
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
      const sourceKey = normalizeText(item.source?.text || item.description);
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
    sourceText: string,
    documentName: string,
  ): Promise<ExtractedRequirementInput[]> {
    const llm = await this.llm.complete({
      system: `You perform SEMANTIC software requirement extraction into JSON.

Core rules:
- Extract requirements based on semantic meaning, NOT document formatting or line boundaries.
- Document titles, markdown headings (# ## ###), numbered section titles, and "Acceptance Criteria" labels are NOT requirements. Use them only as source.section context.
- Do NOT create a requirement for each bullet. Bullets under an explicit Acceptance Criteria heading belong in acceptanceCriteria of the parent requirement.
- When a statement says a page should display/include items followed by a bullet list, create ONE requirement and fold the items into the description (do not invent extra fields).
- Only populate acceptanceCriteria / businessRules / dependencies when explicitly present in the source. Never invent them.
- Classify type as FUNCTIONAL, NON_FUNCTIONAL, or BUSINESS_RULE using meaning (unique/must/expire → BUSINESS_RULE; performance/security/browsers/usability → NON_FUNCTIONAL; user/system capabilities → FUNCTIONAL).
- Every requirement must have a meaningful title and description describing behavior, a rule, or a constraint.
- requirementKey format: REQ-001, REQ-002, ...
- Keep descriptions faithful to the source. Do not invent OTP channels, password rules, expiry, or other assumptions.`,
      prompt: `Source document name: ${documentName}

Original requirement text:
"""
${sourceText.slice(0, 40_000)}
"""

Return JSON only:
{
  "requirements": [
    {
      "requirementKey": "REQ-001",
      "title": "short title",
      "description": "faithful requirement statement",
      "type": "FUNCTIONAL",
      "priority": null,
      "acceptanceCriteria": [],
      "businessRules": [],
      "dependencies": [],
      "source": {
        "document": "${documentName}",
        "page": null,
        "section": "section heading if any",
        "text": "exact source snippet for this requirement"
      }
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
      source: {
        document: r.source?.document || documentName,
        page: r.source?.page ?? null,
        section: r.source?.section ?? null,
        text: r.source?.text || r.description,
      },
    }));
  }
}
