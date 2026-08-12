import { finalizeExtraction } from '../requirement-extraction/finalize-extraction.js';
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
import { normalizePriorityLabel } from './priority.js';
import type { AppPageMap } from './review-app.js';
import { formatPageMapForLlm } from './review-app.js';

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

export const DEFAULT_GENERATE_TECHNIQUES: DesignTechnique[] = [
  'HAPPY_PATH',
  'NEGATIVE',
  'BOUNDARY',
];

/** Full design suite when the author asks for complete / 100% coverage. */
export const FULL_COVERAGE_TECHNIQUES: DesignTechnique[] = [...DESIGN_TECHNIQUES];

export function wantsFullCoverage(prompt: string): boolean {
  return /100\s*%|full\s+coverage|complete\s+coverage|exhaustive|maximum\s+coverage|all\s+scenarios/i.test(
    prompt,
  );
}

export function resolveGenerateTechniques(
  prompt: string,
  requested?: DesignTechnique[] | null,
): DesignTechnique[] {
  if (requested?.length) return requested;
  if (wantsFullCoverage(prompt)) return FULL_COVERAGE_TECHNIQUES;
  return DEFAULT_GENERATE_TECHNIQUES;
}

export const SENIOR_QA_GENERATE_SYSTEM = `You are a Senior QA writing executable test cases for THIS product only.

Do:
- Write MANY cases (aim for broad coverage, not a thin sample). One observable behavior per case.
- Cover every requested technique and every feature in the prompt, stored requirements, and observed UI.
- For Welcome / Login / Account pages, ALWAYS cover at least:
  1) Page load / Welcome branding and layout
  2) Valid login success
  3) Invalid password
  4) Invalid / unknown username
  5) Blank username
  6) Blank password
  7) Both fields blank
  8) Field labels, placeholders, and required markers
  9) Password masking / show-hide if present
  10) Remember me / stay signed in if present
  11) Forgot password / reset link if present
  12) Sign up / register link if present
  13) Keyboard / Enter submit
  14) Redirect after login and session cookie
  15) Locked / disabled account messaging if present
  16) XSS / SQL injection style negative input (safe strings only)
  17) Accessibility basics (focus order, error association) when UI supports it
- Put cases in clear modules (e.g. "Welcome", "Login") — not everything under General.
- Copy URL, username, password, button labels, and expected text into steps AND testData. Never use placeholders like "a valid username".
- Trace every case to a requirementKey from the input (REQ-001, …). If the author only gave a short prompt, invent REQ-001 Welcome, REQ-002 Login (and more if needed) and cover each.
- Steps must be concrete: Open URL, Enter field, Click button, Verify outcome.

Don't:
- Do not invent a different product than the one named in the prompt, requirements, or page map.
- Do not emit only a single happy-path login case when the user asked for login/welcome tests or 100% coverage.
- Do not drop URLs or credentials that appear in the source.
- Do not stop after 3–5 cases when the author asked for full / 100% coverage — produce a large suite (typically 20–50+ for login+welcome).

Return JSON only:
{"cases":[{"scenario":"","preconditions":"","steps":[""],"expected":"","type":"functional","designTechnique":"HAPPY_PATH","requirementKey":"REQ-001","priorityLabel":"HIGH","module":"Login","testData":{"username":"","password":"","appUrl":""}}]}`;


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

  const tryParse = (raw: string): unknown | undefined => {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };

  const sliceBalanced = (
    source: string,
    from: number,
    open: '{' | '[',
  ): string | null => {
    const close = open === '{' ? '}' : ']';
    if (from < 0 || source[from] !== open) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = from; i < source.length; i += 1) {
      const ch = source[i]!;
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) depth += 1;
      if (ch === close) {
        depth -= 1;
        if (depth === 0) return source.slice(from, i + 1);
      }
    }
    return null;
  };

  const salvageCaseObjects = (source: string): unknown[] => {
    const marker = source.search(/"cases"\s*:\s*\[/);
    if (marker < 0) return [];
    const arrStart = source.indexOf('[', marker);
    if (arrStart < 0) return [];
    const items: unknown[] = [];
    let i = arrStart + 1;
    while (i < source.length) {
      while (i < source.length && /[\s,]/.test(source[i]!)) i += 1;
      if (source[i] === ']') break;
      if (source[i] !== '{') break;
      const obj = sliceBalanced(source, i, '{');
      if (!obj) break;
      const parsed = tryParse(obj);
      if (parsed && typeof parsed === 'object') items.push(parsed);
      i += obj.length;
    }
    return items;
  };

  const softFix = (raw: string): string =>
    raw
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2018|\u2019/g, "'");

  const casesIdx = body.search(/\{\s*"cases"\s*:/);
  if (casesIdx >= 0) {
    const sliced = sliceBalanced(body, casesIdx, '{');
    if (sliced) {
      const parsed =
        tryParse(sliced) ?? tryParse(softFix(sliced));
      if (parsed !== undefined) return parsed;
    }
  }

  const salvaged = salvageCaseObjects(body);
  if (salvaged.length) return { cases: salvaged };

  const start = body.indexOf('{');
  const balanced = start >= 0 ? sliceBalanced(body, start, '{') : null;
  if (balanced) {
    const parsed = tryParse(balanced) ?? tryParse(softFix(balanced));
    if (parsed !== undefined) return parsed;
  }
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const chunk = body.slice(start, end + 1);
    const parsed = tryParse(chunk) ?? tryParse(softFix(chunk));
    if (parsed !== undefined) return parsed;
  }
  const arrStart = body.indexOf('[');
  const arrEnd = body.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    const chunk = body.slice(arrStart, arrEnd + 1);
    const parsed = tryParse(chunk) ?? tryParse(softFix(chunk));
    if (parsed !== undefined) return parsed;
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

export type StoredRequirementForLlm = {
  requirementKey: string;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
};

export function buildLlmGeneratePrompt(opts: {
  userPrompt: string;
  projectName?: string;
  appUrl?: string | null;
  loginUrl?: string | null;
  username?: string;
  password?: string;
  storedRequirements?: StoredRequirementForLlm[];
  pageMap?: AppPageMap | null;
  techniques: DesignTechnique[];
}): string {
  const parts = [
    opts.projectName ? `Project: ${opts.projectName}` : '',
    opts.appUrl ? `Environment URL: ${opts.appUrl}` : '',
    opts.loginUrl ? `Login URL: ${opts.loginUrl}` : '',
    opts.username ? `Username: ${opts.username}` : '',
    opts.password ? `Password: ${opts.password}` : '',
    `Requested design techniques: ${opts.techniques.join(', ')}`,
    '',
    'Author prompt:',
    opts.userPrompt.trim() || '(none — use stored requirements and observed UI)',
  ];
  if (opts.storedRequirements?.length) {
    parts.push('', 'Stored project requirements:');
    for (const r of opts.storedRequirements.slice(0, 80)) {
      const ac = (r.acceptanceCriteria ?? []).slice(0, 8).join('; ');
      parts.push(
        `${r.requirementKey}: ${r.title}\n${r.description}${ac ? `\nAC: ${ac}` : ''}`,
      );
    }
  }
  if (opts.pageMap) {
    parts.push('', 'Observed application UI:', formatPageMapForLlm(opts.pageMap));
  }
  parts.push(
    '',
    wantsFullCoverage(opts.userPrompt)
      ? 'Coverage mandate: the author asked for full / 100% coverage. Produce a LARGE suite across ALL requested techniques and Welcome/Login checklist items. Prefer 25+ cases when the scope is Welcome+Login.'
      : 'Write JSON test cases for this application only. Copy URL and credentials into every relevant case.',
    'Group cases with module "Welcome" or "Login" (or other real page names from the UI). Return JSON only.',
  );
  return parts.filter((p, i) => p !== '' || parts[i - 1] !== '').join('\n');
}

function attachRequirementKey(
  row: { scenario: string; expected: string; requirementKey?: string | null },
  requirements: DesignRequirement[],
): string {
  const given = row.requirementKey?.trim();
  if (given && requirements.some((r) => r.id === given)) return given;
  const blob = `${row.scenario} ${row.expected}`.toLowerCase();
  for (const req of requirements) {
    const words = req.title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4);
    if (words.length && words.every((w) => blob.includes(w))) return req.id;
  }
  return requirements[0]?.id ?? 'REQ-001';
}

export function assembleGeneratedCases(opts: {
  sourceText: string;
  llmCases?: unknown;
  techniques?: DesignTechnique[];
  type?: string;
  priorityLabel?: 'HIGH' | 'MEDIUM' | 'LOW';
  appUrl?: string | null;
  fillMissing?: boolean;
}): {
  requirements: DesignRequirement[];
  cases: GeneratedCasePreview[];
  coverage: TechniqueCoverageReport;
} {
  const requirements = requirementsFromSource(opts.sourceText);
  const techniques = (opts.techniques?.length
    ? opts.techniques
    : DEFAULT_GENERATE_TECHNIQUES) as DesignTechnique[];
  const llmParsed = parseLlmGeneratedCases(opts.llmCases);
  const seen = new Set<string>();
  const previews: GeneratedCasePreview[] = [];
  for (const row of llmParsed) {
    if (!row.scenario || !row.expected || !(row.steps?.length)) continue;
    const key = row.scenario.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const requirementKey = attachRequirementKey(row, requirements);
    const technique = (DESIGN_TECHNIQUES as readonly string[]).includes(
      String(row.designTechnique ?? '').toUpperCase(),
    )
      ? (String(row.designTechnique).toUpperCase() as DesignTechnique)
      : 'HAPPY_PATH';
    const moduleGuess =
      row.module ||
      (/welcome/i.test(row.scenario)
        ? 'Welcome'
        : /log\s*in|sign\s*in|password|username|account/i.test(row.scenario)
          ? 'Login'
          : 'General');
    previews.push({
      scenario: row.scenario,
      preconditions: row.preconditions ?? '',
      steps: row.steps ?? [],
      expected: row.expected,
      type: opts.type || row.type || 'functional',
      designTechnique: technique,
      requirementKey,
      priorityLabel:
        opts.priorityLabel ??
        normalizePriorityLabel(row.priorityLabel ?? row.priority),
      testData: row.testData ?? null,
      module: moduleGuess,
    });
  }
  const sourceBlob = [
    opts.sourceText,
    ...requirements.map((r) => `${r.title} ${r.description}`),
  ].join('\n');
  let cases = previews.filter((c) => {
    const blob = `${c.scenario} ${c.preconditions} ${c.steps.join(' ')} ${c.expected}`;
    return !mentionsInventedApp(blob, sourceBlob);
  });

  const fillMissing =
    opts.fillMissing === true || wantsFullCoverage(opts.sourceText);
  const asExisting = cases.map((c, i) => ({
    id: `gen-${i}`,
    scenario: c.scenario,
    preconditions: c.preconditions,
    steps: c.steps,
    expected: c.expected,
    type: c.type,
    designTechnique: c.designTechnique,
    requirementKey: c.requirementKey,
    priorityLabel: c.priorityLabel,
    testData: c.testData ?? undefined,
    module: c.module,
  }));
  const expanded = expandTechniqueCoverage({
    requirements,
    existingCases: asExisting,
    appUrl: opts.appUrl ?? null,
    techniques,
    fillMissing,
  });
  if (fillMissing) {
    for (const tc of expanded.testCases) {
      const key = tc.scenario.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({
        scenario: tc.scenario,
        preconditions: tc.preconditions,
        steps: tc.steps,
        expected: tc.expected,
        type: tc.type || 'functional',
        designTechnique: tc.designTechnique,
        requirementKey: tc.requirementKey,
        priorityLabel: normalizePriorityLabel(tc.priorityLabel ?? tc.priority),
        testData: null,
        module: tc.module || 'General',
      });
    }
  }
  if (cases.length > MAX_CASES) cases = cases.slice(0, MAX_CASES);
  const coverage = expandTechniqueCoverage({
    requirements,
    existingCases: cases.map((c, i) => ({
      id: `final-${i}`,
      scenario: c.scenario,
      preconditions: c.preconditions,
      steps: c.steps,
      expected: c.expected,
      type: c.type,
      designTechnique: c.designTechnique,
      requirementKey: c.requirementKey,
      priorityLabel: c.priorityLabel,
      testData: c.testData ?? undefined,
      module: c.module,
    })),
    appUrl: opts.appUrl ?? null,
    techniques,
    fillMissing: false,
  }).coverage;
  return {
    requirements,
    cases,
    coverage,
  };
}
