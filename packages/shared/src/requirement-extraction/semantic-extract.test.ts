import { describe, expect, it } from 'vitest';
import { parseRequirementDocument } from './document-parser';
import {
  extractRequirementsFromSource,
  filterExtractedRequirements,
  semanticExtractRequirements,
} from './semantic-extract';

const ECOMMERCE_SAMPLE = `# E-Commerce Application — Product Requirements

## 1. User Registration

The user should be able to create an account using their email address and password.

The email address must be unique.

After successful registration, the user should be redirected to the login page.

### Acceptance Criteria

- User can enter email and password.
- User cannot register using an already registered email.
- Successful registration displays a confirmation message.
- User is redirected to the login page.

## 2. User Login

The user should be able to login using their registered email and password.

### Acceptance Criteria

- User can enter email and password.
- Invalid credentials show an error message.

## 3. Password Reset

The user should be able to reset their password using OTP.

The OTP will be sent to the user's registered email address.

The user can enter the OTP and create a new password.

The OTP should expire after 10 minutes.

## 4. Product Details

The product details page should display:

- Product name
- Product images
- Product price
- Product description
- Product availability
- Customer rating

## 5. Shopping Cart

Users can add products to the shopping cart.

Users can increase or decrease the quantity.

Users can remove products from the cart.

The cart should display the total price.

## 6. Product Data

| Product | Category | Price | Stock |
| --- | --- | --- | --- |
| Laptop Pro | Electronics | 75000 | 10 |
| Wireless Mouse | Electronics | 1500 | 50 |

## 7. Business Rules

The system should not allow users to purchase products that are out of stock.

Only users who have purchased a product should be allowed to submit a review.

## 8. Non-Functional

The application should respond within 2 seconds.

The application should be highly secure.

The application should work on modern browsers.

The application should be easy to use on mobile devices.
`;

const HALLUCINATION_SAMPLE = `The user should be able to reset the password using OTP.

Do not invent channels or expiry unless stated.
`;

const AMBIGUOUS_SAMPLE = `The system should be fast.
Users can manage their profile.
`;

const DUPLICATE_SAMPLE = `Users should be able to login using valid credentials.

The user should be able to login using valid credentials.
`;

const UNICODE_SAMPLE = `用户应该能够使用电子邮件和密码注册。

Users should be able to search for products using the search bar.
`;

const FRAGMENT_SAMPLE = `## Checkout

The Checkout Page Should Contain:

List Contains The Following Information:

Uses:

Be User Friendly
`;

describe('parseRequirementDocument', () => {
  it('identifies headings, lists, and tables as structure', () => {
    const parsed = parseRequirementDocument(ECOMMERCE_SAMPLE);
    expect(parsed.sections.some((s) => /User Registration/i.test(s.title))).toBe(
      true,
    );
    expect(parsed.tables.length).toBeGreaterThanOrEqual(1);
    expect(parsed.tables[0]?.headers).toEqual([
      'Product',
      'Category',
      'Price',
      'Stock',
    ]);
    expect(parsed.elements.some((e) => e.type === 'TABLE')).toBe(true);
    expect(
      parsed.elements.some(
        (e) => e.type === 'HEADING' && e.role === 'acceptance_criteria',
      ),
    ).toBe(true);
  });
});

describe('semanticExtractRequirements', () => {
  it('does not extract headings, AC labels, or table rows as requirements', () => {
    const { requirements, documentElements } = extractRequirementsFromSource(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const blob = JSON.stringify(requirements);
    expect(blob).not.toMatch(/E-Commerce Application — Product Requirements/);
    expect(requirements.some((r) => /Acceptance Criteria/i.test(r.title))).toBe(
      false,
    );
    expect(requirements.some((r) => /^#{1,6}/.test(r.title))).toBe(false);
    expect(requirements.some((r) => /Laptop Pro/i.test(r.description))).toBe(
      false,
    );
    expect(requirements.some((r) => /Wireless Mouse/i.test(r.title))).toBe(
      false,
    );
    expect(documentElements.tables.length).toBeGreaterThanOrEqual(1);
    expect(documentElements.sections.length).toBeGreaterThanOrEqual(5);
  });

  it('attaches acceptance criteria to parent and not as separate requirements', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const registration = result.find((r) => r.title === 'User Registration');
    expect(registration).toBeTruthy();
    expect(registration!.type).toBe('FUNCTIONAL');
    expect(registration!.acceptanceCriteria.length).toBe(4);
    expect(
      result.some((r) =>
        /^User can enter email and password\.?$/i.test(r.description),
      ),
    ).toBe(false);
  });

  it('groups display lists into supportingInformation', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    const details = result.find((r) => r.title === 'Product Details');
    expect(details).toBeTruthy();
    expect(details!.description.toLowerCase()).toContain('product information');
    expect(details!.supportingInformation.length).toBeGreaterThanOrEqual(5);
    expect(details!.source.text.toLowerCase()).toContain(
      'product details page should display',
    );
    expect(
      result.filter((r) => /^Product (name|images|price)$/i.test(r.title)).length,
    ).toBe(0);
  });

  it('separates independent cart behaviors', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    expect(result.some((r) => /Add Product To Cart/i.test(r.title))).toBe(true);
    expect(result.some((r) => /Modify Product Quantity/i.test(r.title))).toBe(
      true,
    );
    expect(result.some((r) => /Remove Product From Cart/i.test(r.title))).toBe(
      true,
    );
    expect(result.some((r) => /Display Cart Total/i.test(r.title))).toBe(true);
  });

  it('classifies business rules and non-functional requirements', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    expect(
      result.find((r) => /must be unique/i.test(r.description))?.type,
    ).toBe('BUSINESS_RULE');
    expect(
      result.find((r) => /out of stock/i.test(r.description))?.type,
    ).toBe('BUSINESS_RULE');
    expect(
      result.find((r) => /expire after 10 minutes/i.test(r.description))?.type,
    ).toBe('BUSINESS_RULE');

    const nfr = result.filter((r) => r.type === 'NON_FUNCTIONAL');
    expect(nfr.length).toBeGreaterThanOrEqual(3);
  });

  it('uses concise complete titles and full sourceText', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    const login = result.find((r) => r.title === 'User Login');
    expect(login).toBeTruthy();
    expect(login!.title).not.toMatch(/And$/i);
    expect(login!.source.text.toLowerCase()).toContain(
      'registered email and password',
    );
  });

  it('preserves section context for password reset', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    const reset = result.filter((r) =>
      /Password Reset/i.test(r.source.section ?? ''),
    );
    expect(reset.length).toBeGreaterThanOrEqual(3);
    expect(reset.some((r) => r.title === 'Password Reset')).toBe(true);
    expect(reset.some((r) => r.title === 'OTP Delivery')).toBe(true);
    expect(reset.some((r) => r.title === 'OTP Expiration')).toBe(true);
  });

  it('rejects fragment / empty intro requirements', () => {
    const result = semanticExtractRequirements(FRAGMENT_SAMPLE, 'fragments.txt');
    expect(
      result.some((r) => /Checkout Page Should Contain/i.test(r.description)),
    ).toBe(false);
    expect(result.some((r) => /^Uses:?$/i.test(r.title))).toBe(false);
    expect(result.some((r) => /^Be User Friendly$/i.test(r.title))).toBe(false);
  });

  it('handles hallucination / ambiguous / duplicate / unicode samples', () => {
    const hall = semanticExtractRequirements(HALLUCINATION_SAMPLE, 'h.txt');
    expect(hall).toHaveLength(1);
    expect(hall.every((r) => r.acceptanceCriteria.length === 0)).toBe(true);

    const amb = semanticExtractRequirements(AMBIGUOUS_SAMPLE, 'a.txt');
    expect(amb.some((r) => r.type === 'NON_FUNCTIONAL')).toBe(true);

    const dup = semanticExtractRequirements(DUPLICATE_SAMPLE, 'd.txt');
    expect(dup).toHaveLength(1);

    const uni = semanticExtractRequirements(UNICODE_SAMPLE, 'u.txt');
    expect(uni.some((r) => /search for products/i.test(r.description))).toBe(
      true,
    );
  });

  it('prefers fewer accurate requirements over inflated counts', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    // Naive line/heading split would exceed 40+; semantic should stay reasonable
    expect(result.length).toBeGreaterThanOrEqual(12);
    expect(result.length).toBeLessThan(35);
  });
});

describe('filterExtractedRequirements', () => {
  it('drops heading, table, and bullet artifacts from AI output', () => {
    const filtered = filterExtractedRequirements([
      {
        title: 'E-Commerce Application — Product Requirements',
        description: '# E-Commerce Application — Product Requirements',
      },
      {
        title: 'Acceptance Criteria',
        description: '### Acceptance Criteria',
      },
      {
        title: 'Laptop Pro',
        description: '| Laptop Pro | Electronics | 75000 | 10 |',
      },
      {
        title: 'User Can Enter Email And',
        description: '- User can enter email and',
      },
      {
        title: 'User Registration',
        description:
          'The user should be able to create an account using their email address and password.',
        acceptanceCriteria: ['User can enter email and password.'],
        sourceText:
          'The user should be able to create an account using their email address and password.',
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('User Registration');
  });
});
