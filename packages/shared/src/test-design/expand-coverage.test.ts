import { describe, expect, it } from 'vitest';
import {
  expandTechniqueCoverage,
  parseRequirementsFromArtifact,
  selectTechniques,
} from './expand-coverage.js';

const LOGIN_ARTIFACT = {
  requirements: [
    {
      id: 'REQ-001',
      title: 'User Login',
      description: 'User can log in with email and password.',
      featureName: 'User Login',
      acceptanceCriteria: ['Valid credentials authenticate the user'],
      businessRules: ['Email and password are required'],
    },
    {
      id: 'REQ-002',
      title: 'Invalid login error',
      description: 'Invalid credentials show an error message.',
      featureName: 'User Login',
      acceptanceCriteria: ['Error is displayed and access is blocked'],
      businessRules: [],
    },
    {
      id: 'REQ-003',
      title: 'Post-Login Redirect',
      description:
        'After successful login the user is redirected to the dashboard.',
      featureName: 'User Login',
      acceptanceCriteria: ['User lands on the dashboard'],
      businessRules: [],
    },
  ],
};

describe('test design technique coverage', () => {
  it('parses reviewed requirements artifact keys', () => {
    const reqs = parseRequirementsFromArtifact(LOGIN_ARTIFACT);
    expect(reqs.map((r) => r.id)).toEqual(['REQ-001', 'REQ-002', 'REQ-003']);
  });

  it('selects multiple techniques for a login requirement', () => {
    const reqs = parseRequirementsFromArtifact(LOGIN_ARTIFACT);
    const techs = selectTechniques(reqs[0]!);
    expect(techs).toContain('HAPPY_PATH');
    expect(techs).toContain('NEGATIVE');
    expect(techs).toContain('EQUIVALENCE');
    expect(techs).toContain('BOUNDARY');
    expect(techs).toContain('STATE_TRANSITION');
    expect(techs.length).toBeGreaterThanOrEqual(3);
  });

  it('uses generic open steps when no application URL is provided', () => {
    const { testCases } = expandTechniqueCoverage({
      requirements: LOGIN_ARTIFACT,
      appUrl: '',
      existingCases: [],
    });
    expect(testCases.some((c) => c.steps.some((s) => /saucedemo/i.test(s)))).toBe(
      false,
    );
    expect(testCases[0]?.steps[0]).toBe('Open the application under test');
    expect(testCases[0]?.designMode).toBe('GENERIC');
    expect(testCases[0]?.priorityLabel).toBeTruthy();
  });

  it('expands a 1:1 REQ→TC mapping into technique coverage', () => {
    const { testCases, coverage } = expandTechniqueCoverage({
      requirements: LOGIN_ARTIFACT,
      appUrl: 'https://app.example/login',
      existingCases: LOGIN_ARTIFACT.requirements.map((r, i) => ({
        id: `TC-00${i + 1}`,
        module: 'User Login',
        scenario: r.title,
        preconditions: 'Login page available for this requirement check.',
        steps: ['Open app', 'Perform requirement', 'Observe result'],
        expected: r.acceptanceCriteria[0],
        priority: 'P0',
        requirementKey: r.id,
        designTechnique: 'HAPPY_PATH',
      })),
    });

    expect(testCases.length).toBeGreaterThan(3);
    expect(coverage.complete).toBe(true);
    expect(coverage.requirementsWithMultiTechnique).toBe(3);
    expect(coverage.unmappedCases).toBe(0);

    for (const req of LOGIN_ARTIFACT.requirements) {
      const forReq = testCases.filter((c) => c.requirementKey === req.id);
      const techs = new Set(forReq.map((c) => c.designTechnique));
      expect(techs.size).toBeGreaterThanOrEqual(2);
      expect(techs.has('HAPPY_PATH')).toBe(true);
    }

    const blob = testCases
      .map((c) => `${c.scenario} ${c.steps.join(' ')} ${c.expected}`)
      .join(' ')
      .toLowerCase();
    expect(blob).not.toMatch(/sign\s?up|register|registration|create account/);
  });

  it('does not duplicate a technique already produced by the LLM', () => {
    const { testCases } = expandTechniqueCoverage({
      requirements: LOGIN_ARTIFACT,
      appUrl: 'https://app.example/login',
      existingCases: [
        {
          id: 'TC-LLM',
          module: 'User Login',
          scenario: 'Valid user logs in with email and password',
          preconditions: 'Login page is available at the app URL.',
          steps: [
            'Open login',
            'Enter valid email',
            'Enter valid password',
            'Click login',
          ],
          expected: 'User is authenticated',
          requirementKey: 'REQ-001',
          designTechnique: 'HAPPY_PATH',
        },
      ],
    });
    const happy = testCases.filter(
      (c) => c.requirementKey === 'REQ-001' && c.designTechnique === 'HAPPY_PATH',
    );
    expect(happy).toHaveLength(1);
    expect(happy[0]?.scenario).toContain('Valid user logs in');
  });

  it('honors an explicit technique list', () => {
    const { testCases } = expandTechniqueCoverage({
      requirements: LOGIN_ARTIFACT,
      appUrl: '',
      existingCases: [],
      techniques: ['HAPPY_PATH', 'NEGATIVE'],
    });
    const techs = new Set(testCases.map((c) => c.designTechnique));
    expect([...techs].sort()).toEqual(['HAPPY_PATH', 'NEGATIVE']);
  });
});
