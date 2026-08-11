import { describe, expect, it } from 'vitest';
import {
  extractStructuredSemanticsHeuristic,
  resolveStructuredSemantics,
  STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT,
} from './structured-semantics.js';
import { normalizeRequirement } from './normalized-requirement.js';
import { analyzeRelationship } from './duplicates.js';
import { analyzeRequirement } from './analyzer.js';

describe('structured semantic extraction', () => {
  it('OOS business rule → actor/action/object/condition/polarity', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'R1',
      title: 'Out Of Stock',
      description: 'Customers cannot buy an out-of-stock product.',
    });
    expect(s.actor).toBe('customer');
    expect(s.action).toBe('purchase');
    expect(s.object).toBe('product');
    expect(s.condition).toBe('OUT_OF_STOCK');
    expect(s.polarity).toBe('NOT_ALLOWED');
    expect(s.requirementType).toBe('BUSINESS_RULE');
    expect(s.capability).toBe('inventory');
    expect(s.confidence).toBeGreaterThanOrEqual(
      STRUCTURED_SEMANTIC_CONFIDENCE_ACCEPT,
    );
  });

  it('Open order → ORDER_DETAILS not product search', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'R2',
      title: 'Open Order',
      description: 'Users should be able to open an order to view its details.',
    });
    expect(s.object).toBe('order');
    expect(s.capability).toBe('order_details');
    expect(s.action).toBe('read');
  });

  it('Registration → USER_REGISTRATION', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'R3',
      title: 'User Registration',
      description:
        'Users can create an account using their email and password.',
    });
    expect(s.capability).toBe('user_registration');
    expect(s.object).toBe('user_account');
    expect(s.action).toBe('create');
    expect(s.requirementType).toBe('FUNCTIONAL');
  });

  it('post-login dashboard redirect → USER_LOGIN not registration', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'R3b',
      title: 'Post-Login Redirect',
      description:
        'After successful login, the user should be redirected to the dashboard.',
    });
    expect(s.capability).toBe('user_login');
    expect(s.capability).not.toBe('registration_redirect');
  });

  it('OTP expiration → SYSTEM / OTP / BUSINESS_RULE', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'R4',
      title: 'OTP Expiration',
      description: 'The OTP should expire after 10 minutes.',
    });
    expect(s.actor).toBe('system');
    expect(s.object).toBe('otp');
    expect(s.action).toBe('expire');
    expect(s.capability).toBe('otp_expiration');
    expect(s.requirementType).toBe('BUSINESS_RULE');
  });

  it('Invalid Login Error → user_account / login (not general)', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'REQ-005',
      title: 'Invalid Login Error',
      description:
        'The system should display an appropriate error message when invalid credentials are entered.',
    });
    expect(s.object).toBe('user_account');
    expect(s.action).toBe('login');
    expect(s.capability).toBe('user_login');
    expect(s.object).not.toBe('general');
  });

  it('Admin administrative access → user_account (not general)', () => {
    const s = extractStructuredSemanticsHeuristic({
      requirementKey: 'REQ-041',
      title: 'Have Access To Administrative Functionality',
      description:
        'Administrators should have access to administrative functionality.',
    });
    expect(s.object).toBe('user_account');
    expect(s.capability).toBe('access_control');
    expect(s.actor).toBe('administrator');
  });

  it('Admin Product Management → product_catalog (not general)', () => {
    const input = {
      requirementKey: 'REQ-049',
      title: 'Admin Product Management',
      description: 'Only administrators can manage products.',
    };
    const s = extractStructuredSemanticsHeuristic(input);
    expect(s.object).toBe('product_catalog');
    expect(s.capability).toBe('product_administration');
    expect(s.action).not.toBe('unspecified');
    const resolved = resolveStructuredSemantics(input, {
      actor: 'administrator',
      action: 'unspecified',
      object: 'general',
      condition: null,
      polarity: 'REQUIRED',
      requirementType: 'BUSINESS_RULE',
      capability: 'general',
      confidence: 0.99,
      uncertain: false,
      source: 'llm',
    });
    expect(resolved.object).toBe('product_catalog');
    expect(resolved.capability).toBe('product_administration');
  });

  it('LLM general placeholders do not override heuristic domain entities', () => {
    const resolved = resolveStructuredSemantics(
      {
        requirementKey: 'REQ-005',
        title: 'Invalid Login Error',
        description:
          'The system should display an appropriate error message when invalid credentials are entered.',
      },
      {
        actor: 'customer',
        action: 'unspecified',
        object: 'general',
        condition: null,
        polarity: 'UNSPECIFIED',
        requirementType: 'FUNCTIONAL',
        capability: 'general',
        confidence: 0.95,
        uncertain: false,
        source: 'llm',
      },
    );
    expect(resolved.object).toBe('user_account');
    expect(resolved.action).toBe('login');
  });

  it('low-confidence LLM is marked uncertain and falls back', () => {
    const resolved = resolveStructuredSemantics(
      {
        requirementKey: 'R5',
        title: 'Something vague',
        description: 'The system should work well.',
      },
      {
        actor: 'customer',
        action: 'unspecified',
        object: 'general',
        condition: null,
        polarity: 'UNSPECIFIED',
        requirementType: 'FUNCTIONAL',
        capability: 'general',
        confidence: 0.4,
        source: 'llm',
      },
    );
    expect(resolved.uncertain || resolved.confidence < 0.85).toBe(true);
  });

  it('normalize prefers accepted structured capability', () => {
    const n = normalizeRequirement({
      requirementKey: 'R6',
      title: 'Open An Order To View Its Details',
      description: 'Users can open an order to view its details.',
      structured: {
        actor: 'customer',
        action: 'read',
        object: 'order',
        condition: null,
        polarity: 'ALLOWED',
        requirementType: 'FUNCTIONAL',
        capability: 'order_details',
        confidence: 0.97,
        source: 'llm',
      },
    });
    expect(n.capability).toBe('order_details');
    expect(n.entity[0]).toBe('order');
  });

  it('Open Order vs Product Search stays INDEPENDENT with structured overlay', () => {
    expect(
      analyzeRelationship(
        {
          requirementKey: 'A',
          title: 'Open Order',
          description:
            'Users should be able to open an order to view its details.',
          structured: {
            actor: 'customer',
            action: 'read',
            object: 'order',
            condition: null,
            polarity: 'ALLOWED',
            requirementType: 'FUNCTIONAL',
            capability: 'order_details',
            confidence: 0.96,
            source: 'llm',
          },
        },
        {
          requirementKey: 'B',
          title: 'Product Search',
          description: 'Users should be able to search products.',
          structured: {
            actor: 'customer',
            action: 'search',
            object: 'product',
            condition: null,
            polarity: 'ALLOWED',
            requirementType: 'FUNCTIONAL',
            capability: 'product_search',
            confidence: 0.96,
            source: 'llm',
          },
        },
      ),
    ).toBe('NOT_RELATED');
  });

  it('OTP clarification questions stay OTP-scoped', () => {
    const a = analyzeRequirement({
      requirementKey: 'OTP',
      title: 'OTP Expiration',
      description: 'The OTP should expire after 10 minutes.',
      type: 'BUSINESS_RULE',
      structured: {
        actor: 'system',
        action: 'expire',
        object: 'otp',
        condition: 'AFTER_10_MINUTES',
        polarity: 'REQUIRED',
        requirementType: 'BUSINESS_RULE',
        capability: 'otp_expiration',
        confidence: 0.95,
        source: 'llm',
      },
    });
    const joined = a.questions.map((q) => q.question.toLowerCase()).join(' | ');
    expect(joined).not.toMatch(/registration|login attempt|password complexity/);
    expect(a.businessReview.semantic?.businessCapability).toBe('otp_expiration');
  });
});
