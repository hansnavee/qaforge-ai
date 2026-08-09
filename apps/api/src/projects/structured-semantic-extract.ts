/**
 * Step 2.5 — LLM structured semantic extraction (OpenRouter).
 * Falls back to shared heuristic when key missing / parse fails / low confidence.
 */

import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import {
  STRUCTURED_SEMANTIC_SYSTEM_PROMPT,
  coerceStructuredSemantics,
  parseStructuredSemanticsBatch,
  resolveStructuredSemantics,
  type StructuredExtractionInput,
  type StructuredRequirementSemantics,
} from '@qaforge/shared';

const BATCH_SIZE = 12;

function buildBatchPrompt(batch: StructuredExtractionInput[]): string {
  const rows = batch.map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    sourceText: r.sourceText ?? null,
    type: r.type ?? null,
  }));
  return `Extract structured semantics for each requirement below.
Return JSON:
{
  "requirements": [
    {
      "requirementKey": "REQ-001",
      "actor": "CUSTOMER",
      "action": "PURCHASE",
      "object": "PRODUCT",
      "condition": "OUT_OF_STOCK",
      "polarity": "NOT_ALLOWED",
      "requirementType": "BUSINESS_RULE",
      "capability": "PRODUCT_PURCHASE",
      "confidence": 0.97
    }
  ]
}

Requirements:
${JSON.stringify(rows, null, 2)}`;
}

export async function extractStructuredSemanticsBatch(opts: {
  requirements: StructuredExtractionInput[];
  llm?: OpenRouterLlmClient;
  logger?: { warn: (msg: string) => void; debug?: (msg: string) => void };
}): Promise<Map<string, StructuredRequirementSemantics>> {
  const out = new Map<string, StructuredRequirementSemantics>();
  const llm = opts.llm ?? new OpenRouterLlmClient();

  // Always seed with heuristic so offline / failures still work
  for (const req of opts.requirements) {
    out.set(req.requirementKey, resolveStructuredSemantics(req, null));
  }

  // Skip live LLM when no key — OpenRouter client mocks, but prefer deterministic heuristic for review
  if (!process.env.OPENROUTER_API_KEY) {
    opts.logger?.debug?.(
      'Structured semantics: OPENROUTER_API_KEY missing — heuristic only',
    );
    return out;
  }

  for (let i = 0; i < opts.requirements.length; i += BATCH_SIZE) {
    const batch = opts.requirements.slice(i, i + BATCH_SIZE);
    try {
      const result = await llm.complete({
        system: STRUCTURED_SEMANTIC_SYSTEM_PROMPT,
        prompt: buildBatchPrompt(batch),
        json: true,
        model: 'fast',
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.text);
      } catch {
        opts.logger?.warn(
          `Structured semantics batch ${i}: invalid JSON from LLM`,
        );
        continue;
      }
      const llmMap = parseStructuredSemanticsBatch(parsed);
      for (const req of batch) {
        const llmRow = llmMap.get(req.requirementKey);
        if (!llmRow) continue;
        out.set(req.requirementKey, resolveStructuredSemantics(req, llmRow));
      }
    } catch (err) {
      opts.logger?.warn(
        `Structured semantics batch ${i} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return out;
}

/** Test helper — coerce a single LLM-like object. */
export function coerceOne(
  raw: Record<string, unknown>,
): StructuredRequirementSemantics {
  return coerceStructuredSemantics(raw, { source: 'llm' });
}
