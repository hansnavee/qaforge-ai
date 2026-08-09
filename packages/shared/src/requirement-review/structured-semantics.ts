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
  profile_email_restriction: 'profile_email_restriction',
  registration_redirect: 'registration_redirect',
  access_control: 'access_control',
  checkout: 'checkout',
  payment: 'payment',
  payment_methods: 'payment_methods',
  payment_processing: 'payment_processing',
  payment_failure: 'payment_failure',
  product_discovery: 'product_discovery',
  product_review: 'product_review',
  browser_compatibility: 'browser_compatibility',
  mobile_usability: 'mobile_usability',
  application_performance: 'application_performance',
  error_messaging: 'error_messaging',
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
    purchase: 'purchase',
    buy: 'purchase',
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
    change: 'update',
    edit: 'update',
    modify: 'update',
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
    navigate: 'navigate',
    redirect: 'navigate',
    manage: 'update',
    access: 'read',
    deny: 'deny',
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

/**
 * Evidence gate: entity/action/capability must be supported by requirement body
 * (description + sourceText). Title alone is never enough — prevents section
 * headings like "Mobile Support" from laundering unrelated account semantics,
 * and blocks LLM inventing user_account/create for pure NFR text.
 */
export function structuredSemanticsCompatibleWithText(
  input: StructuredExtractionInput,
  s: StructuredRequirementSemantics,
): boolean {
  const body = `${input.description}\n${input.sourceText ?? ''}`.toLowerCase();
  const title = (input.title ?? '').toLowerCase();
  const text = `${title}\n${body}`;
  if (!body.trim() && !title.trim()) return false;

  const object = s.object;
  const action = s.action;
  const capability = s.capability;

  // Strong NFR title/section cues without matching body evidence → reject
  // account/CRUD extractions (the Mobile Support ↔ email uniqueness failure mode).
  const titleLooksMobileNfr =
    /\bmobile\b/.test(title) &&
    !/\b(email|account|register|password|order|cart|payment)\b/.test(title);
  const bodySupportsAccount =
    /\b(email|account|register|password|profile|login|sign[\s-]?up)\b/.test(
      body,
    );
  if (
    titleLooksMobileNfr &&
    !bodySupportsAccount &&
    (object === 'user_account' ||
      capability === 'email_uniqueness' ||
      capability === 'user_registration' ||
      action === 'create')
  ) {
    return false;
  }

  // Body is the source of truth for entity/action evidence.
  const evidence = body.trim() ? body : text;

  const objectEvidence: Record<string, RegExp> = {
    user_account:
      /\b(email|account|password|profile|register|registration|login|sign[\s-]?up|user|credentials?|administrative|administrator|admin)\b/,
    password: /\bpasswords?\b/,
    otp: /\botp\b/,
    product: /\bproducts?\b/,
    product_catalog: /\b(products?|catalog|manage)\b/,
    inventory: /\b(inventory|stock)\b/,
    cart_item: /\b(cart|quantity)\b/,
    order: /\borders?\b/,
    order_confirmation: /\b(order confirmation|confirmation)\b/,
    payment: /\bpayment\b/,
    checkout: /\bcheckout\b/,
    search_result: /\b(search result|search)\b/,
    review: /\b(review|rating)\b/,
    application: /\b(application|system|browser|mobile|error|performance)\b/,
  };

  if (object !== 'general') {
    const re = objectEvidence[object];
    if (re && !re.test(evidence)) return false;
  }

  const actionEvidence: Record<string, RegExp> = {
    create: /\b(create|add|register|sign[\s-]?up|submit|associated)\b/,
    update: /\b(update|edit|modify|change|increase|decrease|manage|management)\b/,
    delete: /\b(delete|remove)\b/,
    read: /\b(view|open|display|show|access|see)\b/,
    search: /\b(search|find)\b/,
    filter: /\bfilter\b/,
    purchase: /\b(buy|purchase|purchased)\b/,
    pay: /\b(pay|payment|checkout)\b/,
    login: /\b(login|sign[\s-]?in|credentials?)\b/,
    reset: /\breset\b/,
    store: /\b(store|stored|hash|encrypt|secur)/,
    support: /\b(support|compatible|friendly|responsive|usab|easy|device|mobile|browser)/,
    navigate: /\b(redirect|navigate)/,
    notify: /\b(send|sent|deliver|notify|email)\b/,
    expire: /\b(expire|expiry|expires)\b/,
    verify: /\b(enter|verify|input)\b/,
    select: /\b(select|choose)\b/,
    deny: /\b(prevent|deny|cannot|should not|must not|not be allowed)\b/,
  };

  if (action !== 'unspecified') {
    const re = actionEvidence[action];
    if (re && !re.test(evidence)) {
      // Implicit constraint verbs: uniqueness / NFR support often omit the verb
      const implicitOk =
        (capability === 'email_uniqueness' &&
          action === 'create' &&
          /\bemail\b/.test(evidence) &&
          /\b(unique|only|associated|one account|single account)\b/.test(
            evidence,
          )) ||
        (capability === 'product_administration' &&
          (action === 'update' || action === 'create') &&
          /\bproducts?\b/.test(evidence) &&
          /\b(manage|management|administrators?|admins?)\b/.test(evidence)) ||
        ((capability === 'mobile_usability' ||
          capability === 'browser_compatibility' ||
          capability === 'application_performance' ||
          capability === 'error_messaging') &&
          action === 'support' &&
          /\b(mobile|browser|usab|friendly|compatible|device|responsive|easy|error|performance|second)\b/.test(
            evidence,
          ));
      if (!implicitOk) return false;
    }
  }

  if (capability === 'email_uniqueness') {
    if (!/\bemail\b/.test(evidence)) return false;
    if (!/\b(unique|only|one account|single account|associated)\b/.test(evidence))
      return false;
  }
  if (capability === 'mobile_usability' || capability === 'browser_compatibility') {
    if (
      !/\b(mobile|browser|usab|friendly|compatible|device|responsive|easy)\b/.test(
        evidence,
      )
    ) {
      return false;
    }
  }
  if (capability === 'user_registration') {
    if (!/\b(register|registration|sign[\s-]?up|create an account)\b/.test(evidence))
      return false;
  }

  return true;
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

  // --- High-confidence domain patterns (most-specific first) ---
  if (/out of stock|out-of-stock|cannot be purchased|cannot buy/.test(t)) {
    object = 'product';
    action = 'purchase';
    capability = 'inventory';
    condition = 'OUT_OF_STOCK';
    polarity = 'NOT_ALLOWED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.96;
  } else if (
    /\bemail\b/.test(t) &&
    /\b(change|update|edit|modify)\b/.test(t) &&
    (polarity === 'NOT_ALLOWED' ||
      /\b(cannot|must not|should not|not be allowed)\b/.test(t))
  ) {
    // Implicit object/action: registered email cannot be changed
    object = 'user_account';
    action = 'update';
    capability = 'profile_email_restriction';
    condition = 'REGISTERED_EMAIL_IMMUTABLE';
    polarity = 'NOT_ALLOWED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.94;
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
  } else if (
    /\bpasswords?\b/.test(t) &&
    /\b(store|stored|secur|hash|encrypt)/.test(t) &&
    !/reset|forgot|otp/.test(t)
  ) {
    actor = 'system';
    object = 'password';
    action = 'store';
    capability = 'password_security';
    polarity = polarity === 'UNSPECIFIED' ? 'REQUIRED' : polarity;
    requirementType = 'NON_FUNCTIONAL';
    confidence = 0.94;
  } else if (/password reset|forgot password|reset their password/.test(t)) {
    object = 'user_account';
    action = 'reset';
    capability = 'password_reset';
    confidence = 0.92;
  } else if (
    /\border\b/.test(t) &&
    /\b(another user|other users?|own orders?|access)\b/.test(t) &&
    (polarity === 'NOT_ALLOWED' ||
      /\b(should not|must not|cannot|not be able|not be allowed)\b/.test(t))
  ) {
    object = 'order';
    action = 'read';
    capability = 'order_access';
    polarity = 'NOT_ALLOWED';
    requirementType = 'BUSINESS_RULE';
    confidence = 0.94;
  } else if (
    /\bprofile\b/.test(t) &&
    /\b(update|edit|modify|change)\b/.test(t) &&
    !/\bemail\b/.test(t)
  ) {
    object = 'user_account';
    action = 'update';
    capability = 'profile_update';
    confidence = 0.9;
  } else if (
    /\bquantity\b/.test(t) &&
    /\b(increase|decrease|modify|change|update)\b/.test(t)
  ) {
    object = 'cart_item';
    action = 'update';
    capability = 'shopping_cart';
    confidence = 0.9;
  } else if (
    /\bredirect\b/.test(t) &&
    /\b(registration|register|login|sign in)\b/.test(t)
  ) {
    object = 'user_account';
    action = 'navigate';
    capability = 'registration_redirect';
    confidence = 0.93;
  } else if (/\b(register|registration|sign up|create an account)\b/.test(t)) {
    object = 'user_account';
    action = 'create';
    capability = 'user_registration';
    confidence = 0.93;
  } else if (
    (/\b(login|sign[\s-]?in)\b/.test(t) ||
      /\b(invalid )?credentials?\b/.test(t) ||
      /\binvalid login\b/.test(t)) &&
    !/\b(register|registration|sign up|create an account)\b/.test(t)
  ) {
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
    /\beach order\b/.test(t) ||
    (/\border\b/.test(t) &&
      /\b(display|show|contain|include)\b/.test(t) &&
      !/confirmation|checkout|payment/.test(t))
  ) {
    object = 'order';
    action = 'read';
    capability = 'order_details';
    confidence = 0.91;
  } else if (
    (/\b(administrators?|admins?)\b/.test(t) ||
      /\bonly administrators?\b/.test(t)) &&
    /\bproducts?\b/.test(t) &&
    !/cart/.test(t)
  ) {
    // Admin catalog/inventory before generic "product details"
    object = /inventory|stock/.test(t) ? 'inventory' : 'product_catalog';
    action = /remove|delete/.test(t)
      ? 'delete'
      : /add|create|new/.test(t)
        ? 'create'
        : /update|edit|modify|inventory|manage|management/.test(t)
          ? 'update'
          : 'update';
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
    if (/fail|failure|failed/.test(t)) {
      capability = 'payment_failure';
      condition = 'PAYMENT_FAILED';
      requirementType = /must not|cannot|should not|not create/.test(t)
        ? 'BUSINESS_RULE'
        : 'FUNCTIONAL';
    } else if (/method|credit card|debit card/.test(t)) {
      capability = 'payment_methods';
    } else if (/process/.test(t)) {
      capability = 'payment_processing';
    } else {
      capability = 'payment';
    }
    confidence = 0.9;
  } else if (
    /administrative functionality|administrator permissions|admin(istrator)? access|have access to administrative|normal users? should not/.test(
      t,
    ) ||
    (/\b(prevent|must not|should not|cannot)\b/.test(t) &&
      /\b(normal users?|non-?admin|customers?)\b/.test(t) &&
      /\b(product management|admin|administrator|administrative)\b/.test(t)) ||
    (/\badministrators?\b/.test(t) &&
      /\b(access|permissions?|functionality)\b/.test(t) &&
      !/\bproducts?\b/.test(t))
  ) {
    object = /product management|inventory|catalog/.test(t)
      ? 'product_catalog'
      : 'user_account';
    action = /not|cannot|prevent|denied/.test(t) ? 'deny' : 'read';
    capability = 'access_control';
    polarity =
      /not|cannot|prevent|denied/.test(t) ? 'NOT_ALLOWED' : polarity;
    requirementType = 'BUSINESS_RULE';
    confidence = 0.92;
  } else if (/\breview\b|\brating\b/.test(t) && !/code review|review status/.test(t)) {
    object = 'review';
    action = 'create';
    capability = 'product_review';
    confidence = 0.9;
  } else if (/modern browsers?|browser compat/.test(t)) {
    object = 'application';
    action = 'support';
    capability = 'browser_compatibility';
    requirementType = 'NON_FUNCTIONAL';
    confidence = 0.92;
  } else if (
    /\bmobile\b/.test(t) &&
    /usab|friendly|responsive|easy|support|device/.test(t)
  ) {
    object = 'application';
    action = 'support';
    capability = 'mobile_usability';
    requirementType = 'NON_FUNCTIONAL';
    confidence = 0.92;
  } else if (
    /respond within|within\s+\d+\s+seconds?|performance|fast|quickly/.test(t) &&
    /application|search|checkout|page|load/.test(t)
  ) {
    object = 'application';
    action = 'support';
    capability = 'application_performance';
    requirementType = 'NON_FUNCTIONAL';
    confidence = 0.9;
  } else if (
    /error message|clear error|display.*error/.test(t) &&
    !/\b(login|sign[\s-]?in|credentials?)\b/.test(t)
  ) {
    // Generic error UX — login/credential errors stay on user_account above
    object = 'application';
    action = 'display';
    capability = 'error_messaging';
    requirementType = 'NON_FUNCTIONAL';
    confidence = 0.9;
  } else if (input.type?.toUpperCase().includes('BUSINESS')) {
    requirementType = 'BUSINESS_RULE';
    confidence = 0.7;
  }

  // Secondary pass: recover implicit object/action when still unspecified
  if (object === 'general' || action === 'unspecified') {
    const recovered = recoverImplicitObjectAction(t, polarity);
    if (object === 'general' && recovered.object !== 'general') {
      object = recovered.object;
      confidence = Math.max(confidence, 0.86);
    }
    if (action === 'unspecified' && recovered.action !== 'unspecified') {
      action = recovered.action;
      confidence = Math.max(confidence, 0.86);
    }
    if (
      capability === 'general' &&
      recovered.capability !== 'general'
    ) {
      capability = recovered.capability;
    }
    if (recovered.requirementType) {
      requirementType = recovered.requirementType;
    }
    if (recovered.condition) condition = recovered.condition;
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

/**
 * Recover object/action from clear verbs + nouns when primary patterns miss.
 * Hierarchy: noun object + verb action — not keyword-family guesswork.
 */
function recoverImplicitObjectAction(
  t: string,
  polarity: StructuredPolarity,
): {
  object: string;
  action: string;
  capability: string;
  condition: string | null;
  requirementType?: StructuredRequirementType;
} {
  let object = 'general';
  let action = 'unspecified';
  let capability = 'general';
  let condition: string | null = null;
  let requirementType: StructuredRequirementType | undefined;

  if (/\bpasswords?\b/.test(t) && /\b(store|stored|secur|hash|encrypt)/.test(t)) {
    object = 'password';
  } else if (
    /\b(email|credentials?|login|sign[\s-]?in|profile|account)\b/.test(t) ||
    /\badministrative (functionality|permissions?|access)\b/.test(t)
  ) {
    object = 'user_account';
  } else if (/\bpasswords?\b/.test(t)) object = 'user_account';
  else if (/\botp\b/.test(t)) object = 'otp';
  else if (/\bcart\b/.test(t) || /\bquantity\b/.test(t)) object = 'cart_item';
  else if (/\border\b/.test(t)) object = 'order';
  else if (
    /\bproducts?\b/.test(t) &&
    /\b(administrators?|admins?|manage|management)\b/.test(t)
  ) {
    object = 'product_catalog';
  } else if (/\bproduct\b/.test(t)) object = 'product';
  else if (/\bpayment\b/.test(t)) object = 'payment';
  else if (/\bprofile\b/.test(t)) object = 'user_account';

  if (/\b(store|stored|hash|encrypt|secur)/.test(t) && /\bpasswords?\b/.test(t)) {
    action = 'store';
  } else if (/\b(login|sign[\s-]?in|credentials?)\b/.test(t)) {
    action = 'login';
  } else if (/\b(manage|management)\b/.test(t) && object === 'product_catalog') {
    action = 'update';
  } else if (/\b(change|update|edit|modify|increase|decrease)\b/.test(t)) {
    action = 'update';
  } else if (/\b(create|add|register)\b/.test(t)) action = 'create';
  else if (/\b(delete|remove)\b/.test(t)) action = 'delete';
  else if (/\b(view|open|display|show|access)\b/.test(t)) action = 'read';
  else if (/\b(buy|purchase|pay)\b/.test(t)) action = 'purchase';
  else if (/\b(search|find)\b/.test(t)) action = 'search';

  if (
    object === 'user_account' &&
    action === 'update' &&
    /\bemail\b/.test(t) &&
    polarity === 'NOT_ALLOWED'
  ) {
    capability = 'profile_email_restriction';
    condition = 'REGISTERED_EMAIL_IMMUTABLE';
    requirementType = 'BUSINESS_RULE';
  } else if (object === 'password' && action === 'store') {
    capability = 'password_security';
    requirementType = 'NON_FUNCTIONAL';
  } else if (
    object === 'order' &&
    /\b(another user|other users?|own orders?)\b/.test(t) &&
    polarity === 'NOT_ALLOWED'
  ) {
    action = action === 'unspecified' ? 'read' : action;
    capability = 'order_access';
    requirementType = 'BUSINESS_RULE';
  } else if (object === 'cart_item' && action === 'update') {
    capability = 'shopping_cart';
  } else if (object === 'user_account' && action === 'update' && /\bprofile\b/.test(t)) {
    capability = 'profile_update';
  } else if (object === 'user_account' && action === 'login') {
    capability = 'user_login';
  } else if (
    object === 'user_account' &&
    /\b(administrative|administrator permissions|admin)\b/.test(t)
  ) {
    capability = 'access_control';
    if (action === 'unspecified') {
      action = /not|cannot|prevent|denied/.test(t) ? 'deny' : 'read';
    }
  } else if (object === 'product_catalog') {
    capability = 'product_administration';
  }

  return { object, action, capability, condition, requirementType };
}

/** Prefer concrete heuristic entity/action/capability over LLM placeholders. */
function fillPlaceholdersFromHeuristic(
  primary: StructuredRequirementSemantics,
  heuristic: StructuredRequirementSemantics,
): StructuredRequirementSemantics {
  return {
    ...primary,
    actor:
      primary.actor && primary.actor !== 'unspecified'
        ? primary.actor
        : heuristic.actor,
    object:
      primary.object && primary.object !== 'general'
        ? primary.object
        : heuristic.object,
    action:
      primary.action && primary.action !== 'unspecified'
        ? primary.action
        : heuristic.action,
    capability:
      primary.capability && primary.capability !== 'general'
        ? primary.capability
        : heuristic.capability,
    condition: primary.condition ?? heuristic.condition,
    polarity:
      primary.polarity !== 'UNSPECIFIED' ? primary.polarity : heuristic.polarity,
    requirementType: primary.requirementType || heuristic.requirementType,
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
  const llmOk =
    !!llm &&
    acceptStructuredSemantics(llm) &&
    structuredSemanticsCompatibleWithText(input, llm);
  if (llmOk && llm) {
    // Never keep LLM "general"/"unspecified" when heuristic mapped a domain entity
    const filled = fillPlaceholdersFromHeuristic(
      {
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
      },
      heuristic,
    );
    if (structuredSemanticsCompatibleWithText(input, filled)) {
      return {
        ...filled,
        source:
          filled.object !== llm.object ||
          filled.action !== llm.action ||
          filled.capability !== llm.capability
            ? 'merged'
            : 'llm',
        confidence: Math.max(filled.confidence, heuristic.confidence),
      };
    }
  }
  if (llm && !llm.uncertain && llm.confidence >= 0.7) {
    // Partial trust — merge only fields that are text-compatible
    const merged = fillPlaceholdersFromHeuristic(
      {
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
      },
      heuristic,
    );
    if (structuredSemanticsCompatibleWithText(input, merged)) {
      return merged;
    }
    // Incompatible merge — fall through to validated heuristic
  }
  if (!structuredSemanticsCompatibleWithText(input, heuristic)) {
    return {
      ...heuristic,
      object: 'general',
      action: 'unspecified',
      capability: 'general',
      confidence: Math.min(heuristic.confidence, 0.7),
      uncertain: true,
      source: heuristic.source,
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
