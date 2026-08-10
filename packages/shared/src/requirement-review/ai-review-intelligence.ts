/**
 * Domain-agnostic AI review intelligence contracts + static rails.
 *
 * AI decides: feature grouping, business intent, impact, missing info, questions.
 * Static code only: schema coerce, enum enforcement, cleanup, merge, fallback hooks.
 * No feature-specific keyword rules (e.g. "Password Reset = HIGH").
 */

import { questionBucket } from './question-utils.js';
import {
  computeReadinessScore,
  deriveStatuses,
} from './scoring.js';
import {
  BUSINESS_IMPACT_LEVELS,
  REVIEW_QUESTION_CATEGORIES,
  REVIEW_QUESTION_PRIORITIES,
  REVIEW_REQUIREMENT_TYPES,
  type BusinessImpact,
  type FeatureGroupDraft,
  type RequirementAnalysisResult,
  type ReviewFact,
  type ReviewQuestionCategory,
  type ReviewQuestionDraft,
  type ReviewQuestionPriority,
  type ReviewRequirementType,
} from './types.js';

export type AiFeatureGroupProposal = {
  name: string;
  businessArea: string;
  businessCapability: string;
  businessIntent: string;
  requirementKeys: string[];
  dependsOnFeatures?: string[];
};

export type AiRequirementIntelligence = {
  requirementKey: string;
  businessIntent: string | null;
  businessImpact: BusinessImpact;
  primaryType: ReviewRequirementType | null;
  secondaryType: ReviewRequirementType | null;
  missingInformation: string[];
  questions: ReviewQuestionDraft[];
  confidence: number;
};

export type AiReviewIntelligenceBatch = {
  features: AiFeatureGroupProposal[];
  requirements: AiRequirementIntelligence[];
  /** true when AI proposals were accepted (not heuristic fallback) */
  usedAi: boolean;
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function enforceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const u = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  const hit = allowed.find((a) => a === u);
  return hit ?? fallback;
}

function cleanText(v: unknown, max = 500): string {
  return asString(v).replace(/\s+/g, ' ').slice(0, max);
}

function fact(
  text: string,
  status: ReviewFact['status'],
  source?: string | null,
): ReviewFact {
  return {
    text,
    status,
    source: source ?? null,
    intentSource:
      status === 'CONFIRMED'
        ? 'EXPLICIT'
        : status === 'DERIVED_FROM_USER_ANSWER'
          ? 'USER_CONFIRMED'
          : 'AI_INFERRED',
  };
}

export function coerceAiQuestions(raw: unknown): ReviewQuestionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewQuestionDraft[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const question = cleanText(row.question ?? row.text, 400);
    if (question.length < 8) continue;
    const category = enforceEnum(
      row.category,
      REVIEW_QUESTION_CATEGORIES,
      'BUSINESS_RULE',
    ) as ReviewQuestionCategory;
    const priority = enforceEnum(
      row.priority,
      REVIEW_QUESTION_PRIORITIES,
      'MEDIUM',
    ) as ReviewQuestionPriority;
    const reason =
      cleanText(row.reason, 300) ||
      'Clarification needed for testable behavior.';
    const blocking =
      row.blocking === true ||
      priority === 'CRITICAL' ||
      String(row.blocking).toLowerCase() === 'true';
    const fingerprint = questionBucket(question);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({
      category,
      priority,
      question,
      reason,
      blocking,
      fingerprint,
    });
  }
  return out.slice(0, 6);
}

export function coerceAiRequirementIntelligence(
  raw: unknown,
): AiRequirementIntelligence | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const requirementKey = asString(row.requirementKey ?? row.id);
  if (!requirementKey) return null;

  const impact = enforceEnum(
    row.businessImpact ?? row.impact,
    BUSINESS_IMPACT_LEVELS,
    'MEDIUM',
  ) as BusinessImpact;

  let primaryType: ReviewRequirementType | null = null;
  let secondaryType: ReviewRequirementType | null = null;
  if (row.primaryType != null && String(row.primaryType).trim()) {
    primaryType = enforceEnum(
      row.primaryType,
      REVIEW_REQUIREMENT_TYPES,
      'FUNCTIONAL',
    ) as ReviewRequirementType;
  }
  if (row.secondaryType != null && String(row.secondaryType).trim()) {
    secondaryType = enforceEnum(
      row.secondaryType,
      REVIEW_REQUIREMENT_TYPES,
      'BUSINESS_RULE',
    ) as ReviewRequirementType;
  }

  const missingInformation = Array.isArray(row.missingInformation)
    ? row.missingInformation
        .map((x) => cleanText(x, 240))
        .filter((x) => x.length > 3)
        .slice(0, 8)
    : Array.isArray(row.gaps)
      ? row.gaps
          .map((x) => cleanText(x, 240))
          .filter((x) => x.length > 3)
          .slice(0, 8)
      : [];

  const confidence = Math.max(
    0,
    Math.min(1, Number(row.confidence ?? 0.8) || 0.8),
  );

  const intentRaw = row.businessIntent ?? row.intent;
  const businessIntent =
    intentRaw == null || intentRaw === ''
      ? null
      : cleanText(intentRaw, 400) || null;

  return {
    requirementKey,
    businessIntent,
    businessImpact: impact,
    primaryType,
    secondaryType,
    missingInformation,
    questions: coerceAiQuestions(row.questions),
    confidence,
  };
}

/**
 * Coerce AI feature proposals into FeatureGroupDraft[].
 * Ensures every requirement key is assigned exactly once.
 */
export function coerceAiFeatureGroups(
  raw: unknown,
  allRequirementKeys: string[],
): FeatureGroupDraft[] {
  const keySet = new Set(allRequirementKeys);
  const root = raw as { features?: unknown[] };
  const list = Array.isArray(root?.features)
    ? root.features
    : Array.isArray(raw)
      ? raw
      : [];

  const assigned = new Set<string>();
  const drafts: FeatureGroupDraft[] = [];
  let idx = 1;

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = cleanText(row.name ?? row.featureName, 80);
    if (name.length < 2) continue;
    const keysRaw = Array.isArray(row.requirementKeys)
      ? row.requirementKeys
      : Array.isArray(row.requirements)
        ? row.requirements
        : [];
    const requirementKeys = keysRaw
      .map((k) => asString(k))
      .filter((k) => keySet.has(k) && !assigned.has(k));
    for (const k of requirementKeys) assigned.add(k);
    if (requirementKeys.length === 0) continue;

    drafts.push({
      featureKey: `FG-${String(idx).padStart(3, '0')}`,
      name,
      businessArea:
        cleanText(row.businessArea ?? row.area, 80) || 'Unclassified',
      businessCapability:
        cleanText(row.businessCapability ?? row.capability, 200) ||
        'Review manually for correct business capability.',
      businessIntent:
        cleanText(row.businessIntent ?? row.intent, 400) ||
        `Support the business outcomes described by ${name}.`,
      requirementKeys,
    });
    idx += 1;
  }

  // Orphan keys → Unclassified bucket (static safety rail)
  const orphans = allRequirementKeys.filter((k) => !assigned.has(k));
  if (orphans.length) {
    drafts.push({
      featureKey: `FG-${String(idx).padStart(3, '0')}`,
      name: 'Unclassified',
      businessArea: 'Other',
      businessCapability: 'Review manually for correct business capability.',
      businessIntent:
        'These requirements could not be confidently grouped; confirm their business capability.',
      requirementKeys: orphans,
    });
  }

  return drafts;
}

export function parseAiFeatureGroupsPayload(
  payload: unknown,
  allRequirementKeys: string[],
): FeatureGroupDraft[] | null {
  try {
    const drafts = coerceAiFeatureGroups(payload, allRequirementKeys);
    if (drafts.length === 0) return null;
    // Coverage of AI-named features only (ignore Unclassified orphans rail)
    const aiCovered = drafts
      .filter((d) => d.name !== 'Unclassified')
      .reduce((n, d) => n + d.requirementKeys.length, 0);
    if (aiCovered < allRequirementKeys.length * 0.5) return null;
    return drafts;
  } catch {
    return null;
  }
}

export function parseAiRequirementIntelligenceBatch(
  payload: unknown,
): Map<string, AiRequirementIntelligence> {
  const out = new Map<string, AiRequirementIntelligence>();
  const root = payload as { requirements?: unknown[] };
  const list = Array.isArray(root?.requirements)
    ? root.requirements
    : Array.isArray(payload)
      ? payload
      : [];
  for (const item of list) {
    const coerced = coerceAiRequirementIntelligence(item);
    if (!coerced || coerced.confidence < 0.55) continue;
    out.set(coerced.requirementKey, coerced);
  }
  return out;
}

/**
 * Merge AI intelligence into heuristic analysis result.
 * Preserves structured semantics / functional facts from baseline.
 * Replaces intent, impact, questions, and missing-info gaps when AI provides them.
 */
export function mergeAiIntoAnalysis(
  base: RequirementAnalysisResult,
  ai: AiRequirementIntelligence | null | undefined,
): RequirementAnalysisResult {
  if (!ai) return base;

  const businessReview = { ...base.businessReview };
  if (ai.businessIntent) {
    businessReview.intent = fact(ai.businessIntent, 'INFERRED', 'ai-review');
  }

  const missingFacts = ai.missingInformation.map((text) =>
    fact(text, 'MISSING', 'ai-review'),
  );
  if (missingFacts.length) {
    businessReview.preconditions = [
      ...(businessReview.preconditions ?? []),
      ...missingFacts,
    ];
  }

  // Prefer AI questions when present; else keep heuristic questions
  const questions =
    ai.questions.length > 0
      ? ai.questions
      : base.questions;

  const primaryType = ai.primaryType ?? base.primaryType;
  const secondaryType =
    ai.secondaryType !== undefined ? ai.secondaryType : base.secondaryType;
  const businessImpact = ai.businessImpact || base.businessImpact;

  const { businessReadiness, reviewStatus } = deriveStatuses({
    openQuestions: questions,
    functionalCompleteness: base.functionalCompleteness,
  });
  const readinessScore = computeReadinessScore(
    questions.map((q) => ({
      priority: q.priority,
      category: q.category,
      blocking: q.blocking,
    })),
  );

  return {
    ...base,
    businessReview,
    questions,
    businessReadiness,
    reviewStatus,
    readinessScore,
    primaryType,
    secondaryType,
    businessImpact,
    intentSource: ai.businessIntent ? 'AI_INFERRED' : base.intentSource,
    businessIntentText: ai.businessIntent ?? base.businessIntentText,
  };
}

export const AI_FEATURE_GROUPING_SYSTEM_PROMPT = `You are a senior BA/QA analyst grouping software requirements by business capability.
Return ONLY valid JSON. Work for ANY domain (ecommerce, HR, healthcare, logistics, CRM, SaaS, unknown).
Do NOT assume an ecommerce catalog. Invent feature names from the text itself.
Group by business purpose / capability, not by document order alone.
Every requirementKey must appear in exactly one feature.
If unsure, use a clear descriptive feature name rather than "Other".

JSON shape:
{
  "features": [
    {
      "name": "Short feature name",
      "businessArea": "Business area",
      "businessCapability": "What capability this feature delivers",
      "businessIntent": "Why this feature exists for the business",
      "requirementKeys": ["REQ-001", "REQ-002"]
    }
  ]
}`;

export const AI_REQUIREMENT_INTELLIGENCE_SYSTEM_PROMPT = `You are a senior BA/QA analyst reviewing software requirements for test readiness.
Return ONLY valid JSON. Work ONLY from the provided requirement text for THIS application — do not assume ecommerce, payments, login, or any other domain.

Quality rules (non-negotiable):
- NEVER rewrite, expand, or replace the user's requirement title, description, acceptance criteria, examples, or test data.
- NEVER invent confirmed business rules, sample users, passwords, URLs, or product behavior that is not in the source text.
- If information is missing or ambiguous, ask a concise clarifying question — do not fill the gap yourself.
- Keep businessIntent to one short sentence grounded in the text (or null if unknowable).
- Prefer fewer, higher-value questions (max 3 per requirement unless CRITICAL gaps remain).
- Impact must come from consequence stated or clearly implied in THIS requirement — not feature-name stereotypes.
- Stay concise: short missingInformation strings; no essays.

For each requirement provide:
- businessIntent: one sentence business purpose (null if truly unknowable)
- businessImpact: CRITICAL|HIGH|MEDIUM|LOW based on business consequence if wrong
- primaryType: FUNCTIONAL|BUSINESS_RULE|NON_FUNCTIONAL
- secondaryType: optional same enum or null
- missingInformation: short strings for gaps that block confident testing
- questions: 0-3 clarification questions with category, priority, question, reason, blocking
- confidence: 0..1 for this analysis

Allowed question categories:
BUSINESS_RULE, BUSINESS_FLOW, ACTOR, ROLE_PERMISSION, PRECONDITION, STATE, STATE_TRANSITION,
EXCEPTION, BUSINESS_OUTCOME, FUNCTIONAL_BEHAVIOR, VALIDATION, ERROR_HANDLING, INPUT, OUTPUT, NAVIGATION, DATA

Allowed priorities: CRITICAL, HIGH, MEDIUM, LOW

JSON shape:
{
  "requirements": [
    {
      "requirementKey": "REQ-001",
      "businessIntent": "...",
      "businessImpact": "HIGH",
      "primaryType": "FUNCTIONAL",
      "secondaryType": null,
      "missingInformation": ["..."],
      "questions": [
        {
          "category": "BUSINESS_RULE",
          "priority": "HIGH",
          "question": "...",
          "reason": "...",
          "blocking": true
        }
      ],
      "confidence": 0.8
    }
  ]
}`;
