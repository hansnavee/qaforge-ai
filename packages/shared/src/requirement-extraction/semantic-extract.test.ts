import { describe, expect, it } from 'vitest';
import {
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

The user should be able to login using valid credentials.

### Acceptance Criteria

- User can enter email and password.
- Invalid credentials show an error message.

## 3. Password Reset

The user should be able to reset their password using OTP.

The OTP will be sent to the user's registered email address.

The OTP should expire after 10 minutes.

## 4. Product Details

The product details page should display:

- Product name
- Product images
- Product price
- Product description
- Product availability
- Customer rating

## 5. Non-Functional

The application should respond within 2 seconds.

The application should be highly secure.

The application should work on modern browsers.
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

describe('semanticExtractRequirements', () => {
  it('does not extract headings or acceptance-criteria labels as requirements', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const titles = result.map((r) => r.title);
    const descriptions = result.map((r) => r.description);

    expect(titles.join('\n')).not.toMatch(/E-Commerce Application/i);
    expect(descriptions.some((d) => /^#\s/.test(d))).toBe(false);
    expect(titles).not.toContain('Acceptance Criteria');
    expect(descriptions).not.toContain('Acceptance Criteria');
    expect(result.some((r) => /^#{1,6}/.test(r.title))).toBe(false);
    expect(result.some((r) => r.description.trim() === 'Product name')).toBe(
      false,
    );
  });

  it('attaches acceptance criteria to the parent registration requirement', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const registration = result.find(
      (r) =>
        /create an account/i.test(r.description) ||
        r.title === 'User Registration',
    );
    expect(registration).toBeTruthy();
    expect(registration!.type).toBe('FUNCTIONAL');
    expect(registration!.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
    expect(
      registration!.acceptanceCriteria.some((c) =>
        /already registered email/i.test(c),
      ),
    ).toBe(true);

    // AC bullets must not be standalone requirements
    expect(
      result.some((r) =>
        /^User can enter email and password\.?$/i.test(r.description),
      ),
    ).toBe(false);
  });

  it('classifies business rules and non-functional requirements', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const uniqueEmail = result.find((r) => /must be unique/i.test(r.description));
    expect(uniqueEmail?.type).toBe('BUSINESS_RULE');

    const otpExpiry = result.find((r) => /expire after 10 minutes/i.test(r.description));
    expect(otpExpiry?.type).toBe('BUSINESS_RULE');

    const nfr = result.filter((r) => r.type === 'NON_FUNCTIONAL');
    expect(nfr.length).toBeGreaterThanOrEqual(2);
    expect(nfr.some((r) => /within 2 seconds/i.test(r.description))).toBe(true);
  });

  it('groups display bullet lists into one requirement', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );

    const details = result.find((r) =>
      /product details page should display/i.test(r.description),
    );
    expect(details).toBeTruthy();
    expect(details!.description.toLowerCase()).toContain('product name');
    expect(details!.description.toLowerCase()).toContain('customer rating');
    expect(
      result.filter((r) => /^Product (name|images|price)\.?$/i.test(r.description))
        .length,
    ).toBe(0);
  });

  it('preserves source section context', () => {
    const result = semanticExtractRequirements(
      ECOMMERCE_SAMPLE,
      'ecommerce-requirements.txt',
    );
    const reset = result.find((r) =>
      /reset their password using OTP/i.test(r.description),
    );
    expect(reset?.source.section).toMatch(/Password Reset/i);
    expect(reset?.source.document).toBe('ecommerce-requirements.txt');
    expect(reset?.source.text).toMatch(/OTP/i);
  });

  it('handles hallucination sample without inventing acceptance criteria', () => {
    const result = semanticExtractRequirements(
      HALLUCINATION_SAMPLE,
      'hallucination.txt',
    );
    expect(result.length).toBe(1);
    expect(result[0]?.description).toMatch(/reset the password using OTP/i);
    expect(result.every((r) => r.acceptanceCriteria.length === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/\bSMS\b|email channel/i);
  });

  it('handles ambiguous requirements without fabricating detail', () => {
    const result = semanticExtractRequirements(
      AMBIGUOUS_SAMPLE,
      'ambiguous.txt',
    );
    expect(result.some((r) => r.type === 'NON_FUNCTIONAL')).toBe(true);
    expect(result.every((r) => r.acceptanceCriteria.length === 0)).toBe(true);
  });

  it('controls duplicate near-identical statements', () => {
    const result = semanticExtractRequirements(
      DUPLICATE_SAMPLE,
      'duplicates.txt',
    );
    expect(result.length).toBe(1);
  });

  it('extracts unicode-adjacent english requirements and ignores non-signal unicode-only if no signal', () => {
    const result = semanticExtractRequirements(UNICODE_SAMPLE, 'unicode.txt');
    expect(
      result.some((r) => /search for products/i.test(r.description)),
    ).toBe(true);
  });
});

describe('filterExtractedRequirements', () => {
  it('drops heading and bullet artifacts from AI output', () => {
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
        title: 'User Can Enter Email And',
        description: '- User can enter email and',
      },
      {
        title: 'User Registration',
        description:
          'The user should be able to create an account using their email address and password.',
        acceptanceCriteria: ['User can enter email and password.'],
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('User Registration');
  });
});
