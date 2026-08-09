/**
 * Piece 2.5 — Requirement Normalization
 * Candidates (temp IDs) → dedupe/merge → titles → classification → sequential REQ IDs
 */

import type { RequirementType, SemanticExtractedRequirement } from './semantic-extract.js';

export type TempCandidate = {
  tempId: string;
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

export type NormalizationStats = {
  candidatesIn: number;
  merged: number;
  retitled: number;
  reclassified: number;
  finals: number;
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\busers\b/g, 'user')
    .replace(/\badministrators\b/g, 'administrator')
    .replace(/\blog\s*in\b/g, 'login')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

function ensureSentence(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function titleCase(words: string[]): string {
  return words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function isTruncatedTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return true;
  if (/\b(from|the|a|an|to|and|or|be|able|must|should|can|will|their|with|for|of)\s*$/i.test(t)) {
    return true;
  }
  if (/^(administrators?|users?|after|the|all|not)\b/i.test(t) && t.split(/\s+/).length <= 4) {
    return true;
  }
  if (/should be able$/i.test(t) || /should contain$/i.test(t)) return true;
  return false;
}

/**
 * Concise semantic title from full description — never a truncated sentence fragment.
 */
export function generateSemanticTitle(
  description: string,
  section: string | null,
  type: RequirementType,
): string {
  const d = description.toLowerCase();

  // Auth / account
  if (/\bunique\b/.test(d) && /\bemail\b/.test(d)) return 'Unique Email Address';
  if (/\bredirect/.test(d) && /\b(login|registration)\b/.test(d)) return 'Registration Redirect';
  if (/\b(create an account|register)\b/.test(d) && !/\blogin\b/.test(d)) {
    return 'User Registration';
  }
  if (/\binvalid\b/.test(d) && /\b(credential|login|error)\b/.test(d)) {
    return 'Invalid Login Error';
  }
  if (/\blogin\b/.test(d) && type !== 'BUSINESS_RULE') return 'User Login';

  // Password / OTP
  if (/\bexpire/.test(d) && /\botp\b/.test(d)) return 'OTP Expiration';
  if (/\botp\b/.test(d) && /\b(sent|send|email|deliver)\b/.test(d)) return 'OTP Delivery';
  if (/\botp\b/.test(d) && /\b(enter|create\s+a\s+new\s+password)\b/.test(d)) {
    return 'OTP Entry';
  }
  if (/\breset\b/.test(d) && /\bpassword\b/.test(d) && !/\bstore|secure\b/.test(d)) {
    return 'Password Reset';
  }
  if (/\bpassword\b/.test(d) && /\b(store|stored|secure|hash|encrypt)\b/.test(d)) {
    return 'Password Security';
  }

  // Catalog / search
  if (/\bsearch\b/.test(d) && /\bresult/.test(d)) return 'Product Search Results';
  if (/\bfilter/.test(d) && /\bproduct/.test(d)) return 'Product Filtering';
  if (/\bsearch\b/.test(d) && /\bproduct/.test(d)) return 'Product Search';
  if (/\bproduct details?\b/.test(d) || /\bdetails page should display\b/.test(d)) {
    return 'Product Details';
  }

  // Cart — keep distinct
  if (/\badd\b/.test(d) && /\bcart\b/.test(d)) return 'Add Product To Cart';
  if (/\b(increase|decrease)\b/.test(d) && /\bquantity\b/.test(d)) {
    return 'Modify Product Quantity';
  }
  if (/\bremove\b/.test(d) && /\bcart\b/.test(d)) return 'Remove Product From Cart';
  if (/\btotal\s+price\b/.test(d) || (/\bcart\b/.test(d) && /\btotal\b/.test(d))) {
    return 'Display Cart Total';
  }

  // Payment — before order/confirmation (statements often mention both)
  if (/\b(fails?|failed|failure)\b/.test(d) && /\bpayment\b/.test(d)) {
    return 'Payment Failure Handling';
  }
  if (/\b(success(ful)?\s+payment|after successful payment)\b/.test(d)) {
    return 'Successful Payment Handling';
  }
  if (/\b(credit card|debit card|payment methods?)\b/.test(d)) return 'Payment Methods';
  if (/\bpayment\b/.test(d) && /\bprocess/.test(d)) return 'Payment Processing';
  if (/\bpayment\b/.test(d) && /\bnot\b/.test(d) && /\border\b/.test(d)) {
    return 'Prevent Order Creation On Failed Payment';
  }

  // Checkout / order
  if (/\bproceed to checkout|checkout from\b/.test(d)) return 'Proceed To Checkout';
  if (/\bcheckout\b/.test(d) && /\b(mandatory|required|contain|information|fields?)\b/.test(d)) {
    return 'Checkout Required Fields';
  }
  if (
    /\bopen (an? )?order\b/.test(d) ||
    (/\border\b/.test(d) && /\bview\b/.test(d) && /\bdetails?\b/.test(d))
  ) {
    return 'View Order Details';
  }
  if (/\border\b/.test(d) && /\b(creat|placed|place)\b/.test(d) && !/\bfail|not\b/.test(d)) {
    return 'Order Creation';
  }
  if (/\border confirmation|confirmation (email|message|page)\b/.test(d)) {
    return 'Order Confirmation';
  }
  if (/\border history\b/.test(d) || /\bprevious orders\b/.test(d) || /\bpast orders\b/.test(d)) {
    return 'Order History';
  }
  if (/\bown orders\b/.test(d) || (/\border\b/.test(d) && /\b(only|own|access)\b/.test(d))) {
    return 'Order Access Control';
  }

  // Stock / reviews
  if (/\bout of stock\b/.test(d)) return 'Out Of Stock Purchase Rule';
  if (/\breview\b/.test(d) || /\brating\b/.test(d)) {
    if (/\bpurchased\b/.test(d) || /\bonly users?\b/.test(d)) return 'Review Eligibility';
    return 'Product Review';
  }

  // Admin — title from action, not "Administrators Should Be Able"
  if (/\b(administrators?|admins?)\b/.test(d)) {
    if (/\binventory\b/.test(d)) return 'Update Product Inventory';
    if (/\badd\b/.test(d) && /\bproducts?\b/.test(d)) return 'Add Product';
    if (/\b(remove|delete)\b/.test(d) && /\bproducts?\b/.test(d)) return 'Remove Product';
    if (/\b(update|edit|modify)\b/.test(d) && /\bproducts?\b/.test(d)) {
      return 'Update Product';
    }
    if (/\bmanage\b/.test(d)) return 'Admin Product Management';
  }

  // Profile
  if (/\bprofile\b/.test(d) && /\b(cannot|must not|not be allowed).*\bemail\b/.test(d)) {
    return 'Profile Update Restrictions';
  }
  if (/\bprofile\b/.test(d) && /\b(contain|display|show|include)\b/.test(d)) {
    return 'User Profile Information';
  }
  if (/\bprofile\b/.test(d) && /\b(update|edit|manage)\b/.test(d)) return 'Profile Update';

  // NFR
  if (/\brespond within\b/.test(d) || /\bwithin\s+\d+\s+seconds?\b/.test(d)) {
    return 'Response Time';
  }
  if (/\b(fast|responsive|quickly)\b/.test(d) && /\b(search|checkout|application)\b/.test(d)) {
    if (/\bsearch\b/.test(d)) return 'Search Performance';
    if (/\bcheckout\b/.test(d)) return 'Checkout Performance';
    return 'Application Performance';
  }
  if (/\b(secure|security|encrypt|hash)\b/.test(d)) return 'Application Security';
  if (/\bmodern browsers?\b/.test(d)) return 'Browser Compatibility';
  if (/\bmobile\b/.test(d) || /\buser friendly\b/.test(d) || /\beasy to (use|navigate)\b/.test(d)) {
    if (/\bmobile\b/.test(d)) return 'Mobile Usability';
    if (/\bnavigate\b/.test(d)) return 'Navigation Usability';
    return 'Usability';
  }

  if (section && /^(user registration|user login|password reset|product details)$/i.test(section)) {
    if (/\b(should be able to|can)\b/.test(d)) {
      const primary =
        /create an account|register|login|reset|display|search|checkout|pay/i;
      if (primary.test(description)) return section;
    }
  }

  // Fallback: capability phrase, strip boilerplate, avoid trailing weak words
  let cleaned = description
    .replace(/^(the\s+)?(user|users|system|application|product|administrators?)\s+/i, '')
    .replace(/^(should|shall|must|can|will)\s+(be\s+able\s+to\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '')
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const titleWords = words.slice(0, Math.min(6, words.length));
  while (
    titleWords.length > 2 &&
    /^(and|or|the|a|an|to|using|their|with|for|from|of|be|able)$/i.test(
      titleWords[titleWords.length - 1] ?? '',
    )
  ) {
    titleWords.pop();
  }

  if (titleWords.length >= 2) {
    const title = titleCase(titleWords);
    if (!isTruncatedTitle(title)) return title;
  }

  return section && !isTruncatedTitle(section) ? section : 'Requirement';
}

/**
 * Reclassify FUNCTIONAL / NON_FUNCTIONAL / BUSINESS_RULE from meaning.
 */
export function classifyRequirementType(
  description: string,
  title?: string,
): RequirementType {
  const blob = `${title ?? ''} ${description}`.toLowerCase();

  if (
    /\b(within\s+\d+\s*(?:ms|milliseconds|seconds?|s|minutes?)|response\s*time|performance|scalability|scalable|fast|responsive|quickly|latency|throughput|load\s*time)\b/.test(
      blob,
    )
  ) {
    return 'NON_FUNCTIONAL';
  }
  if (
    /\b(secure|security|encrypt|encryption|hash|hashed|tls|https|password[s]?\s+(should|must)\s+be\s+stored)\b/.test(
      blob,
    )
  ) {
    return 'NON_FUNCTIONAL';
  }
  if (
    /\b(easy to use|easy to navigate|user friendly|usability|mobile devices?|modern browsers?|accessible|accessibility)\b/.test(
      blob,
    )
  ) {
    return 'NON_FUNCTIONAL';
  }

  if (
    /\b(must be unique|must not|must only|cannot|can only|should not allow|must expire|expire[sd]?\s+after|only\s+one|only\s+(?:users?|administrators?|admins?)\b|out of stock|who have purchased|not be allowed|normal users cannot)\b/.test(
      blob,
    )
  ) {
    return 'BUSINESS_RULE';
  }

  return 'FUNCTIONAL';
}

/**
 * Semantic capability fingerprint for merge/dedupe.
 * Distinct cart/admin actions stay separate.
 */
export function capabilityFingerprint(title: string, description: string): string {
  const t = normalizeKey(title);
  const d = normalizeKey(description);
  const blob = `${t} ${d}`;

  if (/unique email|email .*unique|must be unique/.test(blob) && /email/.test(blob)) {
    return 'cap:unique-email';
  }
  if (/invalid/.test(blob) && /(credential|login|error)/.test(blob)) {
    return 'cap:invalid-login';
  }
  if (/user login|^login$|login using|\blog in\b/.test(blob) && !/invalid/.test(blob)) {
    return 'cap:login';
  }
  if (/user registration|create an account|register using/.test(blob)) {
    return 'cap:registration';
  }
  if (/registration redirect|redirect.*login/.test(blob)) return 'cap:reg-redirect';

  if (/otp/.test(blob) && /expire/.test(blob)) return 'cap:otp-expire';
  if (/otp/.test(blob) && /(sent|send|email|deliver)/.test(blob)) return 'cap:otp-deliver';
  if (/otp/.test(blob) && /(enter|create.*password)/.test(blob)) return 'cap:otp-enter';
  if (/password reset|reset .*password/.test(blob) && !/otp|store|secure/.test(blob)) {
    return 'cap:password-reset';
  }
  if (/password/.test(blob) && /(store|secure|hash|encrypt)/.test(blob)) {
    return 'cap:password-security';
  }

  if (/product search results/.test(blob)) return 'cap:search-results';
  if (/product search|search for products/.test(blob) && !/result|filter/.test(blob)) {
    return 'cap:search';
  }
  if (/filter/.test(blob) && /product/.test(blob)) return 'cap:filter';
  if (/product details|details page should display/.test(blob)) return 'cap:product-details';

  if (/\badd\b/.test(blob) && /\bcart\b/.test(blob)) return 'cap:cart-add';
  if (/\bremove\b/.test(blob) && /\bcart\b/.test(blob)) return 'cap:cart-remove';
  if (/(increase|decrease|quantity)/.test(blob) && /(cart|product)/.test(blob)) {
    return 'cap:cart-qty';
  }
  if (/\btotal\b/.test(blob) && /\bcart\b/.test(blob)) return 'cap:cart-total';

  if (/proceed to checkout|checkout from/.test(blob)) return 'cap:checkout-proceed';
  if (/checkout/.test(blob) && /(mandatory|required|contain|field|information)/.test(blob)) {
    return 'cap:checkout-fields';
  }

  if (/(fails?|failed|failure)/.test(blob) && /payment/.test(blob)) {
    return 'cap:payment-failure';
  }
  if (/(success(ful)? payment|after successful payment)/.test(blob)) {
    return 'cap:payment-success';
  }
  if (/(credit|debit|payment method)/.test(blob)) return 'cap:payment-methods';
  if (/payment/.test(blob) && /process/.test(blob)) return 'cap:payment-process';
  // Generic "Payment" title with weak body — still one payment bucket for merge
  if (/^payment$/.test(t) || (/^payment$/.test(normalizeKey(description)) && description.length < 40)) {
    return 'cap:payment-generic';
  }

  if (/out of stock/.test(blob)) return 'cap:out-of-stock';
  // Reviews: functional + eligibility BR share one capability for merge
  if (/review|rating/.test(blob)) return 'cap:product-review';

  if (/(administrators?|admins?)/.test(blob)) {
    if (/inventory/.test(blob)) return 'cap:admin-inventory';
    if (/\badd\b/.test(blob) && /products?/.test(blob)) return 'cap:admin-add';
    if (/(remove|delete)/.test(blob) && /products?/.test(blob)) return 'cap:admin-remove';
    if (/(update|edit|modify)/.test(blob) && /products?/.test(blob)) {
      return 'cap:admin-update';
    }
    if (/manage/.test(blob)) return 'cap:admin-manage';
  }

  if (/order confirmation/.test(blob)) return 'cap:order-confirm';
  if (/order history/.test(blob)) return 'cap:order-history';
  if (/order/.test(blob) && /(creat|place)/.test(blob) && !/fail|not/.test(blob)) {
    return 'cap:order-create';
  }
  if (/own orders|order access|view.*orders/.test(blob)) return 'cap:order-access';

  if (/profile/.test(blob) && /(cannot|must not|not be allowed).*email/.test(blob)) {
    return 'cap:profile-email-lock';
  }
  if (/profile/.test(blob)) return 'cap:profile-update';

  if (/(fast|responsive|quickly|within \d+)/.test(blob)) {
    if (/search/.test(blob)) return 'cap:nfr-search-perf';
    if (/checkout/.test(blob)) return 'cap:nfr-checkout-perf';
    return 'cap:nfr-perf';
  }
  if (/(secure|security|encrypt)/.test(blob)) return 'cap:nfr-security';
  if (/(user friendly|easy to navigate|easy to use|mobile)/.test(blob)) {
    return 'cap:nfr-usability';
  }
  if (/modern browsers/.test(blob)) return 'cap:nfr-browsers';

  // Exact same title (non-generic) → same capability
  if (t.length > 4 && !/^(payment|requirement|item|details)$/.test(t)) {
    return `title:${t}`;
  }

  return `src:${d}`;
}

function preferDescription(a: string, b: string): string {
  // Prefer longer complete sentence
  const as = ensureSentence(a);
  const bs = ensureSentence(b);
  if (as.length >= bs.length && !isTruncatedTitle(as)) return as;
  if (!isTruncatedTitle(bs)) return bs;
  return as.length >= bs.length ? as : bs;
}

function mergeInto(
  target: TempCandidate & { _fp: string },
  incoming: TempCandidate,
): void {
  const sameDesc =
    normalizeKey(target.description) === normalizeKey(incoming.description);

  if (!sameDesc) {
    // Business rule text → businessRules when types differ or BR signal
    const incomingType = classifyRequirementType(incoming.description, incoming.title);
    if (
      incomingType === 'BUSINESS_RULE' &&
      classifyRequirementType(target.description, target.title) === 'FUNCTIONAL'
    ) {
      if (
        !target.businessRules.some(
          (x) => normalizeKey(x) === normalizeKey(incoming.description),
        )
      ) {
        target.businessRules.push(ensureSentence(incoming.description));
      }
    } else if (
      classifyRequirementType(target.description, target.title) === 'BUSINESS_RULE' &&
      incomingType === 'FUNCTIONAL'
    ) {
      // Promote functional description to primary; keep BR
      const br = ensureSentence(target.description);
      target.description = preferDescription(incoming.description, target.description);
      target.source.text = incoming.source.text || target.source.text;
      if (!target.businessRules.some((x) => normalizeKey(x) === normalizeKey(br))) {
        target.businessRules.push(br);
      }
    } else {
      if (
        !target.supportingInformation.some(
          (x) => normalizeKey(x) === normalizeKey(incoming.description),
        )
      ) {
        target.supportingInformation.push(
          incoming.description.replace(/[.]+$/, ''),
        );
      }
      target.description = preferDescription(target.description, incoming.description);
      if (incoming.source.text.length > (target.source.text?.length ?? 0)) {
        target.source.text = incoming.source.text;
      }
    }
  }

  for (const ac of incoming.acceptanceCriteria) {
    if (!target.acceptanceCriteria.some((x) => normalizeKey(x) === normalizeKey(ac))) {
      target.acceptanceCriteria.push(ac);
    }
  }
  for (const br of incoming.businessRules) {
    if (!target.businessRules.some((x) => normalizeKey(x) === normalizeKey(br))) {
      target.businessRules.push(br);
    }
  }
  for (const si of incoming.supportingInformation) {
    if (!target.supportingInformation.some((x) => normalizeKey(x) === normalizeKey(si))) {
      target.supportingInformation.push(si);
    }
  }
  if (!target.source.section && incoming.source.section) {
    target.source.section = incoming.source.section;
  }
}

/**
 * Normalize candidates: merge duplicates, regenerate titles, reclassify, assign REQ IDs last.
 */
export function normalizeRequirements(
  candidates: TempCandidate[],
): { requirements: SemanticExtractedRequirement[]; stats: NormalizationStats } {
  let merged = 0;
  let retitled = 0;
  let reclassified = 0;

  type Working = TempCandidate & { _fp: string };
  const working: Working[] = [];

  for (const c of candidates) {
    // Ensure description is full meaning, not truncated title echo
    let description = ensureSentence(c.description || c.source.text || '');
    if (
      description.length < 20 ||
      isTruncatedTitle(description) ||
      normalizeKey(description) === normalizeKey(c.title)
    ) {
      description = ensureSentence(c.source.text || c.description || c.title);
    }

    const classified = classifyRequirementType(description, c.title);
    if (classified !== c.type) reclassified += 1;

    const fp = capabilityFingerprint(c.title, description);
    const existing = working.find((w) => w._fp === fp);

    const next: TempCandidate = {
      ...c,
      description,
      type: classified,
      acceptanceCriteria: [...c.acceptanceCriteria],
      businessRules: [...c.businessRules],
      supportingInformation: [...c.supportingInformation],
      dependencies: [...c.dependencies],
      source: { ...c.source, text: c.source.text || description },
    };

    if (existing) {
      mergeInto(existing, next);
      merged += 1;
      continue;
    }

    working.push({ ...next, _fp: fp });
  }

  // Second pass: merge exact title collisions only when fingerprint matches
  const byTitle = new Map<string, Working>();
  const collapsed: Working[] = [];
  for (const w of working) {
    const key = normalizeKey(
      generateSemanticTitle(w.description, w.source.section, w.type),
    );
    const generic = /^(payment|requirement|item)$/.test(key);
    if (!generic && byTitle.has(key)) {
      const target = byTitle.get(key)!;
      if (target._fp === w._fp) {
        mergeInto(target, w);
        merged += 1;
        continue;
      }
    }
    if (!generic && !byTitle.has(key)) byTitle.set(key, w);
    collapsed.push(w);
  }

  // Special: merge Review Eligibility BR into Product Review if both exist
  const reviewFunc = collapsed.find((w) => w._fp === 'cap:product-review' && w.type === 'FUNCTIONAL');
  const reviewBr = collapsed.filter(
    (w) => w._fp === 'cap:product-review' && w.type === 'BUSINESS_RULE' && w !== reviewFunc,
  );
  if (reviewFunc && reviewBr.length) {
    for (const br of reviewBr) {
      mergeInto(reviewFunc, br);
      merged += 1;
    }
    const brIds = new Set(reviewBr.map((b) => b.tempId));
    const afterReview = collapsed.filter((w) => !brIds.has(w.tempId));
    collapsed.length = 0;
    collapsed.push(...afterReview);
  }

  // Drop generic payment shell if richer payment caps exist
  const hasSpecificPayment = collapsed.some((w) =>
    /cap:payment-(failure|success|methods|process)/.test(w._fp),
  );
  const finalsWorking = hasSpecificPayment
    ? collapsed.filter((w) => w._fp !== 'cap:payment-generic')
    : collapsed;

  // Title regeneration + final classification
  const requirements: SemanticExtractedRequirement[] = finalsWorking.map((w, i) => {
    const type = classifyRequirementType(w.description, w.title);
    if (type !== w.type) reclassified += 1;

    let title = generateSemanticTitle(w.description, w.source.section, type);
    // Prefer Product Review over Review Eligibility when functional body present
    if (w._fp === 'cap:product-review' && type === 'FUNCTIONAL') {
      title = 'Product Review';
    }
    if (w._fp === 'cap:product-review' && type === 'BUSINESS_RULE' && !finalsWorking.some((x) => x._fp === 'cap:product-review' && x.type === 'FUNCTIONAL')) {
      title = 'Review Eligibility';
    }

    if (normalizeKey(title) !== normalizeKey(w.title) || isTruncatedTitle(w.title)) {
      retitled += 1;
    }

    // Never allow truncated final titles
    if (isTruncatedTitle(title)) {
      title = generateSemanticTitle(w.description, w.source.section, type);
    }

    return {
      requirementKey: `REQ-${String(i + 1).padStart(3, '0')}`,
      title,
      description: ensureSentence(w.description),
      type,
      priority: w.priority,
      acceptanceCriteria: w.acceptanceCriteria,
      businessRules: w.businessRules,
      dependencies: w.dependencies,
      supportingInformation: w.supportingInformation,
      source: {
        document: w.source.document,
        page: w.source.page,
        section: w.source.section,
        text: w.source.text || w.description,
      },
    };
  });

  return {
    requirements,
    stats: {
      candidatesIn: candidates.length,
      merged,
      retitled,
      reclassified,
      finals: requirements.length,
    },
  };
}
