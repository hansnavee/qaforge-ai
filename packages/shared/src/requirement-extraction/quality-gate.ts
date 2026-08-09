/**
 * Hard rejection / quality gate for requirement candidates.
 * AI output must pass this before it can become a Final Requirement.
 */

export type RejectReason =
  | 'DOCUMENT_HEADING'
  | 'SECTION_LABEL'
  | 'ACCEPTANCE_CRITERIA_LABEL'
  | 'TABLE_HEADER'
  | 'TABLE_ROW'
  | 'FORMATTING_FRAGMENT'
  | 'ISOLATED_LIST_ITEM'
  | 'INCOMPLETE_SENTENCE'
  | 'EMPTY'
  | 'NO_SEMANTIC_CONTENT'
  | 'SUPPORTING_INFORMATION_ONLY'
  | 'DUPLICATE';

export type RequirementCandidate = {
  title?: string | null;
  description?: string | null;
  sourceText?: string | null;
  section?: string | null;
  type?: string | null;
  acceptanceCriteria?: string[];
  businessRules?: string[];
  supportingInformation?: string[];
  sourceElementType?: string | null;
};

const AC_LABEL_RE =
  /^(#{1,6}\s*)?(acceptance\s*criteria|acceptance\s*criterion)\s*:?\s*$/i;
const SECTION_LABEL_RE =
  /^(#{1,6}\s*)?(\d+(\.\d+)*\s*[.)]\s*)?(business\s*rules?|product\s+data|non[- ]?functional|uses|payment|checkout|product\s+details?|user\s+registration|user\s+login|password\s+reset|shopping\s+cart|product\s+search|order\s+history)\s*:?\s*$/i;
const HEADING_MARK_RE = /^#{1,6}\s+/;
const NUMBERED_HEADING_RE = /^\d+(\.\d+)*\s*[.)]\s+\S+/;
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
const TABLE_CELLS_RE = /^[^|\n]+\s*\|\s*[^|\n]+/;
const BULLET_RE = /^\s*[-*+]\s+/;
const BOLD_ONLY_RE = /^\s*\*\*[^*]+\*\*\s*$/;
const REQUIREMENT_SIGNAL_RE =
  /\b(should|shall|must|can|cannot|will|need\s+to|able\s+to|allow|allowed|supports?|display|redirect|require|prevent|enable|provide|expire|unique|secure|fast|work\s+on|login|register|search|filter|add|remove|purchase|submit|respond|create|manage|view)\b/i;

function strip(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(\.\d+)*\s*[.)]\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function allText(c: RequirementCandidate): string {
  return [c.title, c.description, c.sourceText].filter(Boolean).join('\n');
}

export function isHeadingText(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  // Explicit markdown / numbered heading markers
  if (HEADING_MARK_RE.test(raw)) return true;
  if (NUMBERED_HEADING_RE.test(raw) && !REQUIREMENT_SIGNAL_RE.test(raw)) {
    return true;
  }
  const cleaned = strip(raw);
  if (AC_LABEL_RE.test(raw) || AC_LABEL_RE.test(cleaned)) return true;
  // Document title style without requirement verbs
  if (
    /\b(product\s+requirements|requirements\s+document|\bprd\b)\b/i.test(cleaned) &&
    !REQUIREMENT_SIGNAL_RE.test(cleaned)
  ) {
    return true;
  }
  return false;
}

export function isTableText(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (TABLE_LINE_RE.test(t)) return true;
  if (/^\|?\s*:?-{3,}/.test(t)) return true;
  // Multi-column row without leading pipe
  if (TABLE_CELLS_RE.test(t) && (t.match(/\|/g) ?? []).length >= 2) return true;
  return false;
}

export function isFormattingFragment(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (BULLET_RE.test(t) && strip(t).split(/\s+/).length <= 8) return true;
  if (BOLD_ONLY_RE.test(t)) return true;
  if (/^[-*+#=\s|]+$/.test(t)) return true;
  // Bullet soup: "Product Name * Product Images"
  if (/\*\s+\w/.test(t) && !REQUIREMENT_SIGNAL_RE.test(t) && t.length < 80) {
    return true;
  }
  return false;
}

export function isIncompleteSentence(value: string): boolean {
  const t = strip(value);
  if (!t) return true;
  if (/[:：]\s*$/.test(t)) return true;
  if (/^(should be able to|must be|can|uses?|contains?|includes?)\s*:?\s*$/i.test(t)) {
    return true;
  }
  if (/\b(and|or|the|a|an|their|using|to|on|for)\s*$/i.test(t) && t.split(/\s+/).length <= 10) {
    return true;
  }
  if (t.split(/\s+/).length <= 2 && !REQUIREMENT_SIGNAL_RE.test(t)) return true;
  return false;
}

export function isIsolatedListItem(value: string): boolean {
  const t = strip(value);
  // Noun-phrase list items without behavior verbs
  if (
    t.split(/\s+/).length <= 6 &&
    !REQUIREMENT_SIGNAL_RE.test(t) &&
    !/[.!?]$/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Quality gate — only SAVE when this returns ok: true.
 */
export function isRequirementCandidate(candidate: RequirementCandidate): {
  ok: boolean;
  reason?: RejectReason;
} {
  const title = (candidate.title ?? '').trim();
  const description = (candidate.description ?? '').trim();
  const sourceText = (candidate.sourceText ?? description).trim();
  const elementType = (candidate.sourceElementType ?? '').toUpperCase();

  if (!title && !description && !sourceText) {
    return { ok: false, reason: 'EMPTY' };
  }

  if (
    elementType === 'HEADING' ||
    elementType === 'TABLE' ||
    elementType === 'TABLE_HEADER' ||
    elementType === 'TABLE_ROW'
  ) {
    if (elementType === 'HEADING') return { ok: false, reason: 'DOCUMENT_HEADING' };
    if (elementType === 'TABLE_HEADER') return { ok: false, reason: 'TABLE_HEADER' };
    return { ok: false, reason: 'TABLE_ROW' };
  }

  // Labels / headings checked on each field
  for (const part of [title, description, sourceText]) {
    if (!part) continue;
    if (AC_LABEL_RE.test(part) || AC_LABEL_RE.test(strip(part))) {
      return { ok: false, reason: 'ACCEPTANCE_CRITERIA_LABEL' };
    }
    if (isHeadingText(part) || HEADING_MARK_RE.test(part)) {
      return { ok: false, reason: 'DOCUMENT_HEADING' };
    }
    if (isTableText(part)) {
      return {
        ok: false,
        reason: /category|price|stock|product\s*\|/i.test(part)
          ? 'TABLE_HEADER'
          : 'TABLE_ROW',
      };
    }
    if (isFormattingFragment(part)) {
      return { ok: false, reason: 'FORMATTING_FRAGMENT' };
    }
  }

  // Section-label-only candidates (title == description == "Payment")
  const titleIsSection = SECTION_LABEL_RE.test(strip(title));
  const descIsSection =
    !description ||
    SECTION_LABEL_RE.test(strip(description)) ||
    strip(description) === strip(title);
  if (titleIsSection && descIsSection && !REQUIREMENT_SIGNAL_RE.test(description)) {
    return { ok: false, reason: 'SECTION_LABEL' };
  }
  if (
    titleIsSection &&
    description &&
    REQUIREMENT_SIGNAL_RE.test(description) &&
    description.length >= 24
  ) {
    // Valid: section-like title with real requirement body
  } else if (
    SECTION_LABEL_RE.test(strip(description)) &&
    !REQUIREMENT_SIGNAL_RE.test(description)
  ) {
    return { ok: false, reason: 'SECTION_LABEL' };
  }

  const primary = strip(description || sourceText || title);
  if (!primary) return { ok: false, reason: 'EMPTY' };

  if (isIncompleteSentence(primary)) {
    return { ok: false, reason: 'INCOMPLETE_SENTENCE' };
  }

  if (isIsolatedListItem(primary) && !(candidate.acceptanceCriteria?.length)) {
    // Isolated noun list item without being a full requirement statement
    if (!REQUIREMENT_SIGNAL_RE.test(primary)) {
      return { ok: false, reason: 'ISOLATED_LIST_ITEM' };
    }
  }

  if (!REQUIREMENT_SIGNAL_RE.test(primary) && primary.length < 40) {
    return { ok: false, reason: 'NO_SEMANTIC_CONTENT' };
  }

  // Supporting-info-only: description is just a field name list
  if (
    candidate.supportingInformation?.length &&
    isIncompleteSentence(description) &&
    !REQUIREMENT_SIGNAL_RE.test(description)
  ) {
    return { ok: false, reason: 'SUPPORTING_INFORMATION_ONLY' };
  }

  void allText;
  return { ok: true };
}
