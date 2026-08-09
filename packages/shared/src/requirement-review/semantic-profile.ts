/**
 * Generic semantic fingerprint for a requirement.
 * Domain-agnostic: works across e-commerce, CRM, banking, healthcare, etc.
 */

export type CrudOp = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';

export type SemanticProfile = {
  actor: string;
  entity: string;
  action: string;
  capability: string;
  outcome: string;
  channel: string | null;
  context: string | null;
  crudOp: CrudOp | null;
  preconditions: string[];
};

export type SemanticComparable = {
  requirementKey: string;
  title: string;
  description: string;
  sourceText?: string | null;
  featureName?: string | null;
  businessArea?: string | null;
};

function textOf(r: SemanticComparable): string {
  return `${r.title}\n${r.description}\n${r.sourceText ?? ''}`.toLowerCase();
}

/** Normalize actor labels to stable keys. */
export function extractActor(text: string): string {
  const t = text.toLowerCase();
  // Denied/non-admin actors must win before the word "administrator" is matched.
  if (
    /\b(normal|regular|standard|non[- ]admin) users?\b/.test(t) ||
    (/\b(should not|must not|cannot|not have|not be allowed)\b/.test(t) &&
      /\b(administrator|admin) (permissions?|access|functionality)\b/.test(t))
  ) {
    return 'customer';
  }
  if (/\b(administrators?|admins?|managers?)\b/.test(t)) return 'administrator';
  if (/\b(payment gateway|payment provider)\b/.test(t)) return 'payment_gateway';
  if (/\b(external service|third[- ]party)\b/.test(t)) return 'external_service';
  if (/\b(guests?|anonymous)\b/.test(t)) return 'guest';
  if (/\b(system)\b/.test(t) && !/\b(users?|customers?)\b/.test(t))
    return 'system';
  if (/\b(registered users?)\b/.test(t)) return 'registered_user';
  if (/\b(customers?|users?|buyers?|shoppers?|patients?|employees?|students?)\b/.test(
    t,
  ))
    return 'customer';
  return 'unspecified';
}

/**
 * Entity extraction — more specific phrases win.
 * Distinguishes catalog product vs cart item vs inventory, etc.
 */
export function extractEntity(text: string): string {
  const t = text.toLowerCase();
  if (
    /shopping cart|cart item|add .* to (the )?cart|add product to cart|to their cart|to the cart|\bcart\b/.test(
      t,
    )
  )
    return 'cart_item';
  if (/search result/.test(t)) return 'search_result';
  if (
    /product catalog|catalog product|new products?\b|manage products?|add product(?! to cart)|remove product|delete product|update product(?! inventory)/.test(
      t,
    ) && /\b(administrators?|admins?|managers?)\b/.test(t)
  )
    return 'product_catalog';
  if (/inventory|stock level|stock quantity|out of stock|out-of-stock/.test(t))
    return 'inventory';
  if (
    /order confirmation|confirmation (page|screen|email)|confirmation email|purchased products?/.test(
      t,
    )
  )
    return 'order_confirmation';
  // Order entity before generic "view details" / product phrasing
  if (
    /open (an? )?order|view (an? )?order|order (details?|history|page)|view (previous|past|its) orders?|each order should|previous orders|past orders/.test(
      t,
    )
  )
    return 'order';
  if (/order item|line item/.test(t)) return 'order_item';
  if (/\borders?\b/.test(t) && !/\bproducts?\b/.test(t)) return 'order';
  if (/\bpayment\b|pay for|checkout payment/.test(t)) return 'payment';
  if (
    /user account|user profile|email address|password|\botp\b|credential/.test(t)
  )
    return 'user_account';
  if (/\breview\b|rating/.test(t)) return 'review';
  if (/\bcheckout\b/.test(t)) return 'checkout';
  if (/\bproducts?\b/.test(t)) {
    if (/\b(administrators?|admins?|managers?)\b/.test(t)) return 'product_catalog';
    return 'product';
  }
  if (/\b(account|profile)\b/.test(t)) return 'user_account';
  return 'general';
}

const ACTION_ALIASES: Array<{ key: string; patterns: RegExp[]; crud?: CrudOp }> =
  [
    {
      key: 'add_to',
      patterns: [
        /add .* to (the )?(cart|basket)/,
        /add product to cart/,
        /add to cart/,
        /to their cart/,
      ],
      crud: 'CREATE',
    },
    {
      key: 'create',
      patterns: [
        /\bcreate\b/,
        /\badd new\b/,
        /add (a )?new product/,
        /administrators?.*\badd\b/,
        /admins?.*\badd\b/,
        /\badd product\b(?! to cart)/,
        /\bregister\b/,
        /\bsign up\b/,
      ],
      crud: 'CREATE',
    },
    {
      key: 'select',
      patterns: [/\bselect\b/, /choose (a )?product/, /from search results/],
      crud: 'READ',
    },
    {
      key: 'delete',
      patterns: [/\bdelete\b/, /\bremove\b/, /\bcancel\b(?!lation)/],
      crud: 'DELETE',
    },
    {
      key: 'update',
      patterns: [/\bupdate\b/, /\bedit\b/, /\bmodify\b/, /\bchange\b/],
      crud: 'UPDATE',
    },
    {
      key: 'read',
      patterns: [
        /\bview\b/,
        /\bread\b/,
        /\bdisplay\b/,
        /\bshow\b/,
        /\bsee\b/,
        /confirmation page/,
        /confirmation screen/,
      ],
      crud: 'READ',
    },
    {
      key: 'filter',
      patterns: [/\bfilter\b/, /by category/, /by price/],
      crud: 'READ',
    },
    {
      key: 'search',
      patterns: [/\bsearch\b/, /\bfind\b/],
      crud: 'READ',
    },
    {
      key: 'pay',
      patterns: [/\bpay\b/, /\bpayment\b/, /\bpurchase\b/, /\bcheckout\b/],
    },
    {
      key: 'reset',
      patterns: [/\breset\b/, /forgot password/, /password reset/],
    },
    {
      key: 'notify',
      patterns: [
        /otp will be sent/,
        /otp .* sent/,
        /send(s|ing)? (an? )?otp/,
        /confirmation email/,
        /send.*email/,
        /notification/,
        /\bsms\b/,
      ],
    },
    {
      key: 'verify',
      patterns: [/\bverify\b/, /\bvalidate\b/, /\bauthenticate\b/],
    },
    {
      key: 'login',
      patterns: [/\blogin\b/, /\bsign in\b/],
    },
    {
      key: 'approve',
      patterns: [/\bapprove\b/, /\breject\b/],
    },
    {
      key: 'refund',
      patterns: [/\brefund\b/],
    },
  ];

export function extractAction(text: string): {
  action: string;
  crudOp: CrudOp | null;
} {
  const t = text.toLowerCase();
  for (const a of ACTION_ALIASES) {
    if (a.patterns.some((p) => p.test(t))) {
      return { action: a.key, crudOp: a.crud ?? null };
    }
  }
  // bare "add" without cart → create
  if (/\badd\b/.test(t)) return { action: 'create', crudOp: 'CREATE' };
  return { action: 'unspecified', crudOp: null };
}

export function extractChannel(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bemail\b|\binbox\b/.test(t)) return 'email';
  if (/\bsms\b|text message/.test(t)) return 'sms';
  if (/\b(page|screen|ui|web|browser)\b/.test(t)) return 'web';
  if (/\bapi\b|webhook/.test(t)) return 'api';
  return null;
}

/**
 * Business capability — derived from entity/action/feature, not journey order.
 */
export function extractCapability(
  text: string,
  entity: string,
  featureName?: string | null,
  businessArea?: string | null,
): string {
  if (featureName) {
    return featureName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  if (businessArea) {
    return businessArea
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }
  const t = text.toLowerCase();
  if (entity === 'cart_item' || /shopping cart|add to cart/.test(t))
    return 'shopping_cart';
  if (entity === 'inventory' || /inventory|stock/.test(t)) return 'inventory';
  if (entity === 'product_catalog' || /administrators?.*product/.test(t))
    return 'product_administration';
  if (entity === 'order_confirmation' || /order confirmation/.test(t))
    return 'order_confirmation';
  if (entity === 'order') {
    if (/history|past orders|previous orders|my orders/.test(t))
      return 'order_history';
    if (/access|another user|own orders?/.test(t)) return 'order_access';
    return 'order_details';
  }
  if (entity === 'payment' || /\bpayment\b/.test(t)) return 'payment';
  if (entity === 'checkout' || /\bcheckout\b/.test(t)) return 'checkout';
  if (/password reset|forgot password|reset their password/.test(t))
    return 'password_reset';
  if (/\botp\b/.test(t) && /sent|send|email|sms|deliver/.test(t))
    return 'otp_delivery';
  if (/\botp\b/.test(t)) return 'password_reset';
  if (/\b(register|registration|sign up|create an account)\b/.test(t))
    return 'user_registration';
  if (/\b(login|sign in)\b/.test(t)) return 'user_login';
  if (
    /\bfilter\b/.test(t) &&
    /product/.test(t) &&
    !/\bsearch\b/.test(t)
  ) {
    return 'product_filtering';
  }
  if (
    /\b(admin|administrator).*(access|functionality|permissions?)\b/.test(t) ||
    /\b(access|permissions?).*(admin|administrator)/.test(t) ||
    (/\bnormal users?\b/.test(t) && /administrator/.test(t))
  ) {
    return 'access_control';
  }
  if (/product search|search for products/.test(t)) return 'product_search';
  if (/product detail|view product/.test(t)) return 'product_details';
  if (entity === 'product') return 'product_discovery';
  return entity !== 'general' ? entity : 'general';
}

export function extractOutcome(
  text: string,
  actor: string,
  entity: string,
  action: string,
): string {
  const t = text.toLowerCase();
  if (entity === 'cart_item' && (action === 'add_to' || action === 'create')) {
    return 'item_added_to_pending_purchase';
  }
  if (entity === 'product_catalog' && action === 'create') {
    return 'product_available_in_catalog';
  }
  if (entity === 'product_catalog' && action === 'delete') {
    return 'product_removed_from_catalog';
  }
  if (entity === 'product_catalog' && action === 'update') {
    return 'catalog_product_information_changed';
  }
  if (entity === 'inventory' && action === 'update') {
    return 'inventory_levels_changed';
  }
  if (entity === 'order_confirmation' && extractChannel(t) === 'email') {
    return 'order_confirmation_delivered_by_email';
  }
  if (entity === 'order_confirmation') {
    return 'order_confirmation_displayed';
  }
  if (/cannot be purchased|prevent.*purchase|out of stock/.test(t)) {
    return 'unavailable_purchase_blocked';
  }
  if (/payment fail|failed payment/.test(t)) {
    return 'failed_payment_does_not_create_order';
  }
  if (/successful payment|payment success/.test(t)) {
    return 'successful_payment_creates_order';
  }
  // Generic outcome key from actor+entity+action
  return `${actor}:${entity}:${action}`;
}

export function extractPreconditions(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  if (/available product|in stock|available/.test(t)) out.push('product_available');
  if (/logged in|authenticated|registered/.test(t)) out.push('authenticated');
  if (/purchased|after purchase|order completed/.test(t)) out.push('prior_purchase');
  if (/admin|administrator/.test(t)) out.push('admin_authorized');
  return out;
}

export function buildSemanticProfile(r: SemanticComparable): SemanticProfile {
  const text = textOf(r);
  const actor = extractActor(text);
  const entity = extractEntity(text);
  const { action, crudOp } = extractAction(text);
  const channel = extractChannel(text);
  const capability = extractCapability(
    text,
    entity,
    r.featureName,
    r.businessArea,
  );
  const outcome = extractOutcome(text, actor, entity, action);
  const preconditions = extractPreconditions(text);
  let context: string | null = null;
  if (channel) context = `channel:${channel}`;
  else if (entity === 'inventory') context = 'responsibility:inventory';
  else if (entity === 'product_catalog') context = 'responsibility:catalog';
  else if (entity === 'cart_item') context = 'responsibility:shopping';

  return {
    actor,
    entity,
    action,
    capability,
    outcome,
    channel,
    context,
    crudOp,
    preconditions,
  };
}

export function profilesAlignedForDuplicate(
  a: SemanticProfile,
  b: SemanticProfile,
): boolean {
  return (
    a.actor === b.actor &&
    a.entity === b.entity &&
    a.action === b.action &&
    a.capability === b.capability &&
    a.outcome === b.outcome &&
    (a.channel ?? 'none') === (b.channel ?? 'none')
  );
}

/** Human-readable dimension diffs for UI reasons. */
export function describeSemanticDiff(
  a: SemanticProfile,
  b: SemanticProfile,
): string[] {
  const diffs: string[] = [];
  if (a.actor !== b.actor) diffs.push(`Different actor: ${a.actor} vs ${b.actor}`);
  if (a.entity !== b.entity)
    diffs.push(`Different entity: ${a.entity} vs ${b.entity}`);
  if (a.action !== b.action)
    diffs.push(`Different action: ${a.action} vs ${b.action}`);
  if (a.capability !== b.capability)
    diffs.push(
      `Different business capability: ${a.capability} vs ${b.capability}`,
    );
  if (a.outcome !== b.outcome)
    diffs.push(`Different business outcome: ${a.outcome} vs ${b.outcome}`);
  if ((a.channel ?? null) !== (b.channel ?? null) && (a.channel || b.channel)) {
    diffs.push(
      `Different delivery channel: ${a.channel ?? 'unspecified'} vs ${b.channel ?? 'unspecified'}`,
    );
  }
  if (
    a.crudOp &&
    b.crudOp &&
    a.crudOp !== b.crudOp &&
    a.entity === b.entity
  ) {
    diffs.push(`Different CRUD operation: ${a.crudOp} vs ${b.crudOp}`);
  }
  return diffs;
}
