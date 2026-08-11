import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import {
  DEFAULT_GENERATE_TECHNIQUES,
  SENIOR_QA_GENERATE_SYSTEM,
  assembleGeneratedCases,
  buildLlmGeneratePrompt,
  parseJsonFromLlm,
  requirementsFromSource,
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
    const techniques = (opts.techniques?.length
      ? opts.techniques
      : DEFAULT_GENERATE_TECHNIQUES) as DesignTechnique[];
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

    const userPrompt = buildLlmGeneratePrompt({
      userPrompt: sourceText,
      projectName: opts.projectName,
      appUrl: opts.appUrl,
      loginUrl: opts.loginUrl,
      username: opts.username,
      password: opts.password,
      storedRequirements: stored,
      pageMap: opts.pageMap,
      techniques,
    });

    let llmCases: unknown = { cases: [] };
    let tokensUsed = 0;
    try {
      const result = await this.llm.complete({
        system: SENIOR_QA_GENERATE_SYSTEM,
        prompt: userPrompt,
        json: true,
        model: 'reasoning',
        maxTokens: 8000,
        temperature: 0.2,
      });
      tokensUsed = result.tokensUsed;
      llmCases = parseJsonFromLlm(result.text);
    } catch (err) {
      this.logger.warn(
        `LLM generate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        'AI could not generate test cases. Check the prompt and try again.',
      );
    }

    const assembled = assembleGeneratedCases({
      sourceText: combinedSource,
      llmCases,
      techniques,
      type: opts.type,
      priorityLabel: opts.priorityLabel,
    });
    if (!assembled.cases.length) {
      throw new BadRequestException(
        'AI returned no valid test cases. Add more detail (URL, credentials, expected result) and retry.',
      );
    }
    return {
      cases: assembled.cases,
      coverage: assembled.coverage,
      tokensUsed,
      requirementCount: assembled.requirements.length,
    };
  }

  async proposeRunCases(opts: {
    sourceText: string;
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
    const catalog = opts.cases
      .map(
        (c) =>
          `${c.id}\t${c.externalId}\t${c.priorityLabel}\t${c.folderName}\t${c.scenario}`,
      )
      .join('\n');
    let selectedIds: string[] = [];
    let reasons: Record<string, string> = {};
    let tokensUsed = 0;
    try {
      const result = await this.llm.complete({
        system:
          'You pick existing READY test cases for an execution cycle. Return JSON only: {"cases":[{"id":"...","why":"..."}]}. Only use ids from the catalog. Do not invent cases.',
        prompt: `Requirements:\n${sourceText.slice(0, 12_000)}\n\nCatalog (id, externalId, priority, folder, title):\n${catalog.slice(0, 20_000)}`,
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
      selectedIds = (matched.length ? matched : opts.cases).map((c) => c.id);
      for (const id of selectedIds) {
        if (!reasons[id]) reasons[id] = 'Included from Ready library';
      }
    }
    return { selectedIds, reasons, tokensUsed };
  }
}
