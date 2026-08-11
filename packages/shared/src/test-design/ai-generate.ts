import { finalizeExtraction } from '../requirement-extraction/finalize-extraction.js';
import {
  extractPromptFacts,
  loginCaseFromFacts,
} from './prompt-facts.js';
import {
  DESIGN_TECHNIQUES,
  type DesignTechnique,
} from './techniques.js';
import {
  expandTechniqueCoverage,
  type DesignRequirement,
  type DesignedTestCase,
  type TechniqueCoverageReport,
} from './expand-coverage.js';

const SOURCE_CHAR_CAP = 12_000;
const MAX_CASES = 80;
const INVENTED_APPS = [
  'saucedemo',
  'sauce demo',
  'demoqa',
  'the-internet.herokuapp',
  'orangehrm',
  'automationexercise',
  'swag labs',
];

export const SENIOR_QA_GENERATE_SYSTEM = `You are a Senior QA / QA Manager writing test cases for THIS product only.

Do:
- Copy every concrete detail from the requirements into the case: URL, username, password, button names, and the stated expected result.
- Write numbered, executable steps (Open URL, Enter field, Click button, Verify outcome). Preconditions must be explicit.
- Trace every case to a requirementKey from the input (REQ-001, …).
- Keep the author's meaning. One observable behavior per case.

Don't:
- Do not drop URLs, credentials, or expected results that appear in the source.
- Do not invent a different product than the one named in the requirements.
- Do not add signup or extra features unless the requirements describe them.

Return JSON only:
{"cases":[{"scenario":"","preconditions":"","steps":[""],"expected":"","type":"functional","designTechnique":"HAPPY_PATH","requirementKey":"REQ-001","priorityLabel":"HIGH","testData":{"username":"","password":"","appUrl":""}}]}`;

export type GeneratedCasePreview = {
  scenario: string;
  preconditions: string;
  steps: string[];
  expected: string;
  type: string;
  designTechnique: string;
  requirementKey: string | null;
  priorityLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  testData: Record<string, string> | null;
  module: string;
};

export function compressSourceForGeneration(
  text: string,
  maxChars = SOURCE_CHAR_CAP,
): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^#{1,6}\s+\S+$/.test(l) && l.split(/\s+/).length <= 8) return false;
      if (/^\|[-:| ]+\|$/.test(l)) return false;
      if (/^[-*]{3,}$/.test(l)) return false;
      return true;
    });
  const joined = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}\n`;
}

function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const cut = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  return cut.slice(0, 120).trim() || t.slice(0, 120);
}

function titleAgreesWithSource(title: string, source: string): boolean {
  const src = source.toLowerCase();
  const extra = title
    .toLowerCase()
    .split(/\W+/)
    .filter(
      (w) =>
        w.length > 3 &&
        !src.includes(w) &&
        !/^(with|from|that|this|must|should|user|when)$/.test(w),
    );
  return extra.length === 0;
}

export function requirementsFromSource(
  sourceText: string,
  documentName = 'prompt',
): DesignRequirement[] {
  const compressed = compressSourceForGeneration(sourceText);
  const finalized = finalizeExtraction({
    sourceText: compressed,
    documentName,
  });
  const mapped: DesignRequirement[] = finalized.requirements.map((r) => {
    const description = r.description || r.source.text || compressed;
    const title = titleAgreesWithSource(r.title, compressed)
      ? r.title
      : firstSentence(description);
    return {
      id: r.requirementKey,
      title,
      description,
      acceptanceCriteria: r.acceptanceCriteria,
      businessRules: r.businessRules,
      featureName: r.source.section,
      featureKey: null,
      priority: r.priority,
    };
  });
  if (mapped.length) return mapped;
  const blob = compressed.trim();
  if (!blob) return [];
  return [
    {
      id: 'REQ-001',
      title: firstSentence(blob),
      description: blob,
      acceptanceCriteria: [],
      businessRules: [],
      featureName: null,
      featureKey: null,
      priority: null,
    },
  ];
}

export function packRequirementsForLlm(
  requirements: DesignRequirement[],
  maxChars = SOURCE_CHAR_CAP,
): string {
  const packed = requirements.map((r) => ({
    id: r.id,
    title: r.title,
    text: r.description,
    ac: r.acceptanceCriteria.slice(0, 8),
    rules: r.businessRules.slice(0, 8),
  }));
  const json = JSON.stringify(packed);
  return json.length <= maxChars ? json : json.slice(0, maxChars);
}

export function parseLlmGeneratedCases(raw: unknown): Array<{
  scenario: string;
  preconditions?: string;
  steps?: string[];
  expected: string;
  type?: string;
  designTechnique?: string;
  requirementKey?: string | null;
  priorityLabel?: string;
  priority?: string;
  testData?: Record<string, string>;
  module?: string;
}> {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.cases)
    ? root.cases
    : Array.isArray(root.testCases)
      ? root.testCases
      : Array.isArray(raw)
        ? raw
        : [];
  const out: ReturnType<typeof parseLlmGeneratedCases> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const scenario = String(
      row.scenario ?? row.title ?? row.name ?? '',
    ).trim();
    const expected = String(
      row.expected ?? row.expectedResult ?? '',
    ).trim();
    if (!scenario || !expected) continue;
    const steps = Array.isArray(row.steps)
      ? row.steps.map((s) => String(s).trim()).filter(Boolean)
      : [];
    out.push({
      scenario,
      preconditions: String(row.preconditions ?? ''),
      steps,
      expected,
      type: typeof row.type === 'string' ? row.type : undefined,
      designTechnique:
        typeof row.designTechnique === 'string'
          ? row.designTechnique
          : typeof row.technique === 'string'
            ? row.technique
            : undefined,
      requirementKey:
        typeof row.requirementKey === 'string'
          ? row.requirementKey
          : typeof row.requirementId === 'string'
            ? row.requirementId
            : null,
      priorityLabel:
        typeof row.priorityLabel === 'string' ? row.priorityLabel : undefined,
      priority: typeof row.priority === 'string' ? row.priority : undefined,
      testData:
        row.testData && typeof row.testData === 'object'
          ? Object.fromEntries(
              Object.entries(row.testData as Record<string, unknown>).map(
                ([k, v]) => [k, String(v)],
              ),
            )
          : undefined,
      module: typeof row.module === 'string' ? row.module : undefined,
    });
  }
  return out;
}

export function parseJsonFromLlm(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(body.slice(start, end + 1));
  }
  const arrStart = body.indexOf('[');
  const arrEnd = body.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    return JSON.parse(body.slice(arrStart, arrEnd + 1));
  }
  return JSON.parse(body);
}

function mentionsInventedApp(text: string, source: string): boolean {
  const hay = text.toLowerCase();
  const src = source.toLowerCase();
  return INVENTED_APPS.some((name) => hay.includes(name) && !src.includes(name));
}

export function dropInventedCases(
  cases: DesignedTestCase[],
  sourceText: string,
  requirements: DesignRequirement[],
): DesignedTestCase[] {
  const source = [
    sourceText,
    ...requirements.map((r) => `${r.title} ${r.description}`),
  ].join('\n');
  return cases.filter((tc) => {
    const blob = `${tc.scenario} ${tc.preconditions} ${tc.steps.join(' ')} ${tc.expected}`;
    return !mentionsInventedApp(blob, source);
  });
}

export function toPreviewCase(tc: DesignedTestCase): GeneratedCasePreview {
  return {
    scenario: tc.scenario,
    preconditions: tc.preconditions,
    steps: tc.steps,
    expected: tc.expected,
    type: tc.type,
    designTechnique: tc.designTechnique,
    requirementKey: tc.requirementKey || null,
    priorityLabel: tc.priorityLabel ?? 'MEDIUM',
    testData: tc.testData ?? null,
    module: tc.module,
  };
}

export function assembleGeneratedCases(opts: {
  sourceText: string;
  llmCases?: unknown;
  techniques?: DesignTechnique[];
  type?: string;
  priorityLabel?: 'HIGH' | 'MEDIUM' | 'LOW';
}): {
  requirements: DesignRequirement[];
  cases: GeneratedCasePreview[];
  coverage: TechniqueCoverageReport;
} {
  const requirements = requirementsFromSource(opts.sourceText);
  const facts = extractPromptFacts(opts.sourceText);
  const techniques = (opts.techniques?.length
    ? opts.techniques
    : ['HAPPY_PATH']) as DesignTechnique[];
  const llmParsed = parseLlmGeneratedCases(opts.llmCases);
  const seeded = loginCaseFromFacts(
    facts,
    requirements[0]?.id ?? 'REQ-001',
  );
  const existing = [
    ...(seeded ? [seeded] : []),
    ...llmParsed,
  ];
  const expanded = expandTechniqueCoverage({
    requirements,
    existingCases: existing,
    appUrl: facts.appUrl,
    techniques,
    fillMissing: existing.length === 0,
  });
  let kept = dropInventedCases(
    expanded.testCases,
    opts.sourceText,
    requirements,
  );
  if (!kept.length && seeded) {
    kept = expandTechniqueCoverage({
      requirements,
      existingCases: [seeded],
      appUrl: facts.appUrl,
      techniques: ['HAPPY_PATH'],
      fillMissing: false,
    }).testCases;
  }
  if (kept.length > MAX_CASES) kept = kept.slice(0, MAX_CASES);
  const cases = kept.map((tc) => {
    const preview = toPreviewCase(tc);
    if (opts.type) preview.type = opts.type;
    if (opts.priorityLabel) preview.priorityLabel = opts.priorityLabel;
    return preview;
  });
  return {
    requirements,
    cases,
    coverage: expandTechniqueCoverage({
      requirements,
      existingCases: kept,
      appUrl: null,
      techniques,
    }).coverage,
  };
}
