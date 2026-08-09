import { describe, expect, it } from 'vitest';
import { buildReviewedRequirementsArtifact } from './build-reviewed-requirements-artifact.js';

describe('buildReviewedRequirementsArtifact', () => {
  it('maps Step 2 requirements into STLC REQUIREMENTS_JSON shape', () => {
    const artifact = buildReviewedRequirementsArtifact({
      appUrl: 'https://shop.example',
      projectName: 'Shop',
      analysisId: 'ANL-1',
      analysisVersion: '2.6.0',
      features: [
        {
          featureKey: 'FG-LOGIN',
          name: 'Login',
          businessArea: 'Authentication',
          reviewStatus: 'READY_FOR_TEST_DESIGN',
        },
      ],
      requirements: [
        {
          requirementKey: 'REQ-001',
          title: 'User can log in',
          description: 'Valid users authenticate with email/password',
          businessImpact: 'CRITICAL',
          reviewStatus: 'READY_FOR_TEST_DESIGN',
          acceptanceCriteria: ['Login succeeds', 'Session cookie set'],
          businessRules: ['Password required'],
          featureGroup: {
            featureKey: 'FG-LOGIN',
            name: 'Login',
            businessArea: 'Authentication',
          },
        },
      ],
    });

    expect(artifact.source).toBe('step2-reviewed');
    expect(artifact.requirements).toHaveLength(1);
    expect(artifact.requirements[0].id).toBe('REQ-001');
    expect(artifact.requirements[0].priority).toBe('high');
    expect(artifact.requirements[0].acceptanceCriteria).toEqual([
      'Login succeeds',
      'Session cookie set',
    ]);
    expect(artifact.coverageAreas).toContain('Authentication');
    expect(artifact.businessRules).toContain('Password required');
    expect(artifact.features[0].featureKey).toBe('FG-LOGIN');
  });
});
