/**
 * Business rule classification + business impact scoring.
 */

import type {
  BusinessImpact,
  ReviewRequirementType,
} from './types.js';

export type ClassifiableRequirement = {
  title: string;
  description: string;
  type?: string | null;
  sourceText?: string | null;
  businessRules?: string[];
  acceptanceCriteria?: string[];
};

const BUSINESS_RULE_PATTERNS =
  /\b(only|must|cannot|can only|eligible|eligibility|permission|role|admin|administrator|unique|expire|expiry|limit|restrict|restriction|ownership|own orders?|access control|out of stock|cannot be purchased|refund|cancel|discount|pricing|approval|reject|inventory|otp valid|attempt)\b/i;

const NON_FUNCTIONAL_PATTERNS =
  /\b(performance|latency|response time|scalability|availability|uptime|security standard|encryption|compliance|accessibility|wcag)\b/i;

export function classifyRequirementTypes(
  req: ClassifiableRequirement,
): {
  primaryType: ReviewRequirementType;
  secondaryType: ReviewRequirementType | null;
} {
  const blob = [
    req.title,
    req.description,
    req.sourceText ?? '',
    ...(req.businessRules ?? []),
    ...(req.acceptanceCriteria ?? []),
  ]
    .join('\n')
    .toLowerCase();

  const looksBusinessRule =
    BUSINESS_RULE_PATTERNS.test(blob) ||
    (req.businessRules ?? []).length > 0 ||
    req.type === 'BUSINESS_RULE';
  const looksNfr = NON_FUNCTIONAL_PATTERNS.test(blob) || req.type === 'NON_FUNCTIONAL';
  const looksFunctional =
    /\b(user can|users can|system shall|shall|display|enter|submit|navigate|redirect|search|add to cart|login|register|checkout|pay)\b/i.test(
      blob,
    ) || req.type === 'FUNCTIONAL';

  // Strong business-rule titles (access, eligibility, stock, unique email)
  const strongBr =
    /\b(unique email|access control|out of stock|cannot be purchased|only administrator|only purchased|order access)\b/i.test(
      blob,
    );

  if (strongBr || (looksBusinessRule && !looksFunctional)) {
    return {
      primaryType: 'BUSINESS_RULE',
      secondaryType: looksFunctional ? 'FUNCTIONAL' : looksNfr ? 'NON_FUNCTIONAL' : null,
    };
  }

  if (looksBusinessRule && looksFunctional) {
    // Payment failure / cancel eligibility → BR primary
    if (
      /\b(failure|fail|cancel|eligibility|permission|access|stock|refund|otp)\b/i.test(
        blob,
      )
    ) {
      return { primaryType: 'BUSINESS_RULE', secondaryType: 'FUNCTIONAL' };
    }
    return { primaryType: 'FUNCTIONAL', secondaryType: 'BUSINESS_RULE' };
  }

  if (looksNfr && !looksFunctional) {
    return { primaryType: 'NON_FUNCTIONAL', secondaryType: null };
  }

  if (looksNfr && looksFunctional) {
    return { primaryType: 'FUNCTIONAL', secondaryType: 'NON_FUNCTIONAL' };
  }

  // Honor existing type when unclear
  if (req.type === 'BUSINESS_RULE') {
    return { primaryType: 'BUSINESS_RULE', secondaryType: null };
  }
  if (req.type === 'NON_FUNCTIONAL') {
    return { primaryType: 'NON_FUNCTIONAL', secondaryType: null };
  }
  return { primaryType: 'FUNCTIONAL', secondaryType: null };
}

/**
 * Business impact is independent of open question count.
 * Critical domains / access / money / inventory rank highest.
 */
export function computeBusinessImpact(
  req: ClassifiableRequirement,
): BusinessImpact {
  const blob = `${req.title}\n${req.description}\n${req.sourceText ?? ''}`.toLowerCase();

  if (
    /\b(payment fail|payment failure|payment succeeds|order creation fails|access control|another user'?s|inventory.*checkout|checkout.*inventory|refund|charge)\b/.test(
      blob,
    ) ||
    (/\bpayment\b/.test(blob) && /\b(fail|success|order)\b/.test(blob))
  ) {
    return 'CRITICAL';
  }

  if (
    /\b(cancel.*order|order.*cancel|out of stock|cannot be purchased|otp|unique email|administrator|admin access|permission|checkout|login attempt|lock)\b/.test(
      blob,
    )
  ) {
    return 'HIGH';
  }

  if (
    /\b(register|registration|cart|review|search|profile|confirmation email|navigation)\b/.test(
      blob,
    )
  ) {
    return 'MEDIUM';
  }

  if (/\b(error message|button|label|wording|ui|display text)\b/.test(blob)) {
    return 'LOW';
  }

  return 'MEDIUM';
}
