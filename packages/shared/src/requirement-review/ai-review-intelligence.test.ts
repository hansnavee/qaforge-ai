import { describe, expect, it } from 'vitest';
import {
  coerceAiFeatureGroups,
  coerceAiRequirementIntelligence,
  mergeAiIntoAnalysis,
  parseAiFeatureGroupsPayload,
  parseAiRequirementIntelligenceBatch,
} from './ai-review-intelligence.js';
import { analyzeRequirement } from './analyzer.js';

describe('AI review intelligence rails', () => {
  it('coerces feature groups and assigns orphans', () => {
    const drafts = coerceAiFeatureGroups(
      {
        features: [
          {
            name: 'Leave Requests',
            businessArea: 'HR',
            businessCapability: 'Request time off',
            businessIntent: 'Let employees request leave.',
            requirementKeys: ['REQ-001', 'REQ-002', 'BOGUS'],
          },
        ],
      },
      ['REQ-001', 'REQ-002', 'REQ-003'],
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.name).toBe('Leave Requests');
    expect(drafts[0]?.requirementKeys).toEqual(['REQ-001', 'REQ-002']);
    expect(drafts[1]?.name).toBe('Unclassified');
    expect(drafts[1]?.requirementKeys).toEqual(['REQ-003']);
  });

  it('enforces impact/question enums and rejects junk', () => {
    const intel = coerceAiRequirementIntelligence({
      requirementKey: 'REQ-010',
      businessIntent: 'Track vaccine appointments.',
      businessImpact: 'super-critical', // invalid → MEDIUM
      primaryType: 'functional',
      missingInformation: ['Cancellation window not specified'],
      questions: [
        {
          category: 'NOT_A_REAL_CATEGORY',
          priority: 'URGENT',
          question: 'What is the cancellation window for appointments?',
          reason: 'Needed for negative tests',
          blocking: false,
        },
      ],
      confidence: 0.91,
    });
    expect(intel).not.toBeNull();
    expect(intel!.businessImpact).toBe('MEDIUM');
    expect(intel!.primaryType).toBe('FUNCTIONAL');
    expect(intel!.questions[0]?.category).toBe('BUSINESS_RULE');
    expect(intel!.questions[0]?.priority).toBe('MEDIUM');
  });

  it('mergeAiIntoAnalysis replaces intent/impact/questions from AI', () => {
    const base = analyzeRequirement({
      requirementKey: 'REQ-HR-1',
      title: 'Submit Leave Request',
      description: 'Employees can submit a leave request for manager approval.',
      type: 'FUNCTIONAL',
    });
    const merged = mergeAiIntoAnalysis(base, {
      requirementKey: 'REQ-HR-1',
      businessIntent:
        'Allow employees to request paid or unpaid leave for manager approval.',
      businessImpact: 'HIGH',
      primaryType: 'FUNCTIONAL',
      secondaryType: null,
      missingInformation: ['Which leave types are allowed?'],
      questions: [
        {
          category: 'BUSINESS_RULE',
          priority: 'HIGH',
          question: 'Which leave types can an employee submit?',
          reason: 'Leave type catalog is unspecified',
          blocking: false,
          fingerprint: 'leave-types',
        },
      ],
      confidence: 0.93,
    });
    expect(merged.businessIntentText).toMatch(/leave/i);
    expect(merged.businessImpact).toBe('HIGH');
    expect(merged.questions).toHaveLength(1);
    expect(merged.questions[0]?.question).toMatch(/leave types/i);
    expect(merged.businessReview.preconditions?.some((p) => p.status === 'MISSING')).toBe(
      true,
    );
  });

  it('rejects sparse AI feature payloads so heuristic can fall back', () => {
    const parsed = parseAiFeatureGroupsPayload(
      { features: [{ name: 'X', requirementKeys: ['REQ-001'] }] },
      ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'],
    );
    // Only 25% coverage → null
    expect(parsed).toBeNull();
  });

  it('parses healthcare-style batch without ecommerce assumptions', () => {
    const map = parseAiRequirementIntelligenceBatch({
      requirements: [
        {
          requirementKey: 'REQ-H1',
          businessIntent: 'Schedule patient visits with available clinicians.',
          businessImpact: 'CRITICAL',
          primaryType: 'FUNCTIONAL',
          missingInformation: ['Timezone handling for telehealth'],
          questions: [
            {
              category: 'EXCEPTION',
              priority: 'HIGH',
              question: 'What happens when the clinician cancels within 2 hours?',
              reason: 'Late cancellation policy missing',
              blocking: true,
            },
          ],
          confidence: 0.88,
        },
      ],
    });
    expect(map.get('REQ-H1')?.businessImpact).toBe('CRITICAL');
    expect(map.get('REQ-H1')?.questions[0]?.blocking).toBe(true);
  });
});
