/**
 * Deterministic Business + Functional requirement analyzer.
 * Never invents confirmed business rules — gaps become questions.
 */

import {
  classifyRequirementTypes,
  computeBusinessImpact,
} from './classify.js';
import { questionBucket } from './question-utils.js';
import {
  computeReadinessScore,
  deriveStatuses,
} from './scoring.js';
import { buildSemanticProfile } from './semantic-profile.js';
import {
  factStatusToIntentSource,
  type BusinessReviewPayload,
  type FunctionalReviewPayload,
  type RequirementAnalysisResult,
  type ReviewFact,
  type ReviewQuestionDraft,
} from './types.js';

export type AnalyzableRequirement = {
  requirementKey: string;
  title: string;
  description: string;
  type: string;
  sourceText?: string | null;
  sourceSection?: string | null;
  acceptanceCriteria?: string[];
  businessRules?: string[];
  supportingInformation?: string[];
  /** Previously derived facts from user answers (preserved across re-analyze). */
  knownDerivedRules?: ReviewFact[];
  /** Existing project questions for dedup (optional; also applied at service layer). */
  existingQuestionTexts?: string[];
};

function fact(
  text: string,
  status: ReviewFact['status'],
  source?: string | null,
): ReviewFact {
  return {
    text,
    status,
    source: source ?? null,
    intentSource: factStatusToIntentSource(status),
  };
}

function blobOf(req: AnalyzableRequirement): string {
  return [
    req.title,
    req.description,
    req.sourceText ?? '',
    ...(req.acceptanceCriteria ?? []),
    ...(req.businessRules ?? []),
    ...(req.supportingInformation ?? []),
  ]
    .join('\n')
    .toLowerCase();
}

function emptyBusiness(): BusinessReviewPayload {
  return {
    intent: null,
    actors: [],
    rules: [],
    preconditions: [],
    flow: [],
    states: [],
    transitions: [],
    exceptions: [],
    outcomes: [],
    dependencies: [],
    permissions: [],
    semantic: null,
  };
}

function emptyFunctional(): FunctionalReviewPayload {
  return {
    inputs: [],
    outputs: [],
    validations: [],
    successBehavior: [],
    failureBehavior: [],
    errorHandling: [],
    navigation: [],
    dataHandling: [],
  };
}

function detectActors(blob: string, source: string): ReviewFact[] {
  const actors: ReviewFact[] = [];
  const add = (label: string, re: RegExp) => {
    if (re.test(blob)) actors.push(fact(label, 'CONFIRMED', source));
  };
  add('Customer / User', /\b(user|users|customer|customers)\b/);
  add('Guest', /\b(guest|anonymous)\b/);
  add('Administrator', /\b(admin|administrator|administrators)\b/);
  add('Payment Gateway', /\b(payment gateway|payment provider)\b/);
  add('System', /\b(system shall|the system)\b/);
  return actors;
}

function extractConfirmedRules(req: AnalyzableRequirement): ReviewFact[] {
  const rules: ReviewFact[] = [];
  const source = req.sourceText || req.description;
  for (const br of req.businessRules ?? []) {
    if (br.trim()) rules.push(fact(br.trim(), 'CONFIRMED', source));
  }
  const desc = req.description.trim();
  if (
    /\b(must|cannot|can only|only users?|only administrators?|must be unique|expire|should not allow|only purchased|out of stock.*cannot|cannot be purchased)\b/i.test(
      desc,
    )
  ) {
    if (!rules.some((r) => r.text === desc)) {
      rules.push(fact(desc, 'CONFIRMED', source));
    }
  }
  return rules;
}

function buildBusinessIntent(req: AnalyzableRequirement): ReviewFact {
  const title = req.title.trim();
  const desc = req.description.trim();
  const source = req.sourceText || desc;

  if (/\b(purpose|goal|intent|in order to)\b/i.test(desc)) {
    return fact(desc, 'CONFIRMED', source);
  }

  // Domain-aware intent phrasing (AI_INFERRED — never confirmed; outcome-focused)
  const blob = blobOf(req);
  let intent = `Allow the system to fulfill “${title}” with clear business outcomes for the actors involved.`;
  if (/cancel.*order|order.*cancel/.test(blob)) {
    intent =
      'Allow customers to cancel eligible orders before fulfillment reaches a restricted state.';
  } else if (/payment fail|payment failure|payment.*fail/.test(blob)) {
    intent =
      'Allow customers to complete an order using supported payment methods while preventing invalid orders when payment fails.';
  } else if (/payment success|successful payment|\bpayment\b/.test(blob)) {
    intent =
      'Allow customers to complete purchases using supported payment methods and create a valid order when payment succeeds.';
  } else if (/checkout|delivery address|shipping address/.test(blob)) {
    intent =
      'Allow customers to provide delivery information and create an order before payment is processed.';
  } else if (/product search|search product|filter.*product|\bsearch\b.*\bproduct/.test(blob)) {
    intent =
      'Allow customers to quickly discover relevant products and narrow results using available filters.';
  } else if (/password reset|forgot password|\botp\b/.test(blob)) {
    intent =
      'Allow users who cannot access their password to securely regain access to their account through OTP-based verification.';
  } else if (/shopping cart|add.*cart|cart total|cart quantity/.test(blob)) {
    intent =
      'Allow customers to assemble intended purchases and keep cart quantities and totals accurate before checkout.';
  } else if (/out of stock|cannot be purchased|inventory/.test(blob)) {
    intent =
      'Prevent purchase of unavailable inventory and keep orderable quantities aligned with stock rules.';
  } else if (/unique email/.test(blob)) {
    intent = 'Ensure each user account is uniquely identified by email.';
  } else if (/access control|another user/.test(blob)) {
    intent = 'Restrict users to their own data and prevent unauthorized access.';
  } else if (/register|registration/.test(blob)) {
    intent = 'Allow new customers to create accounts and become authenticated users.';
  } else if (/admin|administrator/.test(blob)) {
    intent =
      'Allow administrators to manage catalog and inventory operations within authorized boundaries.';
  } else if (desc.length > 40 && desc.length < 280) {
    intent = desc;
  }

  return fact(intent, 'INFERRED', source);
}

function q(
  category: ReviewQuestionDraft['category'],
  priority: ReviewQuestionDraft['priority'],
  question: string,
  reason: string,
  blocking: boolean,
): ReviewQuestionDraft {
  return {
    category,
    priority,
    question,
    reason,
    blocking,
    fingerprint: questionBucket(question),
  };
}

/**
 * Analyze one requirement — business layer first, then functional.
 */
export function analyzeRequirement(
  req: AnalyzableRequirement,
): RequirementAnalysisResult {
  const blob = blobOf(req);
  const source = req.sourceText || req.description;
  const business = emptyBusiness();
  const functional = emptyFunctional();
  const questions: ReviewQuestionDraft[] = [];

  const { primaryType, secondaryType } = classifyRequirementTypes(req);
  const businessImpact = computeBusinessImpact(req);

  business.intent = buildBusinessIntent(req);
  business.actors = detectActors(blob, source);
  business.rules = [
    ...extractConfirmedRules(req),
    ...(req.knownDerivedRules ?? []),
  ];
  const semantic = buildSemanticProfile({
    requirementKey: req.requirementKey,
    title: req.title,
    description: req.description,
    sourceText: req.sourceText,
  });
  business.semantic = {
    actor: semantic.actor,
    entity: semantic.entity,
    action: semantic.action,
    businessCapability: semantic.capability,
    businessOutcome: semantic.outcome,
    channel: semantic.channel,
    crudOp: semantic.crudOp,
  };
  if (semantic.outcome && semantic.outcome !== 'general') {
    business.outcomes.push(
      fact(
        `Business outcome: ${semantic.outcome.replace(/_/g, ' ')}`,
        'INFERRED',
        source,
      ),
    );
  }

  // --- Capability-aware gaps → questions (never invent confirmed rules) ---
  const cap = semantic.capability;
  const isRegistration =
    cap === 'user_registration' ||
    /\b(register|registration|sign up|create an account)\b/.test(blob);
  const isLogin =
    (cap === 'user_login' || /\b(login|sign in)\b/.test(blob)) &&
    !isRegistration &&
    !/\botp\b|password reset/.test(blob);
  const isOtpOrReset =
    cap === 'otp_delivery' ||
    cap === 'password_reset' ||
    (/\botp\b|password reset|forgot password|reset.*password/.test(blob) &&
      !isRegistration);
  const isProductSearch =
    cap === 'product_search' ||
    cap === 'product_search_results' ||
    (/\bsearch\b/.test(blob) && /\bproduct/.test(blob));
  const isCheckout =
    cap === 'checkout' || /\bcheckout\b|proceed to checkout/.test(blob);

  if (isRegistration) {
    business.outcomes.push(fact('User account creation', 'INFERRED', source));
    business.preconditions.push(
      fact('Valid registration information must be provided', 'INFERRED', source),
    );
    if (!/unique|already registered|existing email/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'Must email addresses be unique across user accounts?',
          'Registration behavior depends on uniqueness, which is not stated.',
          false,
        ),
      );
    } else {
      business.rules.push(
        fact('Email addresses must be unique', 'CONFIRMED', source),
      );
    }
    if (!/password.*(length|complex|character|policy|rule)/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'What password complexity rules apply during registration?',
          'Password policy is not defined for account creation.',
          false,
        ),
      );
    }
    if (!/verif|confirm email|activation/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_FLOW',
          'MEDIUM',
          'Is email verification required before the account can be used?',
          'Email verification requirement is not stated.',
          false,
        ),
      );
    }
    if (!/redirect|confirmation|auto-?login/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_OUTCOME',
          'MEDIUM',
          'What should happen after successful registration (redirect, confirmation, auto-login)?',
          'Post-registration business outcome is not fully defined.',
          false,
        ),
      );
    }
  }

  if (isLogin && !/invalid|error/.test(blob)) {
    business.preconditions.push(
      fact('User must have an existing account', 'INFERRED', source),
    );
    if (!/lock|attempt|retry/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'How many failed login attempts are allowed before the account is locked or delayed?',
          'Failed authentication policy is not defined.',
          false,
        ),
      );
    }
  }
  if (isLogin && /invalid/.test(blob) && /credential|login|error/.test(blob)) {
    functional.errorHandling.push(
      fact('Invalid credentials produce an error response', 'CONFIRMED', source),
    );
    if (!/message|display|show/.test(blob)) {
      questions.push(
        q(
          'ERROR_HANDLING',
          'LOW',
          'What error message should appear for invalid login credentials?',
          'Error presentation is not specified (cosmetic/functional refinement).',
          false,
        ),
      );
    }
  }

  if (isOtpOrReset) {
    business.flow.push(fact('Password reset / OTP flow', 'INFERRED', source));
    if (/expire|expiry|valid for|minutes/.test(blob)) {
      business.rules.push(fact(req.description, 'CONFIRMED', source));
    } else if (/\botp\b/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'How long is the OTP valid, and what happens after it expires?',
          'OTP validity window is not defined.',
          false,
        ),
      );
    }
    if (/\botp\b/.test(blob) && !/attempt|tries|retry|invalid otp/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'How many invalid OTP attempts are allowed, and what happens after an invalid OTP?',
          'OTP attempt and invalid-OTP behavior are not defined.',
          false,
        ),
      );
    }
    if (/\botp\b/.test(blob) && !/resend|send again|new otp/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_FLOW',
          'MEDIUM',
          'Can the user request a new OTP (resend), and are there limits?',
          'OTP resend policy is not defined.',
          false,
        ),
      );
    }
  }

  if (isProductSearch) {
    if (!/no (products?|results?)|empty|zero matches/.test(blob)) {
      questions.push(
        q(
          'BUSINESS_OUTCOME',
          'MEDIUM',
          'What should happen when no products match the search?',
          'Empty search-result behavior is not defined.',
          false,
        ),
      );
    }
    if (!/field|name|description|sku/.test(blob) && !/filter/.test(blob)) {
      questions.push(
        q(
          'DATA',
          'LOW',
          'Which product fields are searchable (name, description, SKU, etc.)?',
          'Searchable fields are not specified.',
          false,
        ),
      );
    }
  }

  // Stock / cart
  if (/out of stock|cannot be purchased|inventory/.test(blob)) {
    if (/cannot|must not|not allow|prevent/.test(blob)) {
      business.rules.push(
        fact(
          'Out-of-stock products cannot be purchased (from source)',
          'CONFIRMED',
          source,
        ),
      );
    } else {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'Can an out-of-stock product be added to the cart, and what happens at checkout if stock changes?',
          'Stock availability decisions affect purchase behavior and are not defined.',
          false,
        ),
      );
    }
  } else if (/cart|add to cart/.test(blob) && /stock|available/.test(blob)) {
    questions.push(
      q(
        'BUSINESS_RULE',
        'HIGH',
        'Can an out-of-stock product be added to the cart, and what happens at checkout if stock changes?',
        'Stock availability decisions affect purchase behavior and are not defined.',
        false,
      ),
    );
  }

  if (isCheckout) {
    business.preconditions.push(
      fact('Cart should contain purchasable items', 'INFERRED', source),
    );
    if (!/mandatory|required|field|address|contain/.test(blob)) {
      questions.push(
        q(
          'INPUT',
          'HIGH',
          'Which checkout fields are mandatory (e.g. delivery address)?',
          'Required checkout fields are not fully defined.',
          false,
        ),
      );
    }
    if (!/logged in|login|authenticated/.test(blob)) {
      questions.push(
        q(
          'PRECONDITION',
          'HIGH',
          'Must the user be logged in before checkout?',
          'Checkout authentication precondition is not defined.',
          false,
        ),
      );
    }
    if (!/stock|inventory|availability/.test(blob)) {
      questions.push(
        q(
          'EXCEPTION',
          'CRITICAL',
          'What happens if inventory changes (becomes unavailable) during checkout?',
          'Inventory race during checkout is a critical business risk and is not defined.',
          true,
        ),
      );
    }
    if (!/payment fail|retry payment/.test(blob)) {
      questions.push(
        q(
          'EXCEPTION',
          'HIGH',
          'What happens when payment fails during checkout, and can the user retry?',
          'Payment failure / retry at checkout is not defined.',
          false,
        ),
      );
    }
  }

  // Payment — only escalate CRITICAL on payment processing / failure / success
  const isPaymentCore =
    /\bpayment\b/.test(blob) &&
    /\b(fail|failure|success|successful|process|handling|gateway)\b/.test(blob);
  if (isPaymentCore || (/\bpayment\b/.test(blob) && /order/.test(blob))) {
    business.states.push(
      fact('Payment states are not fully defined in source', 'MISSING', source),
    );
    business.exceptions.push(
      fact('Payment/order consistency exception may apply', 'MISSING', source),
    );
    if (!/payment succeeds.*order|order creation fails|partial/.test(blob)) {
      questions.push(
        q(
          'EXCEPTION',
          'CRITICAL',
          'What should happen if payment succeeds but order creation fails?',
          'Payment/order consistency is a critical business exception and is not defined.',
          true,
        ),
      );
    }
    if (/fail|failure|failed/.test(blob)) {
      if (!/retry|try again/.test(blob)) {
        questions.push(
          q(
            'BUSINESS_FLOW',
            'HIGH',
            'Can the customer retry a failed payment, and how many times?',
            'Payment retry policy is not defined.',
            false,
          ),
        );
      }
      if (!/order.*(not|never)|do not create|must not create/.test(blob)) {
        questions.push(
          q(
            'EXCEPTION',
            'CRITICAL',
            'What should happen when payment fails (order state, notification, retry)?',
            'Payment failure business outcome is not defined.',
            true,
          ),
        );
      }
    } else if (!/fail|success|retry/.test(blob) && /\bpayment\b/.test(blob)) {
      questions.push(
        q(
          'EXCEPTION',
          'HIGH',
          'What happens when payment fails (notification, retry, order state)?',
          'Payment failure business outcome is not defined.',
          false,
        ),
      );
    }
    if (/credit|debit|method/.test(blob)) {
      functional.inputs.push(
        fact('Payment method selection', 'CONFIRMED', source),
      );
    }
  }

  if (/cancel.*order|order.*cancel/.test(blob)) {
    if (!/pending|confirmed|shipped|status/.test(blob) || !/only|until|when/.test(blob)) {
      questions.push(
        q(
          'STATE',
          'CRITICAL',
          'Which order statuses allow cancellation?',
          'Cancellation eligibility depends on order status, which is not defined.',
          true,
        ),
      );
      business.states.push(
        fact('Order statuses for cancellation are undefined', 'MISSING', source),
      );
      business.transitions.push(
        fact('Cancel transitions by status are undefined', 'MISSING', source),
      );
    } else {
      business.rules.push(fact(req.description, 'CONFIRMED', source));
    }
  }

  if (/review|rating/.test(blob) && !/admin/.test(blob)) {
    if (/purchased|only users who/.test(blob)) {
      business.rules.push(fact(req.description, 'CONFIRMED', source));
    } else {
      questions.push(
        q(
          'BUSINESS_RULE',
          'HIGH',
          'Who is allowed to submit a product review (e.g. only purchasers)?',
          'Review eligibility is a core business rule and is not defined.',
          false,
        ),
      );
    }
  }

  if (
    (cap === 'product_administration' ||
      cap === 'access_control' ||
      (/\b(administrators?|admins?)\b/.test(blob) &&
        !/\bnormal users?\b/.test(blob))) &&
    !isOtpOrReset &&
    !isRegistration
  ) {
    business.permissions.push(
      fact('Administrator capability referenced', 'CONFIRMED', source),
    );
    business.actors.push(fact('Administrator', 'CONFIRMED', source));
    if (!/normal user|cannot access|only admin/.test(blob)) {
      questions.push(
        q(
          'ROLE_PERMISSION',
          'HIGH',
          'Can non-administrator users access product administration features?',
          'Role permission boundary is not explicitly stated.',
          false,
        ),
      );
    }
  }

  if (/access control|another user'?s|own orders?/.test(blob)) {
    if (/cannot|must not|only.*(own|their)/.test(blob)) {
      business.rules.push(fact(req.description, 'CONFIRMED', source));
      business.permissions.push(
        fact('Users may only access their own orders/data', 'CONFIRMED', source),
      );
    } else {
      questions.push(
        q(
          'ROLE_PERMISSION',
          'CRITICAL',
          "Can a user access another user's order?",
          'Order access control is a critical business rule and is not defined.',
          true,
        ),
      );
    }
  }

  if (/profile|email address/.test(blob) && /cannot|must not|not be allowed|change/.test(blob)) {
    business.rules.push(fact(req.description, 'CONFIRMED', source));
  }

  // --- Functional layer (never overrides critical business gaps) ---
  if (/\b(enter|input|email|password|otp|search|quantity)\b/.test(blob)) {
    functional.inputs.push(
      fact('User input is required for this behavior', 'INFERRED', source),
    );
  }
  if ((req.acceptanceCriteria ?? []).length > 0) {
    for (const ac of req.acceptanceCriteria ?? []) {
      functional.validations.push(fact(ac, 'CONFIRMED', source));
    }
  } else if (
    primaryType === 'FUNCTIONAL' &&
    (cap === 'checkout' ||
      cap === 'payment' ||
      cap === 'user_registration' ||
      cap === 'user_login')
  ) {
    questions.push(
      q(
        'VALIDATION',
        'LOW',
        `Are there explicit validation or acceptance criteria for "${req.title}"?`,
        'No acceptance criteria were provided in the source.',
        false,
      ),
    );
  }

  if (/redirect|navigate|login page|confirmation/.test(blob)) {
    functional.navigation.push(
      fact('Navigation / redirect behavior mentioned', 'CONFIRMED', source),
    );
  }
  if (/success|successful|confirmation/.test(blob)) {
    functional.successBehavior.push(
      fact('Success behavior referenced', 'CONFIRMED', source),
    );
  }
  if (/fail|invalid|error/.test(blob)) {
    functional.failureBehavior.push(
      fact('Failure / error path referenced', 'CONFIRMED', source),
    );
  } else if (
    primaryType === 'FUNCTIONAL' &&
    (isLogin || isOtpOrReset || isRegistration || cap === 'payment') &&
    !/fail|invalid|error/.test(blob)
  ) {
    questions.push(
      q(
        'ERROR_HANDLING',
        'MEDIUM',
        `What is the expected failure behavior for "${req.title}"?`,
        'Failure handling is not described in the source.',
        false,
      ),
    );
  }

  // Deduplicate locally
  const seenQ = new Set<string>();
  const uniqueQuestions = questions.filter((draft) => {
    const k = draft.fingerprint || questionBucket(draft.question);
    draft.fingerprint = k;
    if (seenQ.has(k)) return false;
    // Also skip if exists in project-level texts
    if (
      (req.existingQuestionTexts ?? []).some(
        (t) => questionBucket(t) === k,
      )
    ) {
      return false;
    }
    seenQ.add(k);
    return true;
  });

  uniqueQuestions.sort((a, b) => {
    const rank = (p: string) =>
      p === 'CRITICAL' ? 0 : p === 'HIGH' ? 1 : p === 'MEDIUM' ? 2 : 3;
    const br = rank(a.priority) - rank(b.priority);
    if (br !== 0) return br;
    const ba = [
      'BUSINESS_RULE',
      'EXCEPTION',
      'STATE',
      'ROLE_PERMISSION',
      'PRECONDITION',
      'STATE_TRANSITION',
      'BUSINESS_FLOW',
      'BUSINESS_OUTCOME',
      'ACTOR',
    ].includes(a.category)
      ? 0
      : 1;
    const bb = [
      'BUSINESS_RULE',
      'EXCEPTION',
      'STATE',
      'ROLE_PERMISSION',
      'PRECONDITION',
      'STATE_TRANSITION',
      'BUSINESS_FLOW',
      'BUSINESS_OUTCOME',
      'ACTOR',
    ].includes(b.category)
      ? 0
      : 1;
    return ba - bb;
  });

  const capped = uniqueQuestions.slice(0, 6);

  const confirmedFunctional =
    functional.validations.length +
    functional.successBehavior.length +
    functional.failureBehavior.length +
    functional.inputs.length;
  let functionalCompleteness: RequirementAnalysisResult['functionalCompleteness'] =
    'PARTIAL';
  if (
    confirmedFunctional >= 3 &&
    !capped.some((x) => x.category === 'ERROR_HANDLING' && x.priority !== 'LOW')
  ) {
    functionalCompleteness = 'COMPLETE';
  }
  if (confirmedFunctional === 0 && primaryType === 'FUNCTIONAL') {
    functionalCompleteness = 'INCOMPLETE';
  }
  if (primaryType === 'NON_FUNCTIONAL' || primaryType === 'BUSINESS_RULE') {
    functionalCompleteness =
      confirmedFunctional > 0 || business.rules.length > 0
        ? 'COMPLETE'
        : 'PARTIAL';
  }

  const { businessReadiness, reviewStatus } = deriveStatuses({
    openQuestions: capped,
    functionalCompleteness,
  });

  const readinessScore = computeReadinessScore(
    capped.map((x) => ({
      priority: x.priority,
      category: x.category,
      blocking: x.blocking,
    })),
  );

  const intentSource = business.intent
    ? factStatusToIntentSource(business.intent.status)
    : 'AI_INFERRED';

  return {
    businessReview: business,
    functionalReview: functional,
    questions: capped,
    businessReadiness,
    functionalCompleteness,
    reviewStatus,
    readinessScore,
    primaryType,
    secondaryType,
    businessImpact,
    intentSource,
    businessIntentText: business.intent?.text ?? null,
  };
}

/**
 * Interpret a free-text answer into derived business facts (not invented beyond the answer).
 */
export function interpretAnswer(opts: {
  question: string;
  category: string;
  answer: string;
}): ReviewFact[] {
  const answer = opts.answer.trim();
  if (!answer) return [];

  const facts: ReviewFact[] = [
    fact(
      `Q: ${opts.question} → ${answer}`,
      'DERIVED_FROM_USER_ANSWER',
      'user-answer',
    ),
  ];

  if (/which order statuses|statuses allow/i.test(opts.question)) {
    const allowed = answer
      .split(/,| and |;/i)
      .map((s) => s.replace(/\b(only|not|except)\b/gi, '').trim())
      .filter((s) => s.length > 1 && s.length < 40);
    for (const status of allowed) {
      if (/shipped|delivered|cancelled|refunded|pending|confirmed|processing/i.test(status)) {
        facts.push(
          fact(
            `Orders may be cancelled when status is ${status}.`,
            'DERIVED_FROM_USER_ANSWER',
            'user-answer',
          ),
        );
      }
    }
    if (/not shipped|until shipment|before ship/i.test(answer)) {
      facts.push(
        fact(
          'Orders cannot be cancelled after shipment.',
          'DERIVED_FROM_USER_ANSWER',
          'user-answer',
        ),
      );
    }
  }

  if (/payment fails|payment fail/i.test(opts.question)) {
    facts.push(
      fact(`Payment failure handling: ${answer}`, 'DERIVED_FROM_USER_ANSWER', 'user-answer'),
    );
  }

  if (/payment succeeds but order/i.test(opts.question)) {
    facts.push(
      fact(
        `Payment/order consistency rule: ${answer}`,
        'DERIVED_FROM_USER_ANSWER',
        'user-answer',
      ),
    );
  }

  return facts;
}
