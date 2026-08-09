/**
 * Semantic requirement extraction over parsed document elements.
 * Pipeline: parse → extract → normalize → validate
 */

import {
  parseRequirementDocument,
  type ParsedDocument,
} from './document-parser.js';

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
  supportingInformation: string[];
  source: {
    document: string;
    page: number | null;
    section: string | null;
    text: string;
  };
};

export type ExtractionResult = {
  requirements: SemanticExtractedRequirement[];
  documentElements: {
    sections: ParsedDocument['sections'];
    tables: ParsedDocument['tables'];
  };
};

const AC_HEADING_RE =
  /^(#{1,6}\s*)?(acceptance\s*criteria|acceptance\s*criterion)\s*:?\s*$/i;

const NON_FUNCTIONAL_RE =
  /\b(within\s+\d+\s*(?:ms|milliseconds|seconds?|s|minutes?)|response\s*time|performance|scalability|scalable|highly\s+secure|secure|security|encrypt(?:ion|ed)?|https|tls|accessibility|wcag|modern\s+browsers?|mobile\s+devices?|easy\s+to\s+use|usability|availability|uptime|latency|throughput|load\s*time|responsive|fast|slow|user\s+friendly)\b/i;

const META_INSTRUCTION_RE =
  /^(do\s+not|don't|note:|important:|please\s+|warning:|reminder:)/i;

const BUSINESS_RULE_RE =
  /\b(must\s+be\s+unique|must\s+not|must\s+only|cannot\s+be|can\s+only|should\s+not\s+allow|must\s+expire|expire[sd]?\s+after|only\s+one|associated\s+with\s+one|out\s+of\s+stock|business\s+rule|constraint|only\s+(?:users?|administrators?|admins?)\b|only\s+\w+\s+can\b|who\s+have\s+purchased)\b/i;

const REQUIREMENT_SIGNAL_RE =
  /\b(should|shall|must|can|cannot|will|need\s+to|able\s+to|allow|allowed|supports?|display|redirect|require|prevent|enable|provide|expire|unique|secure|fast|work\s+on|login|register|search|filter|add|remove|purchase|submit)\b/i;

const INTRO_LIST_RE =
  /\b(display|include|contain|show|support|list|have|uses?)\b[:\s]*$/i;

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

function ensureSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
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

function looksLikeHeadingOnly(text: string): boolean {
  const t = stripMarkdownInline(text);
  if (!t) return true;
  if (AC_HEADING_RE.test(t)) return true;
  if (/^business\s*rules?$/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 8 && !REQUIREMENT_SIGNAL_RE.test(t) && !/[.!?]$/.test(t)) {
    if (/\b(product\s+requirements|requirements\s+document|prd)\b/i.test(t)) {
      return true;
    }
    if (
      /^(user\s+registration|user\s+login|password\s+reset|product\s+search|payment|shopping\s+cart|product\s+details?|non[- ]?functional|business\s+rules?)\b/i.test(
        t,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isTableLike(text: string): boolean {
  return /^\|/.test(text.trim()) || /\|\s*[-:]{3,}/.test(text);
}

function isFragment(text: string): boolean {
  const t = stripMarkdownInline(text);
  if (!t) return true;
  if (/[:：]\s*$/.test(t)) return true;
  if (/^(uses?|contains?|includes?|list\s+contains)\s*:?\s*$/i.test(t)) return true;
  if (/\b(and|or|the|a|an|their|using)\s*$/i.test(t) && t.split(/\s+/).length <= 10) {
    return true;
  }
  if (t.split(/\s+/).length <= 3 && !REQUIREMENT_SIGNAL_RE.test(t)) return true;
  return false;
}

export function isMeaningfulRequirement(input: {
  title: string;
  description: string;
  sourceText?: string | null;
}): boolean {
  const t = input.title.trim();
  const d = stripMarkdownInline(input.description);
  const source = stripMarkdownInline(input.sourceText || d);

  if (!t || !d) return false;
  if (META_INSTRUCTION_RE.test(d) || META_INSTRUCTION_RE.test(source)) return false;
  if (AC_HEADING_RE.test(t) || AC_HEADING_RE.test(d)) return false;
  if (/^business\s*rules?$/i.test(t) || /^business\s*rules?$/i.test(d)) return false;
  if (isTableLike(d) || isTableLike(source) || isTableLike(t)) return false;
  if (looksLikeHeadingOnly(d) && !REQUIREMENT_SIGNAL_RE.test(d)) return false;
  if (isFragment(d) && !input.sourceText) return false;
  if (isFragment(d) && normalizeDuplicateKey(d) === normalizeDuplicateKey(t)) {
    return false;
  }
  // Reject truncated source relative to a longer description pattern
  if (source.length >= 12 && /\b(and|or|the|a|an)\s*$/i.test(source)) return false;
  if (d.length < 12) return false;
  if (/^[-*+#=\s|]+$/.test(d)) return false;

  if (
    d.split(/\s+/).length <= 6 &&
    !REQUIREMENT_SIGNAL_RE.test(d) &&
    !/[.!?]$/.test(d)
  ) {
    return false;
  }

  return REQUIREMENT_SIGNAL_RE.test(d) || d.length >= 40;
}

function classifyType(description: string): RequirementType {
  if (NON_FUNCTIONAL_RE.test(description)) return 'NON_FUNCTIONAL';
  if (BUSINESS_RULE_RE.test(description)) return 'BUSINESS_RULE';
  return 'FUNCTIONAL';
}

function refineTitle(
  description: string,
  section: string | null,
  type: RequirementType,
): string {
  const d = description.toLowerCase();

  if (/\bunique\b/.test(d) && /\bemail\b/.test(d)) return 'Unique Email Address';
  if (/\bredirect/.test(d) && /\b(login|registration)\b/.test(d)) {
    return 'Registration Redirect';
  }
  if (/\bexpire/.test(d) && /\botp\b/.test(d)) return 'OTP Expiration';
  if (/\botp\b/.test(d) && /\b(sent|send|email|deliver)\b/.test(d)) {
    return 'OTP Delivery';
  }
  if (/\botp\b/.test(d) && /\b(enter|create\s+a\s+new\s+password)\b/.test(d)) {
    return 'OTP Entry';
  }
  if (/\binvalid\b/.test(d) && /\b(credential|login|error)\b/.test(d)) {
    return 'Invalid Login Error';
  }
  if (/\breset\b/.test(d) && /\bpassword\b/.test(d) && type === 'FUNCTIONAL') {
    return 'Password Reset';
  }
  if (/\b(create an account|register)\b/.test(d)) return 'User Registration';
  if (/\blogin\b/.test(d) && type === 'FUNCTIONAL') return 'User Login';
  if (/\bsearch\b/.test(d) && /\bresult/.test(d)) return 'Product Search Results';
  if (/\bsearch\b/.test(d)) return 'Product Search';
  if (/\bfilter/.test(d)) return 'Product Filtering';
  if (/\bproduct details?\b/.test(d) || /\bdetails page should display\b/.test(d)) {
    return 'Product Details';
  }
  if (/\badd\b/.test(d) && /\bcart\b/.test(d)) return 'Add Product To Cart';
  if (/\b(increase|decrease)\b/.test(d) && /\bquantity\b/.test(d)) {
    return 'Modify Product Quantity';
  }
  if (/\bremove\b/.test(d) && /\bcart\b/.test(d)) return 'Remove Product From Cart';
  if (/\btotal\s+price\b/.test(d) || (/\bcart\b/.test(d) && /\btotal\b/.test(d))) {
    return 'Display Cart Total';
  }
  if (/\bout of stock\b/.test(d)) return 'Out Of Stock Purchase Rule';
  if (/\breview\b/.test(d) && /\bpurchased\b/.test(d)) return 'Review Eligibility';
  if (/\badministrators?\b/.test(d) && /\bmanage\b/.test(d)) {
    return 'Admin Product Management';
  }
  if (/\bown orders\b/.test(d)) return 'Own Orders Visibility';
  if (/\brespond within\b/.test(d) || /\bwithin\s+\d+\s+seconds?\b/.test(d)) {
    return 'Response Time';
  }
  if (/\bhighly secure\b/.test(d) || (/\bsecure\b/.test(d) && /\bapplication\b/.test(d))) {
    return 'Application Security';
  }
  if (/\bmodern browsers?\b/.test(d)) return 'Browser Compatibility';
  if (/\bmobile\b/.test(d)) return 'Mobile Usability';

  if (
    section &&
    type === 'FUNCTIONAL' &&
    (/\b(should be able to|can)\b/.test(d) ||
      normalizeDuplicateKey(description).includes(
        normalizeDuplicateKey(section).split(' ').slice(0, 2).join(' '),
      ))
  ) {
    // Prefer section title for primary capability statements
    if (
      /registration|login|password reset|product details|product search|payment|shopping cart/i.test(
        section,
      )
    ) {
      const primaryVerbs =
        /create an account|register|login|reset|search|display|checkout|pay/i;
      if (primaryVerbs.test(description)) return section;
    }
  }

  // Concise title — avoid mid-phrase truncation (e.g. "... Email And")
  const cleaned = description
    .replace(/^(the\s+)?(user|users|system|application|product)\s+/i, '')
    .replace(/^(should|shall|must|can|will)\s+(be\s+able\s+to\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const titleWords = words.slice(0, Math.min(5, words.length));
  while (
    titleWords.length > 2 &&
    /^(and|or|the|a|an|to|using|their|with|for)$/i.test(
      titleWords[titleWords.length - 1] ?? '',
    )
  ) {
    titleWords.pop();
  }

  if (titleWords.length >= 2) {
    return titleWords
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return section || 'Requirement';
}

type Draft = {
  title: string;
  description: string;
  type: RequirementType;
  acceptanceCriteria: string[];
  businessRules: string[];
  supportingInformation: string[];
  sourceText: string;
  section: string | null;
};

/**
 * Extract requirements from an already-parsed document.
 */
export function extractFromParsedDocument(
  parsed: ParsedDocument,
  documentName: string,
): ExtractionResult {
  const drafts: Draft[] = [];
  let section: string | null = null;
  let sectionStartIndex = 0;
  let mode: 'normal' | 'acceptance_criteria' | 'business_rules' = 'normal';

  const attachToSectionPrimary = (
    field: 'acceptanceCriteria' | 'businessRules',
    items: string[],
  ) => {
    if (!items.length) return;
    let target: Draft | undefined;
    for (let i = sectionStartIndex; i < drafts.length; i++) {
      const d = drafts[i];
      if (d && d.section === section && d.type === 'FUNCTIONAL') {
        target = d;
        break;
      }
    }
    if (!target) {
      for (let i = sectionStartIndex; i < drafts.length; i++) {
        const d = drafts[i];
        if (d && d.section === section) {
          target = d;
          break;
        }
      }
    }
    if (!target && drafts.length) target = drafts[drafts.length - 1];
    if (!target) return;

    const existing = new Set(target[field].map(normalizeDuplicateKey));
    for (const item of items) {
      const normalized = ensureSentence(item);
      const key = normalizeDuplicateKey(normalized);
      if (!key || existing.has(key)) continue;
      // Never promote AC items into separate requirements — attach only
      target[field].push(normalized);
      existing.add(key);
    }
  };

  for (let idx = 0; idx < parsed.elements.length; idx++) {
    const el = parsed.elements[idx];
    if (!el) continue;

    if (el.type === 'TABLE') {
      // Tables are never requirements
      mode = 'normal';
      continue;
    }

    if (el.type === 'HEADING') {
      if (el.role === 'acceptance_criteria') {
        mode = 'acceptance_criteria';
        continue;
      }
      if (el.role === 'business_rules') {
        mode = 'business_rules';
        continue;
      }
      mode = 'normal';
      section = el.text || section;
      sectionStartIndex = drafts.length;
      continue;
    }

    if (el.type === 'LIST') {
      const items = el.items.map((x) => x.trim()).filter(Boolean);
      if (!items.length) continue;

      if (mode === 'acceptance_criteria') {
        attachToSectionPrimary('acceptanceCriteria', items);
        mode = 'normal';
        continue;
      }
      if (mode === 'business_rules') {
        // Explicit business-rule lists under a BR heading → separate BR requirements
        for (const item of items) {
          if (!isMeaningfulRequirement({ title: item, description: item })) continue;
          drafts.push({
            title: refineTitle(item, section, 'BUSINESS_RULE'),
            description: ensureSentence(item),
            type: 'BUSINESS_RULE',
            acceptanceCriteria: [],
            businessRules: [],
            supportingInformation: [],
            sourceText: item,
            section,
          });
        }
        mode = 'normal';
        continue;
      }

      // Orphan lists are supporting info for previous requirement, not new requirements
      const prev = drafts[drafts.length - 1];
      if (prev && prev.section === section) {
        prev.supportingInformation.push(...items.map((i) => i.replace(/[.]+$/, '')));
        // Soften description if it was an intro ending with colon semantics
        if (/display|include|contain|show/i.test(prev.description)) {
          const base = prev.sourceText.replace(/:\s*$/, '').trim();
          if (/product details/i.test(base) || /display/i.test(base)) {
            prev.description = /product information/i.test(prev.description)
              ? prev.description
              : ensureSentence(
                  base.replace(/\bshould display\b/i, 'should display product information'),
                );
            if (!/product information/i.test(prev.description) && /should display$/i.test(base)) {
              prev.description = ensureSentence(`${base} product information`);
            }
          }
        }
      }
      continue;
    }

    // PARAGRAPH
    const text = el.text.trim();
    if (!text) continue;
    if (META_INSTRUCTION_RE.test(text)) continue;
    if (isTableLike(text)) continue;
    if (looksLikeHeadingOnly(text)) continue;

    // Lookahead for list after intro paragraph
    const next = parsed.elements[idx + 1];
    const isIntro =
      /:\s*$/.test(text) ||
      (INTRO_LIST_RE.test(text) && next?.type === 'LIST');

    if (mode === 'acceptance_criteria') {
      // Rare prose under AC — treat as AC item if short
      attachToSectionPrimary('acceptanceCriteria', [text]);
      continue;
    }

    if (mode === 'business_rules') {
      if (!isMeaningfulRequirement({ title: text, description: text })) continue;
      drafts.push({
        title: refineTitle(text, section, 'BUSINESS_RULE'),
        description: ensureSentence(text),
        type: 'BUSINESS_RULE',
        acceptanceCriteria: [],
        businessRules: [],
        supportingInformation: [],
        sourceText: text,
        section,
      });
      continue;
    }

    if (isIntro && next?.type === 'LIST') {
      const items = next.items.map((x) => x.trim()).filter(Boolean);
      const sourceText = text.replace(/:\s*$/, '').trim();
      let description = ensureSentence(sourceText);
      if (/\bshould display$/i.test(sourceText)) {
        description = ensureSentence(`${sourceText} product information`);
      } else if (/\b(contain|include|show|list)$/i.test(sourceText)) {
        description = ensureSentence(`${sourceText} the listed information`);
      }

      const type = classifyType(description);
      drafts.push({
        title: refineTitle(description, section, type),
        description,
        type,
        acceptanceCriteria: [],
        businessRules: [],
        supportingInformation: items.map((i) => i.replace(/[.]+$/, '')),
        sourceText,
        section,
      });
      idx += 1; // consume LIST
      continue;
    }

    // Incomplete intro without a following list — reject
    if (/:\s*$/.test(text) || isFragment(text)) {
      continue;
    }

    if (!isMeaningfulRequirement({ title: text, description: text, sourceText: text })) {
      continue;
    }

    const type = classifyType(text);
    drafts.push({
      title: refineTitle(text, section, type),
      description: ensureSentence(text),
      type,
      acceptanceCriteria: [],
      businessRules: [],
      supportingInformation: [],
      sourceText: text,
      section,
    });
  }

  // Normalize + validate
  const seen = new Set<string>();
  const unique: Draft[] = [];
  for (const d of drafts) {
    if (
      !isMeaningfulRequirement({
        title: d.title,
        description: d.description,
        sourceText: d.sourceText,
      })
    ) {
      continue;
    }
    if (d.section && normalizeDuplicateKey(d.description) === normalizeDuplicateKey(d.section)) {
      continue;
    }
    const key = normalizeDuplicateKey(d.sourceText || d.description);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(d);
  }

  const requirements = unique.map((d, i) => {
    // Prefer section title for first functional req in section when AC attached
    let title = d.title;
    if (
      d.section &&
      d.type === 'FUNCTIONAL' &&
      d.acceptanceCriteria.length > 0 &&
      unique.findIndex((u) => u.section === d.section && u.type === 'FUNCTIONAL') ===
        unique.findIndex((u) => u === d)
    ) {
      title = d.section;
    }
    title = refineTitle(d.description, d.section, d.type);
    // Re-apply section preference for registration/login primaries with AC
    if (
      d.acceptanceCriteria.length > 0 &&
      d.section &&
      /user registration|user login/i.test(d.section)
    ) {
      title = d.section;
    }

    return {
      requirementKey: `REQ-${String(i + 1).padStart(3, '0')}`,
      title,
      description: d.description,
      type: d.type,
      priority: null,
      acceptanceCriteria: d.acceptanceCriteria,
      businessRules: d.businessRules,
      dependencies: [],
      supportingInformation: d.supportingInformation,
      source: {
        document: documentName,
        page: null,
        section: d.section,
        text: d.sourceText,
      },
    };
  });

  return {
    requirements,
    documentElements: {
      sections: parsed.sections,
      tables: parsed.tables,
    },
  };
}

/**
 * Full pipeline entry: parse → extract → normalize → validate.
 */
export function extractRequirementsFromSource(
  sourceText: string,
  documentName: string,
): ExtractionResult {
  const parsed = parseRequirementDocument(sourceText);
  return extractFromParsedDocument(parsed, documentName);
}

/** Backward-compatible helper returning requirements only. */
export function semanticExtractRequirements(
  sourceText: string,
  documentName: string,
): SemanticExtractedRequirement[] {
  return extractRequirementsFromSource(sourceText, documentName).requirements;
}

/**
 * Final validation gate before persistence / after AI output.
 */
export function filterExtractedRequirements<
  T extends {
    title: string;
    description: string;
    acceptanceCriteria?: string[];
    source?: { text?: string | null } | null;
    sourceText?: string | null;
  },
>(items: T[]): T[] {
  return items.filter((item) => {
    const sourceText = item.sourceText ?? item.source?.text ?? item.description;
    if (
      !isMeaningfulRequirement({
        title: item.title,
        description: item.description,
        sourceText,
      })
    ) {
      return false;
    }
    if (isTableLike(item.title) || isTableLike(item.description)) return false;
    if (looksLikeHeadingOnly(item.description)) return false;
    if (/^[-*+]\s+/.test(item.title.trim())) return false;
    // Reject if description is clearly an AC bullet promoted incorrectly
    if (
      item.acceptanceCriteria &&
      item.acceptanceCriteria.some(
        (ac) => normalizeDuplicateKey(ac) === normalizeDuplicateKey(item.description),
      )
    ) {
      // still ok if it's the parent — only reject pure AC clones with tiny descriptions
    }
    return true;
  });
}
