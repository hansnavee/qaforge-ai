/**
 * Normalized requirement model for semantic review / duplicate intelligence.
 * Domain-agnostic — no project-specific REQ IDs or titles.
 */

import {
  buildSemanticProfile,
  type CrudOp,
  type SemanticComparable,
} from './semantic-profile.js';
import {
  acceptStructuredSemantics,
  resolveStructuredSemantics,
  type StructuredPolarity,
  type StructuredRequirementSemantics,
} from './structured-semantics.js';

export type NormalizedRequirement = {
  id: string;
  title: string;
  originalText: string;
  actor: string[];
  businessArea: string;
  feature: string;
  subFeature?: string | null;
  entity: string[];
  action: string[];
  capability: string;
  businessOutcome: string;
  channel: string | null;
  context: string | null;
  crudOp: CrudOp | null;
  preconditions: string[];
  businessRules: string[];
  type: 'Functional' | 'Business Rule' | 'Non-Functional';
  businessImpact: 'Critical' | 'High' | 'Medium' | 'Low';
  reviewStatus:
    | 'Needs clarification'
    | 'Blocked'
    | 'Review recommended'
    | 'Ready for test design';
  /** Flow step index when known (lower precedes higher). */
  flowStep: number | null;
  /** True when this requirement primarily expresses a constraint / BR. */
  isBusinessRule: boolean;
  polarity: StructuredPolarity;
  condition: string | null;
  structuredConfidence: number;
  structuredUncertain: boolean;
  structuredSource: StructuredRequirementSemantics['source'] | null;
};

export type NormalizeInput = SemanticComparable & {
  type?: string | null;
  businessImpact?: string | null;
  reviewStatus?: string | null;
  businessRules?: string[] | null;
};

/** Generic business-flow ordering (capability / sub-feature keys). */
export const BUSINESS_FLOW_STEPS: string[] = [
  'user_registration',
  'user_login',
  'password_reset',
  'otp_delivery',
  'otp_entry',
  'otp_expiration',
  'product_search',
  'product_search_results',
  'product_filtering',
  'product_details',
  'product_discovery',
  'shopping_cart',
  'checkout',
  'payment',
  'order_confirmation',
  'order_history',
  'order_details',
  'order_access',
  'order_management',
  'product_administration',
  'inventory_update',
  // inventory (stock BR) intentionally omitted from sequential chain
];

function mapType(t?: string | null): NormalizedRequirement['type'] {
  const u = (t ?? '').toUpperCase();
  if (u.includes('BUSINESS')) return 'Business Rule';
  if (u.includes('NON')) return 'Non-Functional';
  return 'Functional';
}

function mapImpact(t?: string | null): NormalizedRequirement['businessImpact'] {
  const u = (t ?? '').toUpperCase();
  if (u === 'CRITICAL') return 'Critical';
  if (u === 'HIGH') return 'High';
  if (u === 'LOW') return 'Low';
  return 'Medium';
}

function mapStatus(
  t?: string | null,
): NormalizedRequirement['reviewStatus'] {
  const u = (t ?? '').toUpperCase();
  if (u === 'BLOCKED') return 'Blocked';
  if (u === 'NEEDS_CLARIFICATION') return 'Needs clarification';
  if (u === 'READY_FOR_TEST_DESIGN') return 'Ready for test design';
  return 'Review recommended';
}

function detectBusinessRule(
  text: string,
  type: NormalizedRequirement['type'],
): boolean {
  if (type === 'Business Rule') return true;
  const t = text.toLowerCase();
  return /\b(must|cannot|can only|only users?|only administrators?|must be unique|must not|should not|out of stock.*cannot|cannot be purchased|expire|not be allowed|forbidden)\b/.test(
    t,
  );
}

function refineSubFeature(
  text: string,
  capability: string,
  channel: string | null,
  entity: string,
): string | null {
  const t = text.toLowerCase();
  const isAdmin = /\b(administrators?|admins?|managers?)\b/.test(t);
  if (capability.includes('order_confirmation') || entity === 'order_confirmation') {
    if (channel === 'email' || /\bemail\b/.test(t)) return 'confirmation_email';
    if (channel === 'web' || /\b(page|screen)\b/.test(t)) return 'confirmation_page';
    return 'order_confirmation';
  }
  if (/search result/.test(t) || /from search/.test(t)) return 'search_results';
  if (/search bar|\bsearch\b/.test(t) && !/result|detail|select/.test(t))
    return 'search';
  // Product details only when the viewed entity is a product
  if (
    !isAdmin &&
    entity === 'product' &&
    (/product detail|view product|product page/.test(t) ||
      (/view (its )?details/.test(t) && /\bproduct/.test(t)))
  ) {
    return 'product_details';
  }
  if (entity === 'inventory') return 'inventory_management';
  if (entity === 'product_catalog' && /update|edit|modify/.test(t))
    return 'catalog_information';
  if (entity === 'product_catalog' && /add|create/.test(t)) return 'catalog_create';
  if (entity === 'product_catalog' && /remove|delete/.test(t))
    return 'catalog_delete';
  if (entity === 'order' && /history|past orders|previous orders/.test(t))
    return 'order_history';
  if (entity === 'order') return 'order_details';
  return null;
}

/**
 * Entity-first capability refinement.
 * Never use bare "view details" to force product_details.
 */
function refineCapability(
  text: string,
  profileCapability: string,
  entity: string,
  action: string,
): string {
  const t = text.toLowerCase();
  const isAdmin = /\b(administrators?|admins?|managers?)\b/.test(t);

  // Entity-first: orders before product phrasing
  if (entity === 'order') {
    if (/history|past orders|previous orders|my orders/.test(t))
      return 'order_history';
    if (/access|another user|own orders?/.test(t)) return 'order_access';
    return 'order_details';
  }
  if (entity === 'order_confirmation') return 'order_confirmation';
  if (entity === 'cart_item' || action === 'add_to') return 'shopping_cart';
  if (entity === 'checkout') return 'checkout';
  if (entity === 'payment') return 'payment';
  if (entity === 'inventory') {
    if (/update|edit|modify|change/.test(t) && isAdmin) return 'inventory_update';
    return 'inventory';
  }
  if (
    entity === 'product_catalog' ||
    (isAdmin && /product/.test(t) && !/cart/.test(t) && !/inventory|stock/.test(t))
  ) {
    return 'product_administration';
  }

  if (/search result|select a product from search|from search results/.test(t)) {
    return 'product_search_results';
  }
  if (
    (/\bfilter\b/.test(t) || action === 'filter') &&
    /product/.test(t) &&
    !/detail|cart|inventory/.test(t)
  ) {
    return 'product_filtering';
  }
  if (
    (/\bsearch\b/.test(t) || action === 'search') &&
    /product/.test(t) &&
    !/detail|cart|inventory|filter/.test(t)
  ) {
    return 'product_search';
  }
  if (
    /password reset|reset their password|forgot password/.test(t) ||
    (action === 'reset' && /password/.test(t))
  ) {
    return 'password_reset';
  }
  if (/\botp\b/.test(t) && /sent|send|email|deliver|notify/.test(t)) {
    return 'otp_delivery';
  }
  if (/\b(register|registration|sign up|create an account)\b/.test(t)) {
    return 'user_registration';
  }
  if (
    /\b(log\s*in|login|sign\s*in|sign-in)\b/.test(t) &&
    !/\b(register|registration|sign up|create an account)\b/.test(t)
  ) {
    return 'user_login';
  }
  if (
    /\b(access_control|administrative functionality|administrator permissions)\b/.test(
      t,
    ) ||
    profileCapability === 'access_control' ||
    (/\bnormal users?\b/.test(t) && /administrator/.test(t)) ||
    (/\b(prevent|should not|must not|cannot)\b/.test(t) &&
      /\b(normal users?|non-?admin)\b/.test(t) &&
      /\b(product management|administrative|administrator)\b/.test(t))
  ) {
    return 'access_control';
  }
  // Product details — require product entity (or explicit product wording)
  if (
    !isAdmin &&
    (entity === 'product' || /\bproduct\b/.test(t)) &&
    (/product detail|view product|product page/.test(t) ||
      (/view (its )?details/.test(t) && /\bproduct\b/.test(t)))
  ) {
    return 'product_details';
  }
  if (profileCapability === 'order_details' || profileCapability === 'order_history') {
    return profileCapability;
  }
  return profileCapability;
}

function flowStepFor(capability: string, subFeature: string | null): number | null {
  const keys = [subFeature, capability].filter(Boolean) as string[];
  for (const key of keys) {
    const idx = BUSINESS_FLOW_STEPS.indexOf(key);
    if (idx >= 0) return idx;
  }
  if (capability.includes('search_results')) {
    return BUSINESS_FLOW_STEPS.indexOf('product_search_results');
  }
  if (capability.includes('search') && !capability.includes('order')) {
    return BUSINESS_FLOW_STEPS.indexOf('product_search');
  }
  if (capability === 'product_details') {
    return BUSINESS_FLOW_STEPS.indexOf('product_details');
  }
  if (capability.includes('order_details')) {
    return BUSINESS_FLOW_STEPS.indexOf('order_details');
  }
  if (capability.includes('cart')) {
    return BUSINESS_FLOW_STEPS.indexOf('shopping_cart');
  }
  return null;
}

/**
 * Convert a raw requirement into the normalized semantic model.
 * When structured semantics are accepted (LLM/heuristic confidence ≥ 0.85),
 * actor/action/object/capability/polarity override keyword heuristics.
 */
export function normalizeRequirement(input: NormalizeInput): NormalizedRequirement {
  const profile = buildSemanticProfile(input);
  const text = `${input.title}\n${input.description}\n${input.sourceText ?? ''}`;
  const structured = resolveStructuredSemantics(
    {
      requirementKey: input.requirementKey,
      title: input.title,
      description: input.description,
      sourceText: input.sourceText,
      type: input.type,
    },
    input.structured ?? null,
  );
  const useStructured = acceptStructuredSemantics(structured);

  let type = mapType(input.type ?? structured.requirementType);
  if (useStructured && structured.requirementType === 'BUSINESS_RULE') {
    type = 'Business Rule';
  } else if (useStructured && structured.requirementType === 'NON_FUNCTIONAL') {
    type = 'Non-Functional';
  }

  let capability = refineCapability(
    text,
    profile.capability,
    profile.entity,
    profile.action,
  );
  let entity = profile.entity;
  let action = profile.action;
  let actor =
    profile.actor === 'registered_user' ? 'customer' : profile.actor;

  if (useStructured) {
    // Never let placeholder structured fields wipe a stronger refinement.
    entity =
      structured.object && structured.object !== 'general'
        ? structured.object
        : entity;
    action =
      structured.action && structured.action !== 'unspecified'
        ? structured.action
        : action;
    actor =
      structured.actor === 'user' ? 'customer' : structured.actor || actor;
    if (structured.capability && structured.capability !== 'general') {
      capability = structured.capability;
    } else {
      capability = refineCapability(text, profile.capability, entity, action);
    }
  } else if (structured.capability && structured.capability !== 'general') {
    // Partial: still prefer high-signal heuristic capability from resolver
    capability = structured.capability;
    if (structured.object !== 'general') entity = structured.object;
    if (structured.action !== 'unspecified') action = structured.action;
  }

  const channel = profile.channel;
  const subFeature = refineSubFeature(text, capability, channel, entity);

  const isBusinessRule =
    type === 'Business Rule' ||
    structured.requirementType === 'BUSINESS_RULE' ||
    structured.polarity === 'NOT_ALLOWED' ||
    detectBusinessRule(text, type);

  let businessOutcome = profile.outcome;
  if (structured.condition === 'OUT_OF_STOCK' || capability === 'inventory') {
    businessOutcome = 'unavailable_purchase_blocked';
  } else if (capability === 'email_uniqueness') {
    businessOutcome = 'email_uniqueness_enforced';
  }

  return {
    id: input.requirementKey,
    title: input.title,
    originalText: text.trim(),
    actor: [actor],
    businessArea: input.businessArea ?? 'Unclassified',
    feature: input.featureName ?? capability.replace(/_/g, ' '),
    subFeature,
    entity: [entity],
    action: [action],
    capability,
    businessOutcome,
    channel,
    context: profile.context,
    crudOp: profile.crudOp,
    preconditions: profile.preconditions,
    businessRules: input.businessRules ?? [],
    type,
    businessImpact: mapImpact(input.businessImpact),
    reviewStatus: mapStatus(input.reviewStatus),
    flowStep: flowStepFor(capability, subFeature),
    isBusinessRule,
    polarity: structured.polarity,
    condition: structured.condition,
    structuredConfidence: structured.confidence,
    structuredUncertain: !!structured.uncertain,
    structuredSource: structured.source ?? null,
  };
}

export function sameActor(a: NormalizedRequirement, b: NormalizedRequirement): boolean {
  return a.actor[0] === b.actor[0];
}

export function sameEntity(a: NormalizedRequirement, b: NormalizedRequirement): boolean {
  return a.entity[0] === b.entity[0];
}

export function sameCapability(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  return a.capability === b.capability;
}

/** True only when both share a coherent business workflow family. */
export function capabilityFamily(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  if (a.capability === b.capability) return true;
  const admin = new Set(['product_administration', 'inventory_update']);
  if (admin.has(a.capability) && admin.has(b.capability)) return true;
  const payment = new Set([
    'payment',
    'payment_methods',
    'payment_processing',
    'payment_failure',
  ]);
  if (payment.has(a.capability) && payment.has(b.capability)) return true;
  const discovery = new Set([
    'product_search',
    'product_search_results',
    'product_filtering',
    'product_details',
    'product_discovery',
  ]);
  if (discovery.has(a.capability) && discovery.has(b.capability)) return true;
  const authLifecycle = new Set([
    'user_registration',
    'registration_redirect',
    'user_login',
  ]);
  if (authLifecycle.has(a.capability) && authLifecycle.has(b.capability))
    return true;
  const otpFamily = new Set([
    'password_reset',
    'otp_delivery',
    'otp_entry',
    'otp_expiration',
  ]);
  if (otpFamily.has(a.capability) && otpFamily.has(b.capability)) return true;
  if (a.capability === 'access_control' && b.capability === 'access_control')
    return true;
  const purchase = new Set([
    'shopping_cart',
    'checkout',
    'payment',
    'order_confirmation',
  ]);
  if (purchase.has(a.capability) && purchase.has(b.capability)) return true;
  const order = new Set([
    'order_history',
    'order_details',
    'order_access',
    'order_management',
    'order_confirmation',
  ]);
  if (order.has(a.capability) && order.has(b.capability)) return true;
  return false;
}

/** Adjacent workflow steps eligible for SEQUENTIAL (not merely same feature). */
export function areSequentialCapabilities(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  if (a.flowStep == null || b.flowStep == null) return false;
  if (a.flowStep === b.flowStep) return false;
  // Constraints / access / admin CRUD are never sequential by flow index alone
  if (
    a.capability === 'inventory' ||
    b.capability === 'inventory' ||
    a.capability === 'email_uniqueness' ||
    b.capability === 'email_uniqueness' ||
    a.capability === 'access_control' ||
    b.capability === 'access_control' ||
    a.capability === 'product_administration' ||
    b.capability === 'product_administration' ||
    a.capability === 'inventory_update' ||
    b.capability === 'inventory_update'
  ) {
    return false;
  }
  if (!capabilityFamily(a, b)) return false;
  // Must be nearby in the same family chain (not just same area)
  return Math.abs(a.flowStep - b.flowStep) <= 3;
}
