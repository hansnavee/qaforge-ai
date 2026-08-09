import { describe, expect, it } from 'vitest';
import { finalizeExtraction } from './finalize-extraction';
import { isRequirementCandidate } from './quality-gate';

const ECOMMERCE = `# E-Commerce Application — Product Requirements

## 1. User Registration

The user should be able to create an account using their email address and password.

The email address must be unique.

### Acceptance Criteria

- User can enter email and password.
- User cannot register using an already registered email.

## 2. User Login

The user should be able to login using their registered email and password.

Users can login using registered credentials.

## 4. Product Details

The product details page should display:

- Product name
- Product images

## 6. Product Data

| Product | Category | Price | Stock |
| --- | --- | --- | --- |
| Laptop Pro | Electronics | 75000 | 10 |
| Wireless Mouse | Electronics | 1500 | 50 |

## Business Rules

The system should not allow users to purchase products that are out of stock.
`;

describe('isRequirementCandidate', () => {
  it('rejects headings, AC labels, tables, fragments', () => {
    expect(
      isRequirementCandidate({
        title: '# E-Commerce Application — Product Requirements',
        description: '# E-Commerce Application — Product Requirements',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: '## 1. User Registration',
        description: '## 1. User Registration',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Acceptance Criteria',
        description: '### Acceptance Criteria',
      }).reason,
    ).toBe('ACCEPTANCE_CRITERIA_LABEL');

    expect(
      isRequirementCandidate({
        title: 'User Can Enter Email And',
        description: '- User can enter email and',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Product Name * Product Images',
        description: '- Product Name * Product Images',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Product | Category | Price',
        description: '| Product | Category | Price',
      }).reason,
    ).toMatch(/TABLE/);

    expect(
      isRequirementCandidate({
        title: 'Laptop Pro',
        description: '| Laptop Pro | Electronics | 75000 | 10 |',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Payment',
        description: 'Payment',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Uses',
        description: 'Uses:',
      }).ok,
    ).toBe(false);

    expect(
      isRequirementCandidate({
        title: 'Details Page Should Display',
        description: 'Details Page Should Display:',
      }).ok,
    ).toBe(false);
  });

  it('accepts meaningful requirements', () => {
    expect(
      isRequirementCandidate({
        title: 'User Registration',
        description:
          'The user should be able to create an account using their email address and password.',
        sourceText:
          'The user should be able to create an account using their email address and password.',
      }).ok,
    ).toBe(true);
  });
});

describe('finalizeExtraction', () => {
  it('never saves headings/tables/AC bullets and dedupes login', () => {
    const result = finalizeExtraction({
      sourceText: ECOMMERCE,
      documentName: 'ecommerce.txt',
      aiCandidates: [
        {
          title: '# E-Commerce Application — Product Requirements',
          description: '# E-Commerce Application — Product Requirements',
        },
        {
          title: '### Acceptance Criteria',
          description: '### Acceptance Criteria',
        },
        {
          title: 'User Can Enter Email And',
          description: '- User can enter email and',
        },
        {
          title: 'Laptop Pro',
          description: '| Laptop Pro | Electronics | 75000 | 10 |',
        },
        {
          title: 'User Login',
          description: 'Users can login using registered credentials.',
          sourceText: 'Users can login using registered credentials.',
        },
        {
          title: 'Payment',
          description: 'Payment',
        },
      ],
    });

    const blob = JSON.stringify(result.requirements);
    expect(blob).not.toMatch(/# E-Commerce/);
    expect(blob).not.toMatch(/Acceptance Criteria/);
    expect(blob).not.toMatch(/Laptop Pro/);
    expect(blob).not.toMatch(/User Can Enter Email And/);
    expect(result.requirements.filter((r) => /User Login/i.test(r.title))).toHaveLength(1);
    expect(result.documentElements.tables.length).toBe(1);
    expect(result.decisions.some((d) => d.decision === 'REJECT')).toBe(true);
    expect(result.decisions.some((d) => d.decision === 'TABLE_DATA')).toBe(true);
    expect(result.stats.saved).toBeLessThan(20);
    expect(result.stats.saved).toBeGreaterThanOrEqual(4);
  });
});
