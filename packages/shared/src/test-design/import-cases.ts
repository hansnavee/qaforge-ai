export type ImportedCaseRow = {
  externalId?: string;
  folder?: string;
  scenario: string;
  preconditions?: string;
  steps?: string[];
  expected: string;
  priority?: string;
  priorityLabel?: string;
  severity?: string;
  type?: string;
  requirementKey?: string;
  designTechnique?: string;
  featureKey?: string;
  caseStatus?: string;
  testData?: Record<string, string>;
  customFields?: Record<string, string>;
};

const HEADER_ALIASES: Record<string, string> = {
  id: 'externalId',
  externalid: 'externalId',
  folder: 'folder',
  foldername: 'folder',
  module: 'folder',
  scenario: 'scenario',
  title: 'scenario',
  name: 'scenario',
  preconditions: 'preconditions',
  steps: 'steps',
  expected: 'expected',
  expectedresult: 'expected',
  priority: 'priority',
  prioritylabel: 'priorityLabel',
  severity: 'severity',
  type: 'type',
  requirementkey: 'requirementKey',
  requirement: 'requirementKey',
  designtechnique: 'designTechnique',
  technique: 'designTechnique',
  featurekey: 'featureKey',
  casestatus: 'caseStatus',
  status: 'caseStatus',
  testdata: 'testData',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function parseTestData(raw: string): Record<string, string> | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, String(v)]),
      );
    } catch {
      /* fall through */
    }
  }
  const out: Record<string, string> = {};
  for (const line of t.split(/[|\n]/)) {
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function mapRow(
  headers: string[],
  values: string[],
): ImportedCaseRow | { error: string } {
  const rec: Record<string, string> = {};
  const custom: Record<string, string> = {};
  headers.forEach((h, i) => {
    const value = (values[i] ?? '').trim();
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (key) rec[key] = value;
    else if (/^cf_/i.test(h.trim()) || h.trim().toLowerCase().startsWith('custom')) {
      const ck = h.replace(/^cf_/i, '').trim();
      if (ck) custom[ck] = value;
    }
  });
  const scenario = rec.scenario?.trim() ?? '';
  const expected = rec.expected?.trim() ?? '';
  if (!scenario || !expected) {
    return { error: 'scenario and expected are required' };
  }
  const steps = rec.steps
    ? rec.steps
        .split(/\s*\|\s*|\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return {
    externalId: rec.externalId || undefined,
    folder: rec.folder || undefined,
    scenario,
    preconditions: rec.preconditions,
    steps,
    expected,
    priority: rec.priority,
    priorityLabel: rec.priorityLabel,
    severity: rec.severity,
    type: rec.type,
    requirementKey: rec.requirementKey,
    designTechnique: rec.designTechnique,
    featureKey: rec.featureKey,
    caseStatus: rec.caseStatus,
    testData: parseTestData(rec.testData ?? ''),
    customFields: Object.keys(custom).length ? custom : undefined,
  };
}

export function rowsFromCsv(text: string): {
  rows: ImportedCaseRow[];
  errors: Array<{ line: number; message: string }>;
} {
  const table = parseCsvText(text);
  const header = table[0];
  if (!header?.length) return { rows: [], errors: [{ line: 1, message: 'Empty file' }] };
  const rows: ImportedCaseRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  for (let i = 1; i < table.length; i += 1) {
    const mapped = mapRow(header, table[i] ?? []);
    if ('error' in mapped) errors.push({ line: i + 1, message: mapped.error });
    else rows.push(mapped);
  }
  return { rows, errors };
}

export function rowsFromJson(raw: unknown): {
  rows: ImportedCaseRow[];
  errors: Array<{ line: number; message: string }>;
} {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { cases?: unknown }).cases)
      ? ((raw as { cases: unknown[] }).cases)
      : null;
  if (!list) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'JSON must be an array or { cases: [] }' }],
    };
  }
  const rows: ImportedCaseRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push({ line: i + 1, message: 'Row is not an object' });
      return;
    }
    const r = item as Record<string, unknown>;
    const custom: Record<string, string> = {};
    if (r.customFields && typeof r.customFields === 'object') {
      for (const [k, v] of Object.entries(r.customFields as Record<string, unknown>)) {
        custom[k] = String(v);
      }
    }
    const mapped = mapRow(
      [
        'id',
        'folder',
        'scenario',
        'preconditions',
        'steps',
        'expected',
        'priority',
        'priorityLabel',
        'severity',
        'type',
        'requirementKey',
        'designTechnique',
        'featureKey',
        'caseStatus',
        'testData',
      ],
      [
        String(r.id ?? r.externalId ?? ''),
        String(r.folder ?? r.module ?? ''),
        String(r.scenario ?? r.title ?? ''),
        String(r.preconditions ?? ''),
        Array.isArray(r.steps) ? r.steps.map(String).join(' | ') : String(r.steps ?? ''),
        String(r.expected ?? ''),
        String(r.priority ?? ''),
        String(r.priorityLabel ?? ''),
        String(r.severity ?? ''),
        String(r.type ?? ''),
        String(r.requirementKey ?? ''),
        String(r.designTechnique ?? ''),
        String(r.featureKey ?? ''),
        String(r.caseStatus ?? ''),
        typeof r.testData === 'string'
          ? r.testData
          : r.testData
            ? JSON.stringify(r.testData)
            : '',
      ],
    );
    if ('error' in mapped) {
      errors.push({ line: i + 1, message: mapped.error });
      return;
    }
    if (Object.keys(custom).length) mapped.customFields = custom;
    rows.push(mapped);
  });
  return { rows, errors };
}

/** SpreadsheetML produced by our XLS export. */
export function rowsFromSpreadsheetMl(xml: string): {
  rows: ImportedCaseRow[];
  errors: Array<{ line: number; message: string }>;
} {
  const rowBlocks = [...xml.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/gi)];
  const table: string[][] = [];
  for (const block of rowBlocks) {
    const cells = [...(block[1] ?? '').matchAll(/<Data\b[^>]*>([\s\S]*?)<\/Data>/gi)];
    table.push(cells.map((c) => decodeXml(c[1] ?? '')));
  }
  if (!table.length) {
    return { rows: [], errors: [{ line: 1, message: 'No rows in spreadsheet' }] };
  }
  const header = table[0]!;
  const rows: ImportedCaseRow[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  for (let i = 1; i < table.length; i += 1) {
    const mapped = mapRow(header, table[i] ?? []);
    if ('error' in mapped) errors.push({ line: i + 1, message: mapped.error });
    else rows.push(mapped);
  }
  return { rows, errors };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
