import {
  DESIGN_TECHNIQUES,
  type DesignTechnique,
} from './techniques.js';
import {
  appAvailablePrecondition,
  isUsableAppUrl,
  openAppStep,
} from './environment.js';
import { normalizePriorityLabel, type PriorityLabel } from './priority.js';

export type DesignRequirement = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  businessRules: string[];
  featureName?: string | null;
  featureKey?: string | null;
  priority?: string | null;
};

export type DesignedTestCase = {
  id: string;
  module: string;
  scenario: string;
  preconditions: string;
  steps: string[];
  expected: string;
  priority: string;
  severity: string;
  type: string;
  automationCandidate: boolean;
  requirementKey: string;
  designTechnique: DesignTechnique;
  testingLevel?: string;
  testData?: Record<string, string>;
  featureKey?: string | null;
  designMode?: 'GENERIC' | 'UI_GROUNDED';
  priorityLabel?: PriorityLabel;
  readyForExecution?: boolean;
};

export type TechniqueCoverageReport = {
  requirementCount: number;
  caseCount: number;
  requirementsWithMultiTechnique: number;
  unmappedCases: number;
  complete: boolean;
  byRequirement: Record<
    string,
    {
      techniques: string[];
      missingTechniques: string[];
      caseCount: number;
    }
  >;
};

type ExistingCase = {
  id?: string;
  module?: string;
  scenario?: string;
  preconditions?: string;
  steps?: string[] | string;
  expected?: string;
  priority?: string;
  severity?: string;
  type?: string;
  automationCandidate?: boolean;
  requirementKey?: string | null;
  designTechnique?: string | null;
  testingLevel?: string;
  testData?: Record<string, string>;
  featureKey?: string | null;
  designMode?: string | null;
  priorityLabel?: string | null;
  readyForExecution?: boolean;
  requirementId?: string;
  technique?: string;
  testDesignTechnique?: string;
  category?: string;
  title?: string;
  name?: string;
  expectedResult?: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')))
    .map((s) => s.trim())
    .filter(Boolean);
}

function blobOf(req: DesignRequirement): string {
  return [
    req.title,
    req.description,
    ...req.acceptanceCriteria,
    ...req.businessRules,
  ]
    .join(' ')
    .toLowerCase();
}

export function parseRequirementsFromArtifact(
  raw: unknown,
): DesignRequirement[] {
  if (!raw) return [];
  const root = raw as Record<string, unknown>;
  const list = Array.isArray(root.requirements)
    ? root.requirements
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(raw)
        ? raw
        : [];
  const parsed: DesignRequirement[] = [];
  for (const item of list) {
    const row = (item ?? {}) as Record<string, unknown>;
    const id = String(row.id ?? row.requirementKey ?? row.key ?? '').trim();
    if (!id) continue;
    parsed.push({
      id,
      title: String(row.title ?? row.name ?? id).trim() || id,
      description: String(row.description ?? row.text ?? '').trim(),
      acceptanceCriteria: asStringArray(
        row.acceptanceCriteria ?? row.acceptance_criteria,
      ),
      businessRules: asStringArray(row.businessRules ?? row.business_rules),
      featureName:
        typeof row.featureName === 'string'
          ? row.featureName
          : typeof row.feature === 'string'
            ? row.feature
            : null,
      featureKey:
        typeof row.featureKey === 'string' ? row.featureKey : null,
      priority: typeof row.priority === 'string' ? row.priority : null,
    });
  }
  return parsed;
}

function hasInputFields(text: string): boolean {
  return /\b(email|password|username|user name|otp|field|input|form|credential|phone|amount|quantity|date)\b/.test(
    text,
  );
}

function isErrorFocused(text: string): boolean {
  return /\b(invalid|error|fail|reject|denied|unauthorized|blocked|incorrect)\b/.test(
    text,
  );
}

function isSuccessFocused(text: string): boolean {
  return /\b(success|succeed|valid user|can log|able to|allow|redirect|dashboard|authenticate|granted|saved|created)\b/.test(
    text,
  );
}

function hasStateLanguage(text: string): boolean {
  return /\b(log\s?in|log\s?out|sign\s?in|session|redirect|authenticated|dashboard|before|after|state|status|navigate|transition)\b/.test(
    text,
  );
}

function hasCombinations(req: DesignRequirement, text: string): boolean {
  if (req.businessRules.length >= 2) return true;
  if (req.acceptanceCriteria.length >= 3) return true;
  return /\b(and|or|if |when |unless|both|either|combination|rule)\b/.test(
    text,
  );
}

export function selectTechniques(req: DesignRequirement): DesignTechnique[] {
  const text = blobOf(req);
  const techniques: DesignTechnique[] = ['HAPPY_PATH'];

  if (isSuccessFocused(text) || !isErrorFocused(text)) {
    techniques.push('NEGATIVE');
  } else {
    techniques.push('EQUIVALENCE');
  }

  if (hasInputFields(text) || /\b(valid|invalid|format|class)\b/.test(text)) {
    if (!techniques.includes('EQUIVALENCE')) techniques.push('EQUIVALENCE');
  }

  if (
    hasInputFields(text) ||
    /\b(empty|length|min|max|limit|range|at least|at most|character|timeout|count|size)\b/.test(
      text,
    )
  ) {
    techniques.push('BOUNDARY');
  }

  if (hasCombinations(req, text)) {
    techniques.push('DECISION_TABLE');
  }

  if (hasStateLanguage(text)) {
    techniques.push('STATE_TRANSITION');
  }

  if (hasInputFields(text) || /\b(submit|click|form)\b/.test(text)) {
    techniques.push('ERROR_GUESSING');
  }

  // Every requirement gets at least two techniques.
  if (techniques.length < 2) {
    techniques.push(isErrorFocused(text) ? 'EQUIVALENCE' : 'NEGATIVE');
  }

  return DESIGN_TECHNIQUES.filter((t) => techniques.includes(t));
}

function outcome(req: DesignRequirement): string {
  return (
    req.acceptanceCriteria[0] ||
    req.description ||
    `Specified behavior for ${req.title} is observed.`
  );
}

function fields(req: DesignRequirement): string[] {
  const text = blobOf(req);
  const found: string[] = [];
  for (const name of [
    'email',
    'password',
    'username',
    'otp',
    'phone',
    'amount',
  ]) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.push(name);
  }
  return found.length ? found : ['specified input'];
}

function moduleName(req: DesignRequirement): string {
  return req.featureName?.trim() || req.title.split(/[:–-]/)[0]!.trim() || 'General';
}

function forbiddenInvention(req: DesignRequirement, text: string): boolean {
  const src = blobOf(req);
  const inventedSignup =
    /\b(sign\s?up|register|registration|create account)\b/.test(text) &&
    !/\b(sign\s?up|register|registration|create account)\b/.test(src);
  return inventedSignup;
}

function buildCase(
  req: DesignRequirement,
  technique: DesignTechnique,
  appUrl: string,
): DesignedTestCase {
  const f = fields(req);
  const expectedHappy = outcome(req);
  const preconditions = appAvailablePrecondition(appUrl, req.id, req.title);
  const open = openAppStep(appUrl);
  const module = moduleName(req);
  const priorityLabel = normalizePriorityLabel(req.priority);
  const priority =
    priorityLabel === 'HIGH' ? 'P0' : priorityLabel === 'LOW' ? 'P2' : 'P1';
  const designMode: 'GENERIC' | 'UI_GROUNDED' = isUsableAppUrl(appUrl)
    ? 'UI_GROUNDED'
    : 'GENERIC';

  const base = {
    module,
    preconditions,
    priority,
    priorityLabel,
    severity: priorityLabel === 'HIGH' ? 'high' : 'medium',
    automationCandidate: true,
    requirementKey: req.id,
    designTechnique: technique,
    testingLevel: 'FUNCTIONAL' as const,
    featureKey: req.featureKey ?? null,
    designMode,
    readyForExecution: false,
  };

  const byTechnique: Record<
    DesignTechnique,
    Pick<DesignedTestCase, 'scenario' | 'steps' | 'expected' | 'type' | 'testData'>
  > = {
    HAPPY_PATH: {
      scenario: `${req.title}: specified successful / documented behavior`,
      steps: [
        open,
        `Follow ${req.id} using valid data for ${f.join(' and ')}`,
        `Complete the action described: ${req.title}`,
        'Observe the documented outcome',
      ],
      expected: expectedHappy,
      type: 'functional',
      testData: Object.fromEntries(f.map((name) => [name, `valid-${name}`])),
    },
    EQUIVALENCE: {
      scenario: `${req.title}: valid vs invalid input class`,
      steps: [
        open,
        `Identify input classes for ${f.join(', ')} from ${req.id}`,
        'Submit one valid-class example and one invalid-class example',
        'Compare outcomes against acceptance criteria',
      ],
      expected: isErrorFocused(blobOf(req))
        ? expectedHappy
        : 'Valid class is accepted; invalid class is rejected without inventing extra features.',
      type: 'functional',
      testData: {
        validClass: `valid-${f[0]}`,
        invalidClass: `invalid-${f[0]}`,
      },
    },
    BOUNDARY: {
      scenario: `${req.title}: empty / min / max edges for ${f.join(', ')}`,
      steps: [
        open,
        `Leave ${f[0]} empty and submit`,
        `Enter a minimum-length value for ${f[0]} and submit`,
        `Enter a maximum-length / oversized value for ${f[0]} and submit`,
      ],
      expected:
        'Empty and oversized values are rejected or validated; minimum valid edge is accepted if the requirement allows it.',
      type: 'functional',
      testData: {
        empty: '',
        minEdge: 'a',
        maxEdge: 'x'.repeat(256),
      },
    },
    DECISION_TABLE: {
      scenario: `${req.title}: condition combinations from rules/AC`,
      steps: [
        open,
        `Build a decision table from rules/AC in ${req.id}`,
        'Execute at least two contrasting rule combinations',
        'Record pass/fail per combination',
      ],
      expected:
        req.businessRules[0] ||
        req.acceptanceCriteria.slice(0, 2).join('; ') ||
        'Each documented rule combination produces the specified result.',
      type: 'functional',
      testData: {
        combinationA: 'all-true',
        combinationB: 'one-false',
      },
    },
    STATE_TRANSITION: {
      scenario: `${req.title}: before/after state and navigation`,
      steps: [
        open,
        'Capture the starting state (unauthenticated / prior page)',
        `Trigger the ${req.id} action`,
        'Verify the resulting state (session, redirect, or blocked navigation)',
      ],
      expected: hasStateLanguage(blobOf(req))
        ? expectedHappy
        : 'State changes only as specified; blocked paths stay blocked.',
      type: 'functional',
      testData: { startState: 'before', endState: 'after' },
    },
    NEGATIVE: {
      scenario: `${req.title}: invalid / blocked path`,
      steps: [
        open,
        `Use invalid or incomplete data for ${f.join(' and ')}`,
        `Attempt the ${req.id} action`,
        'Confirm the success outcome does not occur',
      ],
      expected: isErrorFocused(blobOf(req))
        ? expectedHappy
        : 'Action is rejected, an error is shown if specified, and the success outcome does not occur.',
      type: 'negative',
      testData: Object.fromEntries(
        f.map((name) => [name, `invalid-${name}`]),
      ),
    },
    ERROR_GUESSING: {
      scenario: `${req.title}: common form defects (spaces, double submit)`,
      steps: [
        open,
        `Enter ${f[0]} with leading/trailing spaces`,
        'Submit once, then immediately submit again',
        'Check that only specified behavior occurs (no extra features)',
      ],
      expected:
        'Whitespace is handled consistently and double-submit does not create an extra success path.',
      type: 'negative',
      testData: { padded: '  value  ', doubleSubmit: 'true' },
    },
  };

  const spec = byTechnique[technique];
  return {
    id: 'TC-TMP',
    ...base,
    ...spec,
  };
}

function normalizeTechnique(raw: unknown): DesignTechnique | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const u = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const alias: Record<string, DesignTechnique> = {
    EP: 'EQUIVALENCE',
    EQUIVALENCE_PARTITIONING: 'EQUIVALENCE',
    BVA: 'BOUNDARY',
    BOUNDARY_VALUE: 'BOUNDARY',
    BOUNDARY_VALUE_ANALYSIS: 'BOUNDARY',
    DECISION: 'DECISION_TABLE',
    STATE: 'STATE_TRANSITION',
    HAPPY: 'HAPPY_PATH',
    POSITIVE: 'HAPPY_PATH',
  };
  const mapped = alias[u] ?? u;
  return (DESIGN_TECHNIQUES as readonly string[]).includes(mapped)
    ? (mapped as DesignTechnique)
    : null;
}

function isDetailed(tc: ExistingCase): boolean {
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  const scenario = String(tc.scenario ?? tc.title ?? tc.name ?? '');
  const expected = String(tc.expected ?? tc.expectedResult ?? '');
  return (
    scenario.trim().length >= 8 &&
    expected.trim().length >= 8 &&
    steps.length >= 1
  );
}

function toDesigned(
  tc: ExistingCase,
  index: number,
  reqKeys: Set<string>,
): DesignedTestCase | null {
  let key = String(
    tc.requirementKey ?? tc.requirementId ?? '',
  ).trim();
  if (reqKeys.size && key && !reqKeys.has(key)) {
    key = [...reqKeys][0] ?? key;
  }
  if (reqKeys.size && !key) {
    key = [...reqKeys][0] ?? 'REQ-001';
  }
  const technique =
    normalizeTechnique(
      tc.designTechnique ?? tc.technique ?? tc.testDesignTechnique,
    ) ?? 'HAPPY_PATH';
  const scenario = String(tc.scenario ?? tc.title ?? tc.name ?? '').trim();
  const expected = String(tc.expected ?? tc.expectedResult ?? '').trim();
  if (forbiddenInvention({ id: key, title: scenario, description: expected, acceptanceCriteria: [], businessRules: [] }, `${scenario} ${expected}`)) {
    return null;
  }
  const steps = Array.isArray(tc.steps)
    ? tc.steps.map(String)
    : [String(tc.steps ?? 'Execute scenario')];
  return {
    id: String(tc.id ?? `TC-${String(index + 1).padStart(3, '0')}`),
    module: String(tc.module ?? tc.category ?? 'General'),
    scenario: scenario || `Scenario ${index + 1}`,
    preconditions: String(tc.preconditions ?? 'Application available'),
    steps,
    expected: expected || 'Expected behavior observed',
    priority: String(tc.priority ?? 'P1'),
    severity: String(tc.severity ?? 'medium'),
    type: String(tc.type ?? 'functional'),
    automationCandidate: Boolean(tc.automationCandidate ?? true),
    requirementKey: key,
    designTechnique: technique,
    testingLevel: tc.testingLevel,
    testData: tc.testData,
    featureKey: tc.featureKey ?? null,
    designMode:
      tc.designMode === 'UI_GROUNDED' || tc.designMode === 'GENERIC'
        ? tc.designMode
        : undefined,
    priorityLabel: normalizePriorityLabel(tc.priorityLabel ?? tc.priority),
    readyForExecution: Boolean(tc.readyForExecution),
  };
}

export function buildTechniqueCoverage(
  cases: Array<{ requirementKey?: string | null; designTechnique?: string | null }>,
  requirements: DesignRequirement[],
): TechniqueCoverageReport {
  const byRequirement: TechniqueCoverageReport['byRequirement'] = {};
  for (const req of requirements) {
    byRequirement[req.id] = {
      techniques: [],
      missingTechniques: selectTechniques(req),
      caseCount: 0,
    };
  }
  for (const tc of cases) {
    const key = (tc.requirementKey ?? 'UNMAPPED').trim() || 'UNMAPPED';
    if (!byRequirement[key]) {
      byRequirement[key] = {
        techniques: [],
        missingTechniques: [],
        caseCount: 0,
      };
    }
    byRequirement[key]!.caseCount += 1;
    const tech = (tc.designTechnique ?? '').trim().toUpperCase();
    if (tech && !byRequirement[key]!.techniques.includes(tech)) {
      byRequirement[key]!.techniques.push(tech);
    }
  }
  for (const req of requirements) {
    const row = byRequirement[req.id]!;
    const needed = selectTechniques(req);
    row.missingTechniques = needed.filter((t) => !row.techniques.includes(t));
  }
  const mapped = Object.keys(byRequirement).filter((k) => k !== 'UNMAPPED');
  const withMulti = mapped.filter(
    (k) => (byRequirement[k]?.techniques.length ?? 0) >= 2,
  ).length;
  const complete =
    requirements.length > 0 &&
    requirements.every((r) => (byRequirement[r.id]?.missingTechniques.length ?? 0) === 0);
  return {
    requirementCount: requirements.length,
    caseCount: cases.length,
    requirementsWithMultiTechnique: withMulti,
    unmappedCases: byRequirement.UNMAPPED?.caseCount ?? 0,
    complete,
    byRequirement,
  };
}

function techniquesForReq(
  req: DesignRequirement,
  override?: DesignTechnique[],
): DesignTechnique[] {
  if (override?.length) {
    return DESIGN_TECHNIQUES.filter((t) => override.includes(t));
  }
  return selectTechniques(req);
}

export function expandTechniqueCoverage(opts: {
  requirements: DesignRequirement[] | unknown;
  existingCases?: ExistingCase[];
  appUrl?: string | null;
  techniques?: DesignTechnique[];
  fillMissing?: boolean;
}): { testCases: DesignedTestCase[]; coverage: TechniqueCoverageReport } {
  const requirements = Array.isArray(opts.requirements)
    && opts.requirements[0]
    && typeof opts.requirements[0] === 'object'
    && 'id' in (opts.requirements[0] as object)
    && 'title' in (opts.requirements[0] as object)
    ? (opts.requirements as DesignRequirement[])
    : parseRequirementsFromArtifact(opts.requirements);

  const reqKeys = new Set(requirements.map((r) => r.id));
  const kept: DesignedTestCase[] = [];
  const seen = new Set<string>();

  for (const [i, raw] of (opts.existingCases ?? []).entries()) {
    if (!isDetailed(raw)) continue;
    const tc = toDesigned(raw, i, reqKeys);
    if (!tc) continue;
    if (forbiddenInvention(
      requirements.find((r) => r.id === tc.requirementKey) ?? {
        id: tc.requirementKey,
        title: tc.scenario,
        description: tc.expected,
        acceptanceCriteria: [],
        businessRules: [],
      },
      `${tc.scenario} ${tc.expected} ${tc.steps.join(' ')}`,
    )) {
      continue;
    }
    const dedupe = `${tc.requirementKey}::${tc.designTechnique}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (isUsableAppUrl(opts.appUrl)) {
      tc.designMode = tc.designMode ?? 'UI_GROUNDED';
    } else {
      const hasOwnUrl = tc.steps.some((s) =>
        /https?:\/\/\S+/i.test(s),
      );
      if (!hasOwnUrl) {
        tc.steps = tc.steps.map((s) =>
          /^Open https?:\/\//i.test(s) ? openAppStep(null) : s,
        );
        tc.preconditions = appAvailablePrecondition(
          null,
          tc.requirementKey,
          tc.scenario,
        );
        tc.designMode = 'GENERIC';
      } else {
        tc.designMode = 'UI_GROUNDED';
      }
    }
    if (!tc.priorityLabel) {
      tc.priorityLabel = normalizePriorityLabel(tc.priority);
    }
    if (!tc.featureKey) {
      const req = requirements.find((r) => r.id === tc.requirementKey);
      tc.featureKey = req?.featureKey ?? null;
      if (
        (!tc.module || tc.module === 'General') &&
        req?.featureName?.trim()
      ) {
        tc.module = req.featureName.trim();
      }
    }
    kept.push(tc);
  }

  const fillMissing = opts.fillMissing !== false;
  if (fillMissing) {
    for (const req of requirements) {
      for (const technique of techniquesForReq(req, opts.techniques)) {
        const dedupe = `${req.id}::${technique}`;
        if (seen.has(dedupe)) continue;
        const generated = buildCase(req, technique, opts.appUrl ?? '');
        if (
          forbiddenInvention(
            req,
            `${generated.scenario} ${generated.steps.join(' ')}`,
          )
        ) {
          continue;
        }
        seen.add(dedupe);
        kept.push(generated);
      }
    }
  }

  const testCases = kept.map((tc, i) => ({
    ...tc,
    id: `TC-${String(i + 1).padStart(3, '0')}`,
  }));

  const coverage = buildTechniqueCoverage(testCases, requirements);
  if (opts.techniques?.length) {
    for (const req of requirements) {
      const row = coverage.byRequirement[req.id];
      if (!row) continue;
      const needed = techniquesForReq(req, opts.techniques);
      row.missingTechniques = needed.filter((t) => !row.techniques.includes(t));
    }
    coverage.complete =
      requirements.length > 0 &&
      requirements.every(
        (r) => (coverage.byRequirement[r.id]?.missingTechniques.length ?? 0) === 0,
      );
  }

  return {
    testCases,
    coverage,
  };
}
