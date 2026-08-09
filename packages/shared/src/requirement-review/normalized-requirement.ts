/**
 * Normalized requirement model for semantic review / duplicate intelligence.
 * Domain-agnostic — no project-specific REQ IDs or titles.
 */

import {
  buildSemanticProfile,
  type CrudOp,
  type SemanticComparable,
} from './semantic-profile.js';

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
  'product_search',
  'product_search_results',
  'product_details',
  'product_discovery',
  'shopping_cart',
  'checkout',
  'payment',
  'order_confirmation',
  'order_history',
  'order_access',
  'product_administration',
  'inventory',
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
  if (
    !isAdmin &&
    /product detail|view (its )?details|view product/.test(t)
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

function refineCapability(
  text: string,
  profileCapability: string,
  entity: string,
  action: string,
): string {
  const t = text.toLowerCase();
  const isAdmin = /\b(administrators?|admins?|managers?)\b/.test(t);
  if (entity === 'product_catalog' || (isAdmin && /product/.test(t) && !/cart/.test(t))) {
    return 'product_administration';
  }
  if (entity === 'inventory') return 'inventory';
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
  // OTP delivery only — do not remap order-confirmation email notify actions
  if (/\botp\b/.test(t) && /sent|send|email|deliver|notify/.test(t)) {
    return 'otp_delivery';
  }
  if (
    /\b(access_control|administrative functionality|administrator permissions)\b/.test(
      t,
    ) ||
    profileCapability === 'access_control'
  ) {
    return 'access_control';
  }
  if (
    !isAdmin &&
    (/product detail|view (its )?details|view product/.test(t) ||
      entity === 'product')
  ) {
    if (/detail|view/.test(t)) return 'product_details';
  }
  if (entity === 'cart_item' || action === 'add_to') return 'shopping_cart';
  if (entity === 'order_confirmation') return 'order_confirmation';
  if (entity === 'order') return 'order_management';
  return profileCapability;
}

function flowStepFor(capability: string, subFeature: string | null): number | null {
  const keys = [subFeature, capability].filter(Boolean) as string[];
  for (const key of keys) {
    const idx = BUSINESS_FLOW_STEPS.indexOf(key);
    if (idx >= 0) return idx;
  }
  // fuzzy: product_search_results after product_search
  if (capability.includes('search_results')) {
    return BUSINESS_FLOW_STEPS.indexOf('product_search_results');
  }
  if (capability.includes('search')) {
    return BUSINESS_FLOW_STEPS.indexOf('product_search');
  }
  if (capability.includes('detail')) {
    return BUSINESS_FLOW_STEPS.indexOf('product_details');
  }
  if (capability.includes('cart')) {
    return BUSINESS_FLOW_STEPS.indexOf('shopping_cart');
  }
  return null;
}

/**
 * Convert a raw requirement into the normalized semantic model.
 */
export function normalizeRequirement(input: NormalizeInput): NormalizedRequirement {
  const profile = buildSemanticProfile(input);
  const text = `${input.title}\n${input.description}\n${input.sourceText ?? ''}`;
  const capability = refineCapability(
    text,
    profile.capability,
    profile.entity,
    profile.action,
  );
  const channel = profile.channel;
  const subFeature = refineSubFeature(
    text,
    capability,
    channel,
    profile.entity,
  );
  const actor =
    profile.actor === 'registered_user' ? 'customer' : profile.actor;

  return {
    id: input.requirementKey,
    title: input.title,
    originalText: text.trim(),
    actor: [actor],
    businessArea: input.businessArea ?? 'Unclassified',
    feature: input.featureName ?? capability.replace(/_/g, ' '),
    subFeature,
    entity: [profile.entity],
    action: [profile.action],
    capability,
    businessOutcome: profile.outcome,
    channel,
    context: profile.context,
    crudOp: profile.crudOp,
    preconditions: profile.preconditions,
    businessRules: input.businessRules ?? [],
    type: mapType(input.type),
    businessImpact: mapImpact(input.businessImpact),
    reviewStatus: mapStatus(input.reviewStatus),
    flowStep: flowStepFor(capability, subFeature),
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

export function capabilityFamily(
  a: NormalizedRequirement,
  b: NormalizedRequirement,
): boolean {
  if (a.capability === b.capability) return true;
  const admin = new Set(['product_administration', 'inventory']);
  if (admin.has(a.capability) && admin.has(b.capability)) return true;
  const discovery = new Set([
    'product_search',
    'product_search_results',
    'product_filtering',
    'product_details',
    'product_discovery',
  ]);
  if (discovery.has(a.capability) && discovery.has(b.capability)) return true;
  const auth = new Set(['password_reset', 'otp_delivery', 'user_login']);
  if (auth.has(a.capability) && auth.has(b.capability)) return true;
  if (a.capability === 'access_control' && b.capability === 'access_control')
    return true;
  const confirm = new Set(['order_confirmation']);
  if (confirm.has(a.capability) && confirm.has(b.capability)) return true;
  return false;
}
