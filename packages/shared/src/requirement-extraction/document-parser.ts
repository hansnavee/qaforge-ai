/**
 * Document parser — separates structure from requirement semantics.
 * Produces HEADING / PARAGRAPH / LIST / TABLE / SECTION context elements.
 */

export type DocumentElement =
  | { type: 'HEADING'; level: number; text: string; role?: 'section' | 'acceptance_criteria' | 'business_rules' | 'other' }
  | { type: 'PARAGRAPH'; text: string }
  | { type: 'LIST'; ordered: boolean; items: string[] }
  | {
      type: 'TABLE';
      headers: string[];
      rows: string[][];
      section: string | null;
    };

export type ParsedDocument = {
  elements: DocumentElement[];
  sections: Array<{ type: 'SECTION'; title: string; level: number }>;
  tables: Array<{
    type: 'TABLE_DATA';
    section: string | null;
    headers: string[];
    rows: string[][];
  }>;
};

const AC_HEADING_RE =
  /^(#{1,6}\s*)?(acceptance\s*criteria|acceptance\s*criterion)\s*:?\s*$/i;
const BR_HEADING_RE =
  /^(#{1,6}\s*)?(business\s*rules?)\s*:?\s*$/i;
const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+)$/;
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\s*[.)]\s+(.+)$/;
const UNDERLINE_RE = /^[=-]{3,}\s*$/;
const BULLET_RE = /^\s*([-*+])\s+(.+)$/;
const ORDERED_RE = /^\s*(\d+)[.)]\s+(.+)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function cleanHeadingText(value: string): string {
  return stripMarkdownInline(
    value
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\d+(?:\.\d+)*\s*[.)]\s+/, '')
      .replace(/[:\-—–]+\s*$/, '')
      .trim(),
  );
}

function headingRole(
  text: string,
): 'section' | 'acceptance_criteria' | 'business_rules' | 'other' {
  if (AC_HEADING_RE.test(text)) return 'acceptance_criteria';
  if (BR_HEADING_RE.test(text)) return 'business_rules';
  return 'section';
}

function parseTableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => stripMarkdownInline(c.trim()));
}

function isLikelyHeadingBody(body: string): boolean {
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  return (
    wordCount <= 10 &&
    !/\b(should|shall|must|can|will|able to)\b/i.test(body) &&
    !/[.!?]$/.test(body)
  );
}

/**
 * Parse raw requirement source into structured document elements.
 */
export function parseRequirementDocument(sourceText: string): ParsedDocument {
  const lines = sourceText.replace(/\r\n/g, '\n').split('\n');
  const elements: DocumentElement[] = [];
  const sections: ParsedDocument['sections'] = [];
  const tables: ParsedDocument['tables'] = [];

  let currentSection: string | null = null;
  let i = 0;

  const flushList = (ordered: boolean, items: string[]) => {
    if (!items.length) return;
    elements.push({
      type: 'LIST',
      ordered,
      items: items.map((item) =>
        /[.!?]$/.test(item) ? item : item,
      ),
    });
  };

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    const next = (lines[i + 1] ?? '').trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Markdown / pipe tables
    if (TABLE_ROW_RE.test(trimmed) && TABLE_SEP_RE.test(next)) {
      const headers = parseTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim();
        if (!TABLE_ROW_RE.test(rowLine) || TABLE_SEP_RE.test(rowLine)) break;
        rows.push(parseTableCells(rowLine));
        i += 1;
      }
      const table = {
        type: 'TABLE' as const,
        headers,
        rows,
        section: currentSection,
      };
      elements.push(table);
      tables.push({
        type: 'TABLE_DATA',
        section: currentSection,
        headers,
        rows,
      });
      continue;
    }

    // Single table-like row without separator — still treat as table data, not requirement
    if (TABLE_ROW_RE.test(trimmed) && !TABLE_SEP_RE.test(trimmed)) {
      // Accumulate consecutive pipe rows as a headerless table
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = (lines[i] ?? '').trim();
        if (!TABLE_ROW_RE.test(rowLine) || TABLE_SEP_RE.test(rowLine)) break;
        rows.push(parseTableCells(rowLine));
        i += 1;
      }
      if (rows.length) {
        const headers = rows[0] ?? [];
        const body = rows.slice(1);
        const table = {
          type: 'TABLE' as const,
          headers,
          rows: body.length ? body : [],
          section: currentSection,
        };
        // If only one row, keep as header-only / data row table
        if (!body.length) {
          table.headers = [];
          table.rows = [headers];
        }
        elements.push(table);
        tables.push({
          type: 'TABLE_DATA',
          section: currentSection,
          headers: table.headers,
          rows: table.rows,
        });
      }
      continue;
    }

    // Setext heading
    if (trimmed && !MARKDOWN_HEADING_RE.test(trimmed) && UNDERLINE_RE.test(next)) {
      const text = cleanHeadingText(trimmed);
      const role = headingRole(text);
      elements.push({ type: 'HEADING', level: 2, text, role });
      if (role === 'section') {
        currentSection = text;
        sections.push({ type: 'SECTION', title: text, level: 2 });
      }
      i += 2;
      continue;
    }

    const md = trimmed.match(MARKDOWN_HEADING_RE);
    if (md) {
      const level = (md[1] ?? '#').length;
      const text = cleanHeadingText(md[2] ?? '');
      const role = headingRole(text);
      elements.push({ type: 'HEADING', level, text, role });
      if (role === 'section') {
        currentSection = text;
        sections.push({ type: 'SECTION', title: text, level });
      }
      i += 1;
      continue;
    }

    // Numbered section headings (not ordered list items that are long sentences)
    const numbered = trimmed.match(NUMBERED_HEADING_RE);
    if (numbered && isLikelyHeadingBody(numbered[2] ?? '')) {
      const text = cleanHeadingText(numbered[2] ?? '');
      const role = headingRole(text);
      elements.push({ type: 'HEADING', level: 2, text, role });
      if (role === 'section') {
        currentSection = text;
        sections.push({ type: 'SECTION', title: text, level: 2 });
      }
      i += 1;
      continue;
    }

    // Lists
    if (BULLET_RE.test(trimmed) || ORDERED_RE.test(trimmed)) {
      const ordered = ORDERED_RE.test(trimmed) && !BULLET_RE.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const listLine = (lines[i] ?? '').trim();
        if (!listLine) break;
        const b = listLine.match(BULLET_RE);
        const o = listLine.match(ORDERED_RE);
        if (ordered) {
          if (!o || BULLET_RE.test(listLine)) break;
          // Skip numbered headings that snuck in
          if (isLikelyHeadingBody(o[2] ?? '') && !/\b(should|shall|must|can)\b/i.test(o[2] ?? '')) {
            break;
          }
          items.push(stripMarkdownInline(o[2] ?? ''));
        } else {
          if (!b) break;
          items.push(stripMarkdownInline(b[2] ?? ''));
        }
        i += 1;
      }
      flushList(ordered, items);
      continue;
    }

    // Plain acceptance / business-rules labels without markdown hashes
    if (AC_HEADING_RE.test(trimmed) || BR_HEADING_RE.test(trimmed)) {
      const text = cleanHeadingText(trimmed);
      const role = headingRole(text);
      elements.push({ type: 'HEADING', level: 3, text, role });
      i += 1;
      continue;
    }

    elements.push({ type: 'PARAGRAPH', text: stripMarkdownInline(trimmed) });
    i += 1;
  }

  return { elements, sections, tables };
}
