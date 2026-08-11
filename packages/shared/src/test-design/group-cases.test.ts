import { describe, expect, it } from 'vitest';
import {
  buildTcmsTree,
  cycleResultCounts,
  featureFolderKey,
  groupCasesIntoFolders,
  normalizeCaseStatus,
  statusCounts,
} from './group-cases.js';

describe('case status', () => {
  it('falls back to Ready from the legacy flag', () => {
    expect(normalizeCaseStatus(null, true)).toBe('READY');
    expect(normalizeCaseStatus(undefined, false)).toBe('DRAFT');
    expect(normalizeCaseStatus('approved')).toBe('APPROVED');
  });
});

describe('groupCasesIntoFolders', () => {
  it('groups by feature name and nests requirements when a feature has two+', () => {
    const folders = groupCasesIntoFolders([
      {
        id: '1',
        featureKey: 'FG-001',
        featureName: 'User Login',
        requirementKey: 'REQ-001',
        requirementTitle: 'Login',
        priorityLabel: 'HIGH',
        externalId: 'TC-002',
      },
      {
        id: '2',
        featureKey: 'FG-001',
        featureName: 'User Login',
        requirementKey: 'REQ-002',
        requirementTitle: 'Invalid login',
        priorityLabel: 'MEDIUM',
        externalId: 'TC-001',
      },
      {
        id: '3',
        module: 'Auth',
        priorityLabel: 'HIGH',
        externalId: 'TC-003',
      },
    ]);
    expect(folders.map((f) => f.key)).toEqual(['Auth', 'FG-001']);
    const login = folders.find((f) => f.key === 'FG-001')!;
    expect(login.title).toBe('User Login');
    expect(login.sections).toHaveLength(2);
    expect(login.cases.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('puts cases directly under the feature when there is a single requirement', () => {
    const folders = groupCasesIntoFolders([
      {
        id: 'a',
        featureKey: 'FG-001',
        featureName: 'Checkout',
        requirementKey: 'REQ-001',
        priorityLabel: 'LOW',
      },
      {
        id: 'b',
        featureKey: 'FG-001',
        featureName: 'Checkout',
        requirementKey: 'REQ-001',
        priorityLabel: 'HIGH',
      },
    ]);
    expect(folders[0].sections).toHaveLength(1);
    expect(folders[0].sections[0].key).toBe('');
    expect(folders[0].cases.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('uses module when featureKey is missing', () => {
    expect(featureFolderKey({ module: 'Authentication' })).toBe(
      'Authentication',
    );
    expect(statusCounts([{ id: '1', readyForExecution: true }])).toEqual({
      draft: 0,
      approved: 0,
      ready: 1,
      total: 1,
    });
  });
});

describe('buildTcmsTree', () => {
  it('keeps empty folders and nests subfolders', () => {
    const tree = buildTcmsTree(
      [
        { id: 'f1', parentId: null, name: 'Login' },
        { id: 'f2', parentId: 'f1', name: 'Valid' },
        { id: 'f3', parentId: null, name: 'Empty Suite' },
      ],
      [
        {
          id: 'c1',
          folderId: 'f1',
          priorityLabel: 'HIGH',
          externalId: 'TC-001',
        },
        {
          id: 'c2',
          folderId: 'f2',
          priorityLabel: 'MEDIUM',
          externalId: 'TC-002',
        },
      ],
    );
    expect(tree.map((f) => f.title).sort()).toEqual(['Empty Suite', 'Login']);
    const login = tree.find((f) => f.title === 'Login')!;
    expect(login.sections.map((s) => s.title)).toEqual(['Valid']);
    expect(login.cases.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(tree.find((f) => f.title === 'Empty Suite')!.cases).toHaveLength(0);
  });
});

describe('cycleResultCounts', () => {
  it('counts pending when a case has no result', () => {
    expect(
      cycleResultCounts([
        { result: { status: 'PASSED' } },
        { result: { status: 'FAILED' } },
        { result: null },
        { result: { status: 'BLOCKED' } },
      ]),
    ).toEqual({
      passed: 1,
      failed: 1,
      blocked: 1,
      skipped: 0,
      pending: 1,
      total: 4,
      done: 3,
    });
  });
});
