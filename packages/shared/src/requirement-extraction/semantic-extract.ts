/**
 * Deterministic semantic requirement extraction.
 * Extracts meaningful behavior/rules/constraints — not headings, bullets, or formatting.
 */

export type RequirementType = 'FUNCTIONAL' | 'NON_FUNCTIONAL' | 'BUSINESS_RULE';

export type SemanticExtractedRequirement = {
  requirementKey: string;
  title: string;
  description: string;
  type: RequirementType;
  priority: string | null;
  acceptanceCriteria: string[];
  businessRules: string[];
  dependencies: string[];
  source: {
    document: string;
    page: number | null;
    section: string | null;
    text: string;
  };
};

type LineKind =
  | 'blank'
  | 'heading'
  | 'ac_heading'
  | 'bullet'
  | 'prose'
  | 'underline';

type ClassifiedLine = {
  raw: string;
  text: string;
  kind: LineKind;
};

const AC_HEADING_RE =
  /^(#{1,6}\s*)?(acceptance\s*criteria|acceptance\s*criterion)\s*:?\s*$/i;

const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+)$/;
const NUMBERED_HEADING_RE =
  /^(\d+(?:\.\d+)*)\s*[.)]\s+(.+)$/;
const UNDERLINE_RE = /^[=-]{3,}\s*$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

const NON_FUNCTIONAL_RE =
  /\b(within\s+\d+\s*(?:ms|milliseconds|seconds?|s|minutes?)|response\s*time|performance|scalability|scalable|highly\s+secure|secure|security|encrypt(?:ion|ed)?|https|tls|accessibility|wcag|modern\s+browsers?|mobile\s+devices?|easy\s+to\s+use|usability|availability|uptime|latency|throughput|load\s*time|responsive|fast|slow)\b/i;

const META_INSTRUCTION_RE =
  /^(do\s+not|don't|note:|important:|please\s+|warning:|reminder:)/i;

const BUSINESS_RULE_RE =
  /\b(must\s+be\s+unique|must\s+not|must\s+only|cannot\s+be|can\s+only|should\s+not\s+allow|must\s+expire|expire[sd]?\s+after|only\s+one|associated\s+with\s+one|out\s+of\s+stock|business\s+rule|constraint)\b/i;

const REQUIREMENT_SIGNAL_RE =
  /\b(should|shall|must|can|cannot|will|need\s+to|able\s+to|allow|supports?|display|redirect|require|prevent|enable|provide|expire|unique|secure|fast|work\s+on)\b/i;

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

function classifyLine(raw: string): ClassifiedLine {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw, text: '', kind: 'blank' };
  }

  if (UNDERLINE_RE.test(trimmed)) {
    return { raw, text: '', kind: 'underline' };
  }

  if (AC_HEADING_RE.test(trimmed)) {
    return { raw, text: 'Acceptance Criteria', kind: 'ac_heading' };
  }

  const md = trimmed.match(MARKDOWN_HEADING_RE);
  if (md) {
    const text = cleanHeadingText(md[2] ?? '');
    if (AC_HEADING_RE.test(text)) {
      return { raw, text: 'Acceptance Criteria', kind: 'ac_heading' };
    }
    return { raw, text, kind: 'heading' };
  }

  const numbered = trimmed.match(NUMBERED_HEADING_RE);
  if (numbered) {
    const body = (numbered[2] ?? '').trim();
    // Numbered headings are short titles; long numbered sentences are prose
    const wordCount = body.split(/\s+/).length;
    const looksLikeTitle =
      wordCount <= 8 &&
      !/\b(should|shall|must|can|will|able to)\b/i.test(body) &&
      !/[.!?]$/.test(body);
    if (looksLikeTitle) {
      if (AC_HEADING_RE.test(body)) {
        return { raw, text: 'Acceptance Criteria', kind: 'ac_heading' };
      }
      return { raw, text: cleanHeadingText(body), kind: 'heading' };
    }
  }

  const bullet = trimmed.match(BULLET_RE);
  if (bullet) {
    return {
      raw,
      text: stripMarkdownInline(bullet[1] ?? ''),
      kind: 'bullet',
    };
  }

  return {
    raw,
    text: stripMarkdownInline(trimmed),
    kind: 'prose',
  };
}

function looksLikeHeadingOnly(text: string): boolean {
  const t = stripMarkdownInline(text)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(?:\.\d+)*\s*[.)]\s+/, '')
    .trim();
  if (!t) return true;
  if (AC_HEADING_RE.test(t)) return true;
  if (/^#{1,6}\s*$/.test(text.trim())) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 8 && !REQUIREMENT_SIGNAL_RE.test(t) && !/[.!?]$/.test(t)) {
    // Short noun-phrase titles without requirement verbs
    if (
      /^(user\s+registration|user\s+login|password\s+reset|product\s+search|payment|shopping\s+cart|product\s+details?)\b/i.test(
        t,
      )
    ) {
      return true;
    }
    // Document titles
    if (/\b(product\s+requirements|requirements\s+document|prd)\b/i.test(t)) {
      return true;
    }
  }
  return false;
}

function isMeaningfulRequirementContent(
  title: string,
  description: string,
): boolean {
  const t = title.trim();
  const d = description
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^#{1,6}\s+/, '');
  if (!t || !d) return false;
  if (META_INSTRUCTION_RE.test(d)) return false;
  if (looksLikeHeadingOnly(t) && looksLikeHeadingOnly(d)) return false;
  if (looksLikeHeadingOnly(d) && d.length < 80 && !REQUIREMENT_SIGNAL_RE.test(d)) {
    return false;
  }
  if (d.length < 12) return false;
  if (/^[-*+#=\s]+$/.test(d)) return false;
  if (AC_HEADING_RE.test(d) || AC_HEADING_RE.test(t)) return false;
  // Truncated / fragment bullets
  if (/\b(and|or|the|a|an)\s*$/i.test(d) && d.split(/\s+/).length <= 8) {
    return false;
  }
  // Bullet-only fragments that are noun phrases without signals
  if (
    d.split(/\s+/).length <= 6 &&
    !REQUIREMENT_SIGNAL_RE.test(d) &&
    !/[.!?]$/.test(d)
  ) {
    return false;
  }
  return REQUIREMENT_SIGNAL_RE.test(d) || d.length >= 40;
}

export function isMeaningfulRequirement(input: {
  title: string;
  description: string;
}): boolean {
  return isMeaningfulRequirementContent(input.title, input.description);
}

function classifyType(description: string): RequirementType {
  if (NON_FUNCTIONAL_RE.test(description)) return 'NON_FUNCTIONAL';
  if (BUSINESS_RULE_RE.test(description)) return 'BUSINESS_RULE';
  return 'FUNCTIONAL';
}

function titleFromDescription(description: string, section: string | null): string {
  const cleaned = description
    .replace(/^(the\s+)?(user|users|system|application|product)\s+/i, '')
    .replace(/^(should|shall|must|can|will)\s+(be\s+able\s+to\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();

  const words = cleaned.split(/\s+/).slice(0, 6).join(' ');
  if (words.length >= 3) {
    return words.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (section) return section;
  return 'Requirement';
}

function joinDisplayList(intro: string, items: string[]): string {
  const base = intro.replace(/:\s*$/, '').trim();
  if (!items.length) return base.endsWith('.') ? base : `${base}.`;
  const list = items.join(', ').replace(/, ([^,]+)$/, ' and $1');
  const sentence = `${base} ${list}`;
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}

function normalizeDuplicateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\busers\b/g, 'user')
    .replace(/\blog\s*in\b/g, 'login')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Semantic extraction from requirement source text.
 */
export function semanticExtractRequirements(
  sourceText: string,
  documentName: string,
): SemanticExtractedRequirement[] {
  const lines = sourceText.replace(/\r\n/g, '\n').split('\n');
  const classified: ClassifiedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    // Setext-style headings: Title\n-----
    if (
      line.trim() &&
      !MARKDOWN_HEADING_RE.test(line.trim()) &&
      UNDERLINE_RE.test(next.trim())
    ) {
      classified.push({
        raw: line,
        text: cleanHeadingText(line.trim()),
        kind: 'heading',
      });
      classified.push({ raw: next, text: '', kind: 'underline' });
      i += 1;
      continue;
    }
    classified.push(classifyLine(line));
  }

  type Draft = {
    title: string;
    description: string;
    type: RequirementType;
    acceptanceCriteria: string[];
    sourceText: string;
    section: string | null;
  };

  const drafts: Draft[] = [];
  let section: string | null = null;
  let sectionStartIndex = 0;
  let mode: 'normal' | 'accept_criteria' | 'display_list' = 'normal';
  let displayIntro: string | null = null;
  let displayBullets: string[] = [];
  let displaySection: string | null = null;

  const flushDisplayList = () => {
    if (!displayIntro) return;
    const description = joinDisplayList(displayIntro, displayBullets);
    const sourceBits = [displayIntro, ...displayBullets.map((b) => `- ${b}`)];
    drafts.push({
      title: titleFromDescription(displayIntro, displaySection),
      description,
      type: classifyType(description),
      acceptanceCriteria: [],
      sourceText: sourceBits.join('\n'),
      section: displaySection,
    });
    displayIntro = null;
    displayBullets = [];
    displaySection = null;
    mode = 'normal';
  };

  const attachAcToSectionPrimary = (criteria: string[]) => {
    if (!criteria.length) return;
    // Prefer first requirement in current section
    let target: Draft | undefined;
    for (let i = sectionStartIndex; i < drafts.length; i++) {
      const d = drafts[i];
      if (d && d.section === section) {
        target = d;
        break;
      }
    }
    if (!target && drafts.length) {
      target = drafts[drafts.length - 1];
    }
    if (!target) return;
    const existing = new Set(target.acceptanceCriteria.map(normalizeDuplicateKey));
    for (const c of criteria) {
      const key = normalizeDuplicateKey(c);
      if (!key || existing.has(key)) continue;
      target.acceptanceCriteria.push(c);
      existing.add(key);
    }
  };

  let pendingAc: string[] = [];

  const flushAc = () => {
    if (pendingAc.length) {
      attachAcToSectionPrimary(pendingAc);
      pendingAc = [];
    }
    if (mode === 'accept_criteria') mode = 'normal';
  };

  for (const line of classified) {
    if (line.kind === 'blank' || line.kind === 'underline') {
      continue;
    }

    if (line.kind === 'heading') {
      flushDisplayList();
      flushAc();
      section = line.text || section;
      sectionStartIndex = drafts.length;
      mode = 'normal';
      continue;
    }

    if (line.kind === 'ac_heading') {
      flushDisplayList();
      mode = 'accept_criteria';
      continue;
    }

    if (line.kind === 'bullet') {
      if (!line.text) continue;
      if (mode === 'accept_criteria') {
        const item = line.text.trim();
        pendingAc.push(/[.!?]$/.test(item) ? item : `${item}.`);
        continue;
      }
      if (mode === 'display_list' && displayIntro) {
        displayBullets.push(line.text.replace(/[.]+$/, ''));
        continue;
      }
      // Orphan bullets under a section are not standalone requirements
      continue;
    }

    // prose
    flushAc();

    const text = line.text.trim();
    if (!text) continue;
    if (META_INSTRUCTION_RE.test(text)) continue;

    // Intro to a display/list requirement
    if (/:\s*$/.test(text) || /\b(display|include|contain|show|support)\s*:?\s*$/i.test(text)) {
      flushDisplayList();
      mode = 'display_list';
      displayIntro = text;
      displayBullets = [];
      displaySection = section;
      continue;
    }

    if (mode === 'display_list') {
      flushDisplayList();
    }

    if (!isMeaningfulRequirementContent(titleFromDescription(text, section), text)) {
      // Skip heading-like prose leftovers
      if (looksLikeHeadingOnly(text)) continue;
      if (!REQUIREMENT_SIGNAL_RE.test(text)) continue;
    }

    drafts.push({
      title: titleFromDescription(text, section),
      description: /[.!?]$/.test(text) ? text : `${text}.`,
      type: classifyType(text),
      acceptanceCriteria: [],
      sourceText: text,
      section,
    });
  }

  flushDisplayList();
  flushAc();

  // Deduplicate obvious exact/near duplicates (keep first)
  const seen = new Set<string>();
  const unique: Draft[] = [];
  for (const d of drafts) {
    if (!isMeaningfulRequirementContent(d.title, d.description)) continue;
    const key = normalizeDuplicateKey(d.description);
    if (!key || seen.has(key)) continue;
    // Also skip if description is essentially just the section heading
    if (d.section && normalizeDuplicateKey(d.description) === normalizeDuplicateKey(d.section)) {
      continue;
    }
    seen.add(key);
    unique.push(d);
  }

  return unique.map((d, i) => {
    let title = d.title;
    // Prefer clean section-based title for primary section requirement when title is weak
    if (
      d.section &&
      i === unique.findIndex((u) => u.section === d.section) &&
      d.type === 'FUNCTIONAL' &&
      d.acceptanceCriteria.length > 0
    ) {
      title = d.section;
    }

    // Refine titles for common patterns
    title = refineTitle(title, d.description, d.section, d.type);

    return {
      requirementKey: `REQ-${String(i + 1).padStart(3, '0')}`,
      title,
      description: d.description,
      type: d.type,
      priority: null,
      acceptanceCriteria: d.acceptanceCriteria,
      businessRules: [],
      dependencies: [],
      source: {
        document: documentName,
        page: null,
        section: d.section,
        text: d.sourceText,
      },
    };
  });
}

function refineTitle(
  title: string,
  description: string,
  section: string | null,
  type: RequirementType,
): string {
  const d = description.toLowerCase();
  if (/\bunique\b/.test(d) && /\bemail\b/.test(d)) return 'Unique Email Address';
  if (/\bredirect/.test(d) && /\blogin\b/.test(d)) return 'Registration Redirect';
  if (/\bexpire/.test(d) && /\botp\b/.test(d)) return 'OTP Expiration';
  if (/\botp\b/.test(d) && /\b(sent|send|email)\b/.test(d)) return 'OTP Delivery';
  if (/\breset\b/.test(d) && /\bpassword\b/.test(d) && type === 'FUNCTIONAL') {
    return section && /password\s*reset/i.test(section) ? 'Password Reset' : title;
  }
  if (section && /user\s+registration/i.test(section) && /\b(create an account|register)\b/i.test(description)) {
    return 'User Registration';
  }
  return title
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(?:\.\d+)*\s*[.)]\s+/, '')
    .trim();
}

/**
 * Filter AI/heuristic outputs to drop headings, AC labels, and formatting artifacts.
 */
export function filterExtractedRequirements<
  T extends { title: string; description: string; acceptanceCriteria?: string[] },
>(items: T[]): T[] {
  return items.filter((item) => {
    if (!isMeaningfulRequirement(item)) return false;
    // Drop if title/description are clearly structural labels
    const blob = `${item.title}\n${item.description}`;
    if (AC_HEADING_RE.test(item.title.trim()) || AC_HEADING_RE.test(item.description.trim())) {
      return false;
    }
    if (/^#{1,6}\s+/.test(item.title.trim()) || /^#{1,6}\s+/.test(item.description.trim())) {
      // Allow if body still has requirement signals after stripping
      const stripped = stripMarkdownInline(
        item.description.replace(/^#{1,6}\s+/, ''),
      );
      if (!REQUIREMENT_SIGNAL_RE.test(stripped)) return false;
    }
    if (looksLikeHeadingOnly(item.description)) return false;
    // Bullet-fragment titles
    if (/^[-*+]\s+/.test(item.title) && item.description.split(/\s+/).length < 8) {
      return false;
    }
    void blob;
    return true;
  });
}
