/**
 * Structured semantic extraction for Step 2.
 * LLM (or heuristic fallback) produces this shape; deterministic engines consume it.
 */

export const STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT = 0.85;

export type StructuredPolarity =
  | 'ALLOWED'
  | 'NOT_ALLOWED'
  | 'REQUIRED'
  | 'UNSPECIFIED';

export type StructuredRequirementType =
  | 'FUNCTIONAL'
  | 'BUSINESS_RULE'
  | 'NON_FUNCTIONAL';

/**
 * Canonical LLM-facing structured requirement (uppercase enums).
 * Mapped into internal NormalizedRequirement keys before relationship detection.
 */
export type StructuredRequirementSemantics = {
  actor: string;
  action: string;
  object: string;
  condition: string | null;
  polarity: StructuredPolarity;
  requirementType: StructuredRequirementType;
  capability: string;
  confidence: number;
  /** Set when confidence < accept threshold or parse/heuristic uncertain */
  uncertain?: boolean;
  source?: 'llm' | 'heuristic' | 'merged';
};

export type StructuredExtractionInput = {
  requirementKey: string;
  title: string;
  description: string;
  sourceText?: string | null;
  type?: string | null;
};

/** Map free-form / LLM capability tokens → internal snake_case capabilities. */
const CAPABILITY_ALIASES: Record<string, string> = {
  product_purchase: 'inventory',
  purchase: 'shopping_cart',
  buy: 'shopping_cart',
  add_to_cart: 'shopping_cart',
  shopping_cart: 'shopping_cart',
  cart: 'shopping_cart',
  order_details: 'order_details',
  order_detail: 'order_details',
  view_order: 'order_details',
  open_order: 'order_details',
  order_history: 'order_history',
  order_access: 'order_access',
  order_confirmation: 'order_confirmation',
  product_search: 'product_search',
  search: 'product_search',
  product_search_results: 'product_search_results',
  search_results: 'product_search_results',
  product_filtering: 'product_filtering',
  product_filter: 'product_filtering',
  filter: 'product_filtering',
  product_details: 'product_details',
  product_administration: 'product_administration',
  inventory: 'inventory',
  inventory_update: 'inventory_update',
  out_of_stock: 'inventory',
  stock_rule: 'inventory',
  user_registration: 'user_registration',
  registration: 'user_registration',
  account_creation: 'user_registration',
  user_login: 'user_login',
  login: 'user_login',
  password_reset: 'password_reset',
  otp_delivery: 'otp_delivery',
  otp_expiration: 'otp_expiration',
  otp_entry: 'otp_entry',
  email_uniqueness: 'email_uniqueness',
  unique_email: 'email_uniqueness',
  access_control: 'access_control',
  checkout: 'checkout',
  payment: 'payment',
  product_discovery: 'product_discovery',
};

const ACTOR_ALIASES: Record<string, string> = {
  customer: 'customer',
  user: 'customer',
  users: 'customer',
  buyer: 'customer',
  shopper: 'customer',
  guest: 'guest',
  administrator: 'administrator',
  admin: 'administrator',
  manager: 'administrator',
  system: 'system',
  payment_gateway: 'payment_gateway',
  unspecified: 'unspecified',
};

const OBJECT_ALIASES: Record<string, string> = {
  product: 'product',
  products: 'product',
  order: 'order',
  orders: 'order',
  cart: 'cart_item',
  cart_item: 'cart_item',
  account: 'user_account',
  user_account: 'user_account',
  email: 'user_account',
  otp: 'otp',
  password: 'user_account',
  payment: 'payment',
  checkout: 'checkout',
  inventory: 'inventory',
  product_catalog: 'product_catalog',
  search_result: 'search_result',
  review: 'review',
  general: 'general',
};

function normToken(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function toSnake(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function canonicalizeCapability(raw: string): string {
  const key = toSnake(raw);
  return CAPABILITY_ALIASES[key] ?? key;
}

export function canonicalizeActor(raw: string): string {
  const key = toSnake(raw);
  return ACTOR_ALIASES[key] ?? (key || 'unspecified');
}

export function canonicalizeObject(raw: string): string {
  const key = toSnake(raw);
  return OBJECT_ALIASES[key] ?? (key || 'general');
}

export function canonicalizeAction(raw: string): string {
  const key = toSnake(raw);
  const map: Record<string, string> = {
    purchase: 'pay',
    buy: 'pay',
    view: 'read',
    open: 'read',
    display: 'read',
    show: 'read',
    search: 'search',
    filter: 'filter',
    create: 'create',
    register: 'create',
    add: 'create',
    update: 'update',
    edit: 'update',
    delete: 'delete',
    remove: 'delete',
    expire: 'expire',
    notify: 'notify',
    login: 'login',
    pay: 'pay',
    add_to: 'add_to',
    reset: 'reset',
    verify: 'verify',
    select: 'select',
  };
  return map[key] ?? (key || 'unspecified');
}

export function canonicalizePolarity(raw: unknown): StructuredPolarity {
  const t = normToken(raw);
  if (
    t.includes('NOT_ALLOWED') ||
    t.includes('DENIED') ||
    t.includes('FORBIDDEN') ||
    t === 'NEGATIVE'
  ) {
    return 'NOT_ALLOWED';
  }
  if (t.includes('REQUIRED') || t.includes('MUST')) return 'REQUIRED';
  if (t.includes('ALLOWED') || t.includes('CAN') || t === 'POSITIVE')
    return 'ALLOWED';
  return 'UNSPECIFIED';
}

export function canonicalizeRequirementType(
  raw: unknown,
): StructuredRequirementType {
  const t = normToken(raw);
  if (t.includes('BUSINESS')) return 'BUSINESS_RULE';
  if (t.includes('NON')) return 'NON_FUNCTIONAL';
  return 'FUNCTIONAL';
}

export function acceptStructuredSemantics(
  s: StructuredRequirementSemantics | null | undefined,
): boolean {
  return (
    !!s &&
    typeof s.confidence === 'number' &&
    s.confidence >= STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT &&
    !s.uncertain
  );
}

/** Normalize a raw LLM/heuristic object into StructuredRequirementSemantics. */
export function coerceStructuredSemantics(
  raw: Record<string, unknown>,
  opts?: { source?: StructuredRequirementSemantics['source'] },
): StructuredRequirementSemantics {
  const confidence = Math.max(
    0,
    Math.min(1, Number(raw.confidence ?? 0.5) || 0.5),
  );
  const uncertain =
    raw.uncertain === true || confidence < STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT;
  const condition = raw.condition ? normToken(raw.condition) : null;
  const polarity = canonicalizePolarity(raw.polarity);
  let capability = canonicalizeCapability(String(raw.capability ?? 'general'));
  // Out-of-stock purchase bans are inventory business rules, not cart features.
  if (
    polarity === 'NOT_ALLOWED' &&
    (condition === 'OUT_OF_STOCK' ||
      capability === 'inventory' ||
      capability === 'product_purchase')
  ) {
    capability = 'inventory';
  }
  return {
    actor: canonicalizeActor(String(raw.actor ?? 'UNSPECIFIED')),
    action: canonicalizeAction(String(raw.action ?? 'UNSPECIFIED')),
    object: canonicalizeObject(String(raw.object ?? 'GENERAL')),
    condition,
    polarity,
    requirementType: canonicalizeRequirementType(
      raw.requirementType ?? raw.type,
    ),
    capability,
    confidence,
    uncertain,
    source: opts?.source ?? 'merged',
  };
}

/**
 * Deterministic structured extraction — used offline, as LLM fallback,
 * and when LLM confidence is below threshold.
 */
export function extractStructuredSemanticsHeuristic(
  input: StructuredExtractionInput,
): StructuredRequirementSemantics {
  const text = `${input.title}\n${input.description}\n${input.sourceText ?? ''}`;
  const t = text.toLowerCase();

  let actor = 'customer';
  if (/\b(administrators?|admins?|managers?)\b/.test(t)) actor = 'administrator';
  else if (/\b(system)\b/.test(t) && /\b(expire|send|notify|create order)\b/.test(t))
    actor = 'system';
  else if (/\b(guests?|anonymous)\b/.test(t)) actor = 'guest';

  let polarity: StructuredPolarity = 'UNSPECIFIED';
  if (/\b(cannot|must not|should not|not be allowed|forbidden|denied)\b/.test(t)) {
    polarity = 'NOT_ALLOWED';
  } else if (/\b(must|required|shall)\b/.test(t)) {
    polarity = 'REQUIRED';
  } else if (/\b(can|able to|should be able|may)\b/.test(t)) {
    polarity = 'ALLOWED';
  }

  let object = 'general';
  let action = 'unspecified';
  let capability = 'general';
  let condition: string | null = null;
  let requirementType: StructuredRequirementType = 'FUNCTIONAL';
  let confidence = 0.72;

  // --- High-confidence domain patterns ---
  if (/out of stock|out-of-stock|cannot be purchased/.test(t)) {
    object = 'product';
    action = 'pay';
    capability = 'inventory';
    condition = 'OUT_OF_STOCK';
    polarity = 'NOT_ALLOWED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.96;
  } else if (/unique/.test(t) && /email/.test(t)) {
    object = 'user_account';
    action = 'create';
    capability = 'email_uniqueness';
    condition = 'EMAIL_UNIQUE';
    polarity = 'REQUIRED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.95;
  } else if (/email/.test(t) && /only.*(one|single).*account|one account/.test(t)) {
    object = 'user_account';
    action = 'create';
    capability = 'email_uniqueness';
    condition = 'ONE_ACCOUNT_PER_EMAIL';
    polarity = 'REQUIRED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.95;
  } else if (/\botp\b/.test(t) && /expire|expiry|minutes/.test(t)) {
    actor = 'system';
    object = 'otp';
    action = 'expire';
    capability = 'otp_expiration';
    condition = /minutes/.test(t) ? 'TIME_LIMIT' : 'OTP_EXPIRY';
    requirementType = 'BUSINESS_RULE';
    polarity = 'REQUIRED';
    confidence = 0.94;
  } else if (/\botp\b/.test(t) && /sent|send|email|deliver/.test(t)) {
    actor = 'system';
    object = 'otp';
    action = 'notify';
    capability = 'otp_delivery';
    confidence = 0.92;
  } else if (/\botp\b/.test(t) && /enter|input/.test(t)) {
    object = 'otp';
    action = 'verify';
    capability = 'otp_entry';
    confidence = 0.9;
  } else if (/password reset|forgot password|reset their password/.test(t)) {
    object = 'user_account';
    action = 'reset';
    capability = 'password_reset';
    confidence = 0.92;
  } else if (/\b(register|registration|sign up|create an account)\b/.test(t)) {
    object = 'user_account';
    action = 'create';
    capability = 'user_registration';
    confidence = 0.93;
  } else if (/\b(login|sign in)\b/.test(t) && !/\bregister/.test(t)) {
    object = 'user_account';
    action = 'login';
    capability = 'user_login';
    confidence = 0.93;
  } else if (
    /open (an? )?order|view (an? )?order|order details?/.test(t) &&
    !/confirmation|product search|search product/.test(t)
  ) {
    object = 'order';
    action = 'read';
    capability = 'order_details';
    confidence = 0.95;
  } else if (/order history|previous orders|past orders/.test(t)) {
    object = 'order';
    action = 'read';
    capability = 'order_history';
    confidence = 0.93;
  } else if (
    /\b(administrators?|admins?)\b/.test(t) &&
    /product/.test(t) &&
    !/cart/.test(t)
  ) {
    // Admin catalog/inventory before generic "product details"
    object = /inventory|stock/.test(t) ? 'inventory' : 'product_catalog';
    action = /remove|delete/.test(t)
      ? 'delete'
      : /update|edit|modify|inventory/.test(t)
        ? 'update'
        : 'create';
    capability = /inventory|stock/.test(t)
      ? 'inventory_update'
      : 'product_administration';
    confidence = 0.92;
  } else if (/search result/.test(t)) {
    object = 'search_result';
    action = 'select';
    capability = 'product_search_results';
    confidence = 0.92;
  } else if (/\bfilter\b/.test(t) && /product/.test(t)) {
    object = 'product';
    action = 'filter';
    capability = 'product_filtering';
    confidence = 0.91;
  } else if (/\bsearch\b/.test(t) && /product/.test(t)) {
    object = 'product';
    action = 'search';
    capability = 'product_search';
    confidence = 0.93;
  } else if (/product detail|view product/.test(t)) {
    object = 'product';
    action = 'read';
    capability = 'product_details';
    confidence = 0.9;
  } else if (/add .*cart|add to cart|to their cart/.test(t)) {
    object = 'cart_item';
    action = 'add_to';
    capability = 'shopping_cart';
    confidence = 0.94;
  } else if (/order confirmation/.test(t) || /confirmation email/.test(t)) {
    object = 'order_confirmation';
    action = /email/.test(t) ? 'notify' : 'read';
    capability = 'order_confirmation';
    confidence = 0.9;
  } else if (/\bcheckout\b/.test(t)) {
    object = 'checkout';
    action = 'pay';
    capability = 'checkout';
    confidence = 0.9;
  } else if (/\bpayment\b/.test(t)) {
    object = 'payment';
    action = 'pay';
    capability = 'payment';
    confidence = 0.9;
  } else if (
    /administrative functionality|administrator permissions|normal users? should not/.test(
      t,
    )
  ) {
    object = 'user_account';
    action = 'read';
    capability = 'access_control';
    confidence = 0.9;
  } else if (input.type?.toUpperCase().includes('BUSINESS')) {
    requirementType = 'BUSINESS_RULE';
    confidence = 0.7;
  }

  if (polarity === 'NOT_ALLOWED' && requirementType === 'FUNCTIONAL') {
    requirementType = 'BUSINESS_RULE';
  }

  return {
    actor,
    action,
    object,
    condition,
    polarity,
    requirementType,
    capability,
    confidence,
    uncertain: confidence < STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT,
    source: 'heuristic',
  };
}

export function parseStructuredSemanticsBatch(
  payload: unknown,
): Map<string, StructuredRequirementSemantics> {
  const out = new Map<string, StructuredRequirementSemantics>();
  const root = payload as { requirements?: unknown[] };
  const list = Array.isArray(root?.requirements)
    ? root.requirements
    : Array.isArray(payload)
      ? payload
      : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const key = String(row.requirementKey ?? row.id ?? '').trim();
    if (!key) continue;
    out.set(
      key,
      coerceStructuredSemantics(row, { source: 'llm' }),
    );
  }
  return out;
}

/**
 * Prefer accepted LLM structure; otherwise heuristic.
 * If LLM present but low confidence, mark uncertain and keep heuristic capability
 * only when LLM capability is empty/general.
 */
export function resolveStructuredSemantics(
  input: StructuredExtractionInput,
  llm?: StructuredRequirementSemantics | null,
): StructuredRequirementSemantics {
  const heuristic = extractStructuredSemanticsHeuristic(input);
  if (llm && acceptStructuredSemantics(llm)) {
    return {
      actor: llm.actor,
      action: llm.action,
      object: llm.object,
      condition: llm.condition,
      polarity: llm.polarity,
      requirementType: llm.requirementType,
      capability: llm.capability,
      confidence: llm.confidence,
      uncertain: false,
      source: 'llm',
    };
  }
  if (llm && !llm.uncertain && llm.confidence >= 0.7) {
    // Partial trust — merge object/action when heuristic is weaker
    return {
      ...heuristic,
      actor: llm.actor || heuristic.actor,
      action: llm.action !== 'unspecified' ? llm.action : heuristic.action,
      object: llm.object !== 'general' ? llm.object : heuristic.object,
      condition: llm.condition ?? heuristic.condition,
      polarity:
        llm.polarity !== 'UNSPECIFIED' ? llm.polarity : heuristic.polarity,
      capability:
        llm.capability && llm.capability !== 'general'
          ? llm.capability
          : heuristic.capability,
      requirementType: llm.requirementType || heuristic.requirementType,
      confidence: Math.max(heuristic.confidence, llm.confidence * 0.9),
      uncertain: true,
      source: 'merged',
    };
  }
  return heuristic;
}

export const STRUCTURED_SEMANTIC_SYSTEM_PROMPT = `You extract structured business semantics from software requirements for a QA analysis engine.
Return ONLY valid JSON. Do not invent requirements that are not present.
For each requirement identify:
- actor (CUSTOMER|ADMINISTRATOR|SYSTEM|GUEST|PAYMENT_GATEWAY|UNSPECIFIED)
- action (verb: PURCHASE|VIEW|SEARCH|CREATE|UPDATE|DELETE|LOGIN|EXPIRE|NOTIFY|FILTER|PAY|RESET|VERIFY|...)
- object (PRODUCT|ORDER|CART|ACCOUNT|OTP|PAYMENT|CHECKOUT|INVENTORY|...)
- condition (nullable business condition e.g. OUT_OF_STOCK, AFTER_10_MINUTES, EMAIL_UNIQUE)
- polarity (ALLOWED|NOT_ALLOWED|REQUIRED|UNSPECIFIED)
- requirementType (FUNCTIONAL|BUSINESS_RULE|NON_FUNCTIONAL)
- capability (stable business capability key e.g. ORDER_DETAILS, PRODUCT_SEARCH, USER_REGISTRATION, OTP_EXPIRATION, PRODUCT_PURCHASE, EMAIL_UNIQUENESS)
- confidence (0..1) for THIS extraction only — be honest; use <0.85 when ambiguous

Rules:
- "open an order to view its details" → object=ORDER, capability=ORDER_DETAILS (NOT product details)
- "out-of-stock cannot be purchased" → BUSINESS_RULE, polarity=NOT_ALLOWED, condition=OUT_OF_STOCK, capability=PRODUCT_PURCHASE or INVENTORY
- "OTP expires" → actor=SYSTEM, object=OTP, capability=OTP_EXPIRATION, BUSINESS_RULE
- Do not use shared words like "user" alone to invent relationships.`;
