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

function titleFromDescription(description: string): string {
  const cleaned = description.replace(/^(the\s+)?user\s+should\s+be\s+able\s+to\s+/i, '');
  const words = cleaned.split(/\s+/).slice(0, 6);
  const title = words.join(' ').replace(/[.]+$/, '').trim();
  return title
    ? title.replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Requirement';
}

function heuristicExtract(
  sourceText: string,
  documentName: string,
): ExtractedRequirementInput[] {
  const chunks = sourceText
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length >= 12);

  const lines =
    chunks.length > 0
      ? chunks
      : sourceText
          .split(/(?<=[.!?])\s+|\n+/)
          .map((l) => l.trim())
          .filter((l) => l.length >= 12);

  const items = lines.slice(0, 50);
  return items.map((text, i) => ({
    requirementKey: `REQ-${String(i + 1).padStart(3, '0')}`,
    title: titleFromDescription(text),
    description: text,
    type: 'FUNCTIONAL' as const,
    priority: null,
    acceptanceCriteria: [],
    businessRules: [],
    dependencies: [],
    source: {
      document: documentName,
      page: null,
      section: null,
      text,
    },
  }));
}

function flagDuplicates(
  items: ExtractedRequirementInput[],
): Map<string, string | null> {
  const flags = new Map<string, string | null>();
  for (let i = 0; i < items.length; i++) {
    flags.set(items[i].requirementKey, null);
    const a = normalizeText(items[i].description);
    for (let j = 0; j < i; j++) {
      const b = normalizeText(items[j].description);
      if (!a || !b) continue;
      if (a === b || a.includes(b) || b.includes(a)) {
        flags.set(items[i].requirementKey, items[j].requirementKey);
        break;
      }
    }
  }
  return flags;
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

    let parsed: ExtractedRequirementInput[];
    try {
      parsed = await this.callLlm(sourceText, doc.filename);
    } catch {
      // Deterministic fallback that does not invent AC/rules
      parsed = heuristicExtract(sourceText, doc.filename);
    }

    if (!parsed.length) {
      throw new BadRequestException(
        'No clear requirements were detected. Please check the document or paste the requirements manually.',
      );
    }

    // Stable keys: prefer match by source text, then keep AI key if free, else next free
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

  private assignStableKeys(
    incoming: ExtractedRequirementInput[],
    existing: Array<{ requirementKey: string; sourceText: string | null; description: string }>,
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
        if (!used.has(candidate) && !existing.some((e) => e.requirementKey === candidate && normalizeText(e.sourceText || e.description) !== sourceKey)) {
          // Reuse AI key if not already claimed by a different source
          const clash = existing.find((e) => e.requirementKey === candidate);
          if (!clash || normalizeText(clash.sourceText || clash.description) === sourceKey) {
            key = candidate;
          }
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
      system: `You extract software requirements from source text into JSON.
Rules:
- Do not invent information.
- If priority, acceptance criteria, business rules, or dependencies are not explicitly present, use null or empty arrays.
- Do not invent OTP channels, password rules, expiry, or other assumptions.
- Classify type as FUNCTIONAL, NON_FUNCTIONAL, or BUSINESS_RULE only when clear.
- Prefer FUNCTIONAL when unclear.
- requirementKey format: REQ-001, REQ-002, ...
- Keep descriptions faithful to the source wording.`,
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
      "description": "faithful description from source",
      "type": "FUNCTIONAL",
      "priority": null,
      "acceptanceCriteria": [],
      "businessRules": [],
      "dependencies": [],
      "source": {
        "document": "${documentName}",
        "page": null,
        "section": null,
        "text": "exact source snippet"
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
