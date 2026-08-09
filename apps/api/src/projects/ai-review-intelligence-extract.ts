/**
 * AI-driven Step 2 review intelligence (OpenRouter).
 * Feature grouping + per-requirement intent/impact/gaps/questions.
 * Falls back to caller-supplied heuristic results when LLM unavailable/fails.
 */

import { OpenRouterLlmClient } from '@qaforge/agent-sdk';
import {
  AI_FEATURE_GROUPING_SYSTEM_PROMPT,
  AI_REQUIREMENT_INTELLIGENCE_SYSTEM_PROMPT,
  parseAiFeatureGroupsPayload,
  parseAiRequirementIntelligenceBatch,
  type AiRequirementIntelligence,
  type FeatureGroupDraft,
} from '@qaforge/shared';

const BATCH_SIZE = 10;

export type AiReviewReqInput = {
  requirementKey: string;
  title: string;
  description: string;
  sourceText?: string | null;
  type?: string | null;
};

export async function extractAiFeatureGroups(opts: {
  requirements: AiReviewReqInput[];
  llm?: OpenRouterLlmClient;
  logger?: { warn: (msg: string) => void; log?: (msg: string) => void };
}): Promise<FeatureGroupDraft[] | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    opts.logger?.log?.(
      'AI feature grouping: OPENROUTER_API_KEY missing — heuristic fallback',
    );
    return null;
  }
  const llm = opts.llm ?? new OpenRouterLlmClient();
  const keys = opts.requirements.map((r) => r.requirementKey);
  const prompt = `Group these requirements by business capability for ANY domain.

Requirements:
${JSON.stringify(
  opts.requirements.map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    sourceText: r.sourceText ?? null,
    type: r.type ?? null,
  })),
  null,
  2,
)}`;

  try {
    const result = await llm.complete({
      system: AI_FEATURE_GROUPING_SYSTEM_PROMPT,
      prompt,
      json: true,
      model: 'reasoning',
    });
    const parsed = JSON.parse(result.text) as unknown;
    const drafts = parseAiFeatureGroupsPayload(parsed, keys);
    if (!drafts) {
      opts.logger?.warn(
        'AI feature grouping: invalid/incomplete payload — heuristic fallback',
      );
      return null;
    }
    opts.logger?.log?.(
      `AI feature grouping: accepted ${drafts.length} features covering ${keys.length} requirements`,
    );
    return drafts;
  } catch (err) {
    opts.logger?.warn(
      `AI feature grouping failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export async function extractAiRequirementIntelligence(opts: {
  requirements: AiReviewReqInput[];
  llm?: OpenRouterLlmClient;
  logger?: { warn: (msg: string) => void; log?: (msg: string) => void };
}): Promise<Map<string, AiRequirementIntelligence>> {
  const out = new Map<string, AiRequirementIntelligence>();
  if (!process.env.OPENROUTER_API_KEY) {
    opts.logger?.log?.(
      'AI requirement intelligence: OPENROUTER_API_KEY missing — heuristic fallback',
    );
    return out;
  }
  const llm = opts.llm ?? new OpenRouterLlmClient();

  for (let i = 0; i < opts.requirements.length; i += BATCH_SIZE) {
    const batch = opts.requirements.slice(i, i + BATCH_SIZE);
    const prompt = `Analyze each requirement for test-readiness intelligence.

Requirements:
${JSON.stringify(
  batch.map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    sourceText: r.sourceText ?? null,
    type: r.type ?? null,
  })),
  null,
  2,
)}`;
    try {
      const result = await llm.complete({
        system: AI_REQUIREMENT_INTELLIGENCE_SYSTEM_PROMPT,
        prompt,
        json: true,
        model: 'reasoning',
      });
      const parsed = JSON.parse(result.text) as unknown;
      const map = parseAiRequirementIntelligenceBatch(parsed);
      for (const [k, v] of map) out.set(k, v);
    } catch (err) {
      opts.logger?.warn(
        `AI requirement intelligence batch ${i} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  opts.logger?.log?.(
    `AI requirement intelligence: accepted ${out.size}/${opts.requirements.length}`,
  );
  return out;
}
