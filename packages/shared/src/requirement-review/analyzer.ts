/**
 * Deterministic Business + Functional requirement analyzer.
 * Never invents confirmed business rules — gaps become questions.
 */

import {
  computeReadinessScore,
  deriveStatuses,
} from './scoring.js';
import type {
  BusinessReviewPayload,
  FunctionalReviewPayload,
  RequirementAnalysisResult,
  ReviewFact,
  ReviewQuestionDraft,
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
};

function fact(
  text: string,
  status: ReviewFact['status'],
  source?: string | null,
): ReviewFact {
  return { text, status, source: source ?? null };
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
  add('Administrator', /\b(admin|administrator|administrators)\b/);
  add('Guest', /\bguest\b/);
  add('System', /\b(system|application)\b/);
  add('Payment Gateway', /\b(payment gateway|payment provider)\b/);
  add('Email Service', /\b(email|otp).*\b(sent|send|deliver)/);
  if (!actors.length) {
    actors.push(
      fact('Actor not explicitly identified', 'MISSING', source),
    );
  }
  return actors;
}

function extractConfirmedRules(req: AnalyzableRequirement): ReviewFact[] {
  const rules: ReviewFact[] = [];
  const source = req.sourceText || req.description;
  for (const br of req.businessRules ?? []) {
    if (br.trim()) rules.push(fact(br.trim(), 'CONFIRMED', source));
  }
  // Explicit constraint phrases in description
  const desc = req.description.trim();
  if (
    /\b(must|cannot|can only|only users?|only administrators?|must be unique|expire|should not allow)\b/i.test(
      desc,
    )
  ) {
    if (!rules.some((r) => r.text === desc)) {
      rules.push(fact(desc, 'CONFIRMED', source));
    }
  }
  return rules;
}

function inferIntent(req: AnalyzableRequirement): ReviewFact {
  const title = req.title.trim();
  const desc = req.description.trim();
  // Intent is always inferred unless the source states "purpose/goal"
  if (/\b(purpose|goal|intent|in order to)\b/i.test(desc)) {
    return fact(desc, 'CONFIRMED', req.sourceText || desc);
  }
  return fact(
    `Enable: ${title}. ${desc}`,
    'INFERRED',
    req.sourceText || desc,
  );
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

  business.intent = inferIntent(req);
  business.actors = detectActors(blob, source);
  business.rules = [
    ...extractConfirmedRules(req),
    ...(req.knownDerivedRules ?? []),
  ];

  // --- Domain heuristics: gaps → questions (never invent confirmed rules) ---

  // Registration / unique email
  if (/register|registration|create an account/.test(blob)) {
    business.outcomes.push(
      fact('User account creation', 'INFERRED', source),
    );
    if (!/unique|already registered|existing email/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question: 'Must email addresses be unique across user accounts?',
        reason: 'Registration behavior depends on uniqueness, which is not stated.',
        blocking: false,
      });
    }
    if (!/redirect|login page|confirmation/.test(blob)) {
      questions.push({
        category: 'BUSINESS_OUTCOME',
        priority: 'MEDIUM',
        question:
          'What should happen after successful registration (redirect, confirmation, auto-login)?',
        reason: 'Post-registration business outcome is not fully defined.',
        blocking: false,
      });
    }
  }

  // Login
  if (/\blogin\b|\bsign in\b/.test(blob) && !/invalid|error/.test(blob)) {
    if (!/lock|attempt|retry/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question:
          'How many failed login attempts are allowed before the account is locked or delayed?',
        reason: 'Failed authentication policy is not defined.',
        blocking: false,
      });
    }
  }
  if (/invalid/.test(blob) && /credential|login|error/.test(blob)) {
    functional.errorHandling.push(
      fact('Invalid credentials produce an error response', 'CONFIRMED', source),
    );
    if (!/message|display|show/.test(blob)) {
      questions.push({
        category: 'ERROR_HANDLING',
        priority: 'MEDIUM',
        question: 'What error message should appear for invalid login credentials?',
        reason: 'Error presentation is not specified.',
        blocking: false,
      });
    }
  }

  // OTP / password reset
  if (/\botp\b|password reset|reset.*password/.test(blob)) {
    business.flow.push(
      fact('Password reset / OTP flow', 'INFERRED', source),
    );
    if (/expire|expiry|valid for|minutes/.test(blob)) {
      business.rules.push(
        fact(req.description, 'CONFIRMED', source),
      );
    } else if (/\botp\b/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question: 'How long is the OTP valid, and what happens after it expires?',
        reason: 'OTP validity window is not defined.',
        blocking: true,
      });
    }
    if (/\botp\b/.test(blob) && !/attempt|tries|retry/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question: 'How many invalid OTP attempts are allowed?',
        reason: 'OTP attempt limit is not defined.',
        blocking: false,
      });
    }
    if (/\botp\b/.test(blob) && !/resend|send again/.test(blob)) {
      questions.push({
        category: 'BUSINESS_FLOW',
        priority: 'MEDIUM',
        question: 'Can the user request a new OTP (resend), and are there limits?',
        reason: 'OTP resend policy is not defined.',
        blocking: false,
      });
    }
    if (/enter.*otp|otp entry/.test(blob) || /otp/.test(req.title.toLowerCase())) {
      questions.push({
        category: 'INPUT',
        priority: 'MEDIUM',
        question: 'Where does the user enter the OTP, and what validation applies?',
        reason: 'OTP input location/validation is not fully specified.',
        blocking: false,
      });
    }
  }

  // Cart / stock — never invent stock policy; ask when ambiguous
  if (/cart|add product|add to cart|out of stock|\bstock\b/.test(blob)) {
    if (/stock|available|availability/.test(blob) && !/cannot add|prevent.*cart|out of stock cannot/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question:
          'Can an out-of-stock product be added to the cart, and what happens at checkout if stock changes?',
        reason: 'Stock availability decisions affect purchase behavior and are not defined.',
        blocking: false,
      });
    }
  }

  // Payment
  if (/payment|checkout|pay/.test(blob)) {
    business.states.push(
      fact('Payment states are not fully defined in source', 'MISSING', source),
    );
    questions.push({
      category: 'EXCEPTION',
      priority: 'CRITICAL',
      question:
        'What should happen if payment succeeds but order creation fails?',
      reason:
        'Payment/order consistency is a critical business exception and is not defined.',
      blocking: true,
    });
    if (!/retry|try again/.test(blob) && /fail|failure|failed/.test(blob)) {
      questions.push({
        category: 'BUSINESS_FLOW',
        priority: 'HIGH',
        question: 'Can the customer retry a failed payment, and how many times?',
        reason: 'Payment retry policy is not defined.',
        blocking: false,
      });
    } else if (/payment/.test(blob) && !/fail|success|retry/.test(blob)) {
      questions.push({
        category: 'EXCEPTION',
        priority: 'HIGH',
        question: 'What happens when payment fails (notification, retry, order state)?',
        reason: 'Payment failure business outcome is not defined.',
        blocking: true,
      });
    }
    if (/credit|debit|method/.test(blob)) {
      functional.inputs.push(
        fact('Payment method selection', 'CONFIRMED', source),
      );
    }
  }

  // Order cancel
  if (/cancel.*order|order.*cancel/.test(blob)) {
    questions.push({
      category: 'STATE',
      priority: 'CRITICAL',
      question: 'Which order statuses allow cancellation?',
      reason:
        'Cancellation eligibility depends on order status, which is not defined.',
      blocking: true,
    });
    business.states.push(
      fact('Order statuses for cancellation are undefined', 'MISSING', source),
    );
  }

  // Reviews
  if (/review|rating/.test(blob)) {
    if (/purchased|only users who/.test(blob)) {
      business.rules.push(fact(req.description, 'CONFIRMED', source));
    } else {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'HIGH',
        question:
          'Who is allowed to submit a product review (e.g. only purchasers)?',
        reason: 'Review eligibility is a core business rule and is not defined.',
        blocking: false,
      });
    }
    if (!/multiple|edit|delete|one review/.test(blob)) {
      questions.push({
        category: 'BUSINESS_RULE',
        priority: 'MEDIUM',
        question:
          'Can a user submit multiple reviews, edit a review, or delete a review?',
        reason: 'Review lifecycle rules are not defined.',
        blocking: false,
      });
    }
  }

  // Admin permissions
  if (/admin|administrator/.test(blob)) {
    business.permissions.push(
      fact('Administrator capability referenced', 'CONFIRMED', source),
    );
    if (!/normal user|cannot access|only admin/.test(blob)) {
      questions.push({
        category: 'ROLE_PERMISSION',
        priority: 'HIGH',
        question:
          'Can non-administrator users access product administration features?',
        reason: 'Role permission boundary is not explicitly stated.',
        blocking: false,
      });
    }
  }

  // Profile / email change
  if (/profile|email address/.test(blob) && /cannot|must not|not be allowed|change/.test(blob)) {
    business.rules.push(fact(req.description, 'CONFIRMED', source));
  }

  // --- Functional layer ---
  if (/\b(enter|input|email|password|otp|search|quantity)\b/.test(blob)) {
    functional.inputs.push(
      fact('User input is required for this behavior', 'INFERRED', source),
    );
  }
  if ((req.acceptanceCriteria ?? []).length > 0) {
    for (const ac of req.acceptanceCriteria ?? []) {
      functional.validations.push(fact(ac, 'CONFIRMED', source));
    }
  } else if (req.type === 'FUNCTIONAL') {
    questions.push({
      category: 'VALIDATION',
      priority: 'LOW',
      question: `Are there explicit validation or acceptance criteria for "${req.title}"?`,
      reason: 'No acceptance criteria were provided in the source.',
      blocking: false,
    });
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
  } else if (req.type === 'FUNCTIONAL' && /login|payment|otp|register/.test(blob)) {
    questions.push({
      category: 'ERROR_HANDLING',
      priority: 'MEDIUM',
      question: `What is the expected failure behavior for "${req.title}"?`,
      reason: 'Failure handling is not described in the source.',
      blocking: false,
    });
  }

  // Deduplicate questions by text
  const seenQ = new Set<string>();
  const uniqueQuestions = questions.filter((q) => {
    const k = q.question.toLowerCase();
    if (seenQ.has(k)) return false;
    seenQ.add(k);
    return true;
  });

  // Sort: business categories + CRITICAL/HIGH first
  uniqueQuestions.sort((a, b) => {
    const rank = (p: string) =>
      p === 'CRITICAL' ? 0 : p === 'HIGH' ? 1 : p === 'MEDIUM' ? 2 : 3;
    const br = rank(a.priority) - rank(b.priority);
    if (br !== 0) return br;
    const ba = a.category.startsWith('BUSINESS') || a.category === 'ACTOR' || a.category === 'STATE' || a.category === 'EXCEPTION' || a.category === 'PRECONDITION' || a.category === 'ROLE_PERMISSION' || a.category === 'STATE_TRANSITION'
      ? 0
      : 1;
    const bb = b.category.startsWith('BUSINESS') || b.category === 'ACTOR' || b.category === 'STATE' || b.category === 'EXCEPTION' || b.category === 'PRECONDITION' || b.category === 'ROLE_PERMISSION' || b.category === 'STATE_TRANSITION'
      ? 0
      : 1;
    return ba - bb;
  });

  // Cap noise: keep top 8 per requirement (smart reduction)
  const capped = uniqueQuestions.slice(0, 8);

  const confirmedFunctional =
    functional.validations.length +
    functional.successBehavior.length +
    functional.failureBehavior.length +
    functional.inputs.length;
  let functionalCompleteness: RequirementAnalysisResult['functionalCompleteness'] =
    'PARTIAL';
  if (confirmedFunctional >= 3 && !capped.some((q) => q.category === 'ERROR_HANDLING' && q.priority !== 'LOW')) {
    functionalCompleteness = 'COMPLETE';
  }
  if (confirmedFunctional === 0 && req.type === 'FUNCTIONAL') {
    functionalCompleteness = 'INCOMPLETE';
  }
  if (req.type === 'NON_FUNCTIONAL' || req.type === 'BUSINESS_RULE') {
    functionalCompleteness =
      confirmedFunctional > 0 || business.rules.length > 0 ? 'COMPLETE' : 'PARTIAL';
  }

  const { businessReadiness, reviewStatus } = deriveStatuses({
    openQuestions: capped,
    functionalCompleteness,
  });

  const readinessScore = computeReadinessScore(
    capped.map((q) => ({
      priority: q.priority,
      category: q.category,
      blocking: q.blocking,
    })),
  );

  return {
    businessReview: business,
    functionalReview: functional,
    questions: capped,
    businessReadiness,
    functionalCompleteness,
    reviewStatus,
    readinessScore,
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

  // Status-list derivation for cancellation-style questions
  if (/which order statuses|statuses allow/i.test(opts.question)) {
    const allowed = answer
      .split(/,| and /i)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const status of allowed) {
      facts.push(
        fact(
          `Orders may be cancelled when status is ${status}.`,
          'DERIVED_FROM_USER_ANSWER',
          'user-answer',
        ),
      );
    }
  }

  return facts;
}
