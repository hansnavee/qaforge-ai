import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import {
  SENIOR_QA_GENERATE_SYSTEM,
  assembleGeneratedCases,
  buildLlmGeneratePrompt,
  caseFingerprint,
  parseJsonFromLlm,
  requirementsFromSource,
  resolveGenerateTechniques,
  type AppPageMap,
  type DesignTechnique,
  type GeneratedCasePreview,
  type StoredRequirementForLlm,
  type TechniqueCoverageReport,
} from '@qaforge/shared';

@Injectable()
export class AiGenerateCasesService {
  private readonly logger = new Logger(AiGenerateCasesService.name);
  private readonly llm = new OpenRouterLlmClient();

  async generate(opts: {
    sourceText: string;
    documentName?: string;
    techniques?: DesignTechnique[];
    type?: string;
    priorityLabel?: 'HIGH' | 'MEDIUM' | 'LOW';
    projectName?: string;
    appUrl?: string | null;
    loginUrl?: string | null;
    username?: string;
    password?: string;
    storedRequirements?: StoredRequirementForLlm[];
    pageMap?: AppPageMap | null;
  }): Promise<{
    cases: GeneratedCasePreview[];
    coverage: TechniqueCoverageReport;
    tokensUsed: number;
    requirementCount: number;
  }> {
    const sourceText = opts.sourceText.trim();
    const stored = opts.storedRequirements ?? [];
    if (!sourceText && !stored.length && !opts.pageMap) {
      throw new BadRequestException('Requirements are required');
    }
    const techniques = resolveGenerateTechniques(
      sourceText,
      opts.techniques?.length ? opts.techniques : null,
    );
    const combinedSource = [
      sourceText,
      ...stored.map((r) => `${r.requirementKey}: ${r.title}\n${r.description}`),
      opts.appUrl ?? '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const requirements = requirementsFromSource(
      combinedSource || 'Generate tests for the observed application.',
      opts.documentName ?? 'prompt',
    );
    if (!requirements.length) {
      throw new BadRequestException(
        'Could not read any requirements from the source',
      );
    }

    // One batch, fast model: Railway HTTP dies if we wait on several 90s free-model calls.
    const chunks = [techniques];
    const mergedRaw: unknown[] = [];
    let tokensUsed = 0;
    const errors: string[] = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const userPrompt = buildLlmGeneratePrompt({
        userPrompt: [
          sourceText,
          chunks.length > 1
            ? `\n\nBatch ${i + 1}/${chunks.length}: focus only on techniques ${chunk.join(', ')}. Return fewer, high-quality cases for these techniques.`
            : '',
        ]
          .filter(Boolean)
          .join(''),
        projectName: opts.projectName,
        appUrl: opts.appUrl,
        loginUrl: opts.loginUrl,
        username: opts.username,
        password: opts.password,
        storedRequirements: stored.slice(0, 20),
        pageMap: opts.pageMap,
        techniques: chunk.length ? chunk : techniques,
      });

      try {
        const result = await this.llm.complete({
          system: SENIOR_QA_GENERATE_SYSTEM,
          prompt: userPrompt,
          json: true,
          model: 'fast',
          maxTokens: 3_500,
          temperature: 0.2,
          timeoutMs: 20_000,
          maxAttempts: 2,
        });
        tokensUsed += result.tokensUsed;
        const parsed = parseJsonFromLlm(result.text) as {
          cases?: unknown[];
        };
        if (Array.isArray(parsed?.cases)) {
          mergedRaw.push(...parsed.cases);
        } else if (Array.isArray(parsed)) {
          mergedRaw.push(...parsed);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`LLM generate chunk ${i + 1} failed: ${msg}`);
        errors.push(`batch ${i + 1}: ${msg.slice(0, 120)}`);
      }
    }

    const seen = new Set<string>();
    const dedupedRaw: unknown[] = [];
    for (const row of mergedRaw) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const key = caseFingerprint({
        scenario: String(r.scenario ?? ''),
        module: String(r.module ?? 'General'),
        designTechnique: String(r.designTechnique ?? 'HAPPY_PATH'),
        requirementKey: r.requirementKey ? String(r.requirementKey) : null,
      });
      if (!key.startsWith('::') && seen.has(key)) continue;
      if (!key.startsWith('::')) seen.add(key);
      dedupedRaw.push(row);
    }

    const assembled = assembleGeneratedCases({
      sourceText: combinedSource,
      llmCases: { cases: dedupedRaw },
      techniques,
      type: opts.type,
      priorityLabel: opts.priorityLabel,
      appUrl: opts.appUrl,
      fillMissing: true,
    });
    if (!assembled.cases.length) {
      throw new BadRequestException(
        `AI generate timed out or failed (${errors.join('; ') || 'no cases'}). Try a shorter prompt, or retry.`,
      );
    }
    if (errors.length) {
      this.logger.warn(
        `LLM generate incomplete (${errors.join('; ')}); returned ${assembled.cases.length} coverage-filled cases`,
      );
    }
    return {
      cases: assembled.cases,
      coverage: assembled.coverage,
      tokensUsed,
      requirementCount: requirements.length,
    };
  }

  async proposeRunCases(opts: {
    sourceText: string;
    strategy?: 'SPRINT' | 'KANBAN';
    wipLimit?: number;
    cases: Array<{
      id: string;
      externalId: string;
      scenario: string;
      priorityLabel: string;
      folderName: string;
    }>;
  }): Promise<{
    selectedIds: string[];
    reasons: Record<string, string>;
    tokensUsed: number;
  }> {
    const sourceText = opts.sourceText.trim();
    if (!sourceText) {
      throw new BadRequestException('Requirements are required');
    }
    if (!opts.cases.length) {
      throw new BadRequestException(
        'No Ready cases to select. Mark cases Ready first.',
      );
    }
    const strategy = opts.strategy === 'KANBAN' ? 'KANBAN' : 'SPRINT';
    const wip = Math.min(Math.max(opts.wipLimit ?? 8, 1), 200);
    const catalog = opts.cases
      .map(
        (c) =>
          `${c.id}\t${c.externalId}\t${c.priorityLabel}\t${c.folderName}\t${c.scenario}`,
      )
      .join('\n');
    let selectedIds: string[] = [];
    let reasons: Record<string, string> = {};
    let tokensUsed = 0;
    const system =
      strategy === 'KANBAN'
        ? `You pull the next Kanban automation batch. Return JSON only: {"cases":[{"id":"...","why":"..."}]}. Only use ids from the catalog. Pick at most ${wip} cases. HIGH/P0 first, then MEDIUM. Skip cosmetic LOW unless WIP has room. Do not invent cases.`
        : 'You pick a Sprint execution roster from READY cases. Return JSON only: {"cases":[{"id":"...","why":"..."}]}. Only use ids from the catalog. Prefer HIGH/P0 coverage for the sprint goal; include MEDIUM that maps to the requirements. Do not invent cases.';
    try {
      const result = await this.llm.complete({
        system,
        prompt: `Strategy: ${strategy}${strategy === 'KANBAN' ? ` (WIP ${wip})` : ''}\nRequirements:\n${sourceText.slice(0, 12_000)}\n\nCatalog (id, externalId, priority, folder, title):\n${catalog.slice(0, 20_000)}`,
        json: true,
        model: 'reasoning',
        maxTokens: 2000,
        temperature: 0.1,
      });
      tokensUsed = result.tokensUsed;
      const parsed = parseJsonFromLlm(result.text) as {
        cases?: Array<{ id?: string; why?: string }>;
      };
      const allowed = new Set(opts.cases.map((c) => c.id));
      for (const row of parsed?.cases ?? []) {
        if (row.id && allowed.has(row.id) && !selectedIds.includes(row.id)) {
          selectedIds.push(row.id);
          reasons[row.id] = String(row.why ?? 'Matches requirements').slice(
            0,
            240,
          );
        }
      }
    } catch {
      selectedIds = [];
    }
    if (!selectedIds.length) {
      const q = sourceText.toLowerCase();
      const matched = opts.cases.filter((c) => {
        const hay = `${c.scenario} ${c.folderName} ${c.externalId}`.toLowerCase();
        return q
          .split(/\W+/)
          .filter((w) => w.length > 3)
          .some((w) => hay.includes(w));
      });
      const pool = matched.length ? matched : opts.cases;
      const ordered = [...pool].sort((a, b) => {
        const rank = (p: string) =>
          p === 'HIGH' ? 0 : p === 'MEDIUM' ? 1 : 2;
        return rank(a.priorityLabel) - rank(b.priorityLabel);
      });
      selectedIds = ordered.map((c) => c.id);
      for (const id of selectedIds) {
        if (!reasons[id]) reasons[id] = 'Included from Ready library';
      }
    }
    if (strategy === 'KANBAN' && selectedIds.length > wip) {
      selectedIds = selectedIds.slice(0, wip);
    }
    return { selectedIds, reasons, tokensUsed };
  }
}
