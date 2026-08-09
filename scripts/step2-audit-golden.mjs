/**
 * Step 2 golden relationship checks (CLI mirror of step2-golden.test.ts).
 * Prefer: pnpm --filter @qaforge/shared test
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  analyzeRelationship,
  toCanonicalRelationships,
  normalizeRequirement,
} = require('../packages/shared/dist/requirement-review/duplicates.js');

const cases = [
  [
    'Unique Email exact dup',
    {
      requirementKey: 'A',
      title: 'Unique Email',
      description: 'An email address must be unique for each user account.',
    },
    {
      requirementKey: 'B',
      title: 'One Account',
      description:
        'A user email address can only be associated with one account.',
    },
    ['DUPLICATE'],
  ],
  [
    'Register vs Login',
    {
      requirementKey: 'A',
      title: 'User Registration',
      description: 'Users can register using their email and password.',
    },
    {
      requirementKey: 'B',
      title: 'User Login',
      description: 'Users can login using their registered email and password.',
    },
    ['SEQUENTIAL'],
  ],
  [
    'Search vs Results',
    {
      requirementKey: 'A',
      title: 'Product Search',
      description:
        'Users should be able to search for products using the search bar.',
    },
    {
      requirementKey: 'B',
      title: 'Product Search Results',
      description:
        'Users can select a product from search results to view its details.',
    },
    ['SEQUENTIAL'],
  ],
  [
    'Open Order vs Product Search (must NOT be RELATED)',
    {
      requirementKey: 'A',
      title: 'Open Order',
      description: 'Users can open an order to view its details.',
    },
    {
      requirementKey: 'B',
      title: 'Product Search',
      description:
        'Users should be able to search for products using the search bar.',
    },
    ['NOT_RELATED'],
  ],
  [
    'OOS vs Add to Cart',
    {
      requirementKey: 'A',
      title: 'Out Of Stock',
      description: 'Out-of-stock products cannot be purchased.',
      type: 'BUSINESS_RULE',
    },
    {
      requirementKey: 'B',
      title: 'Add To Cart',
      description:
        'Users should be able to add an available product to their cart.',
    },
    ['BUSINESS_RULE_CONSTRAINT'],
  ],
  [
    'OOS vs OTP Delivery (must NOT be RELATED)',
    {
      requirementKey: 'A',
      title: 'Out Of Stock',
      description: 'Out-of-stock products cannot be purchased.',
      type: 'BUSINESS_RULE',
    },
    {
      requirementKey: 'B',
      title: 'OTP Delivery',
      description: "The OTP will be sent to the user's registered email address.",
    },
    ['NOT_RELATED'],
  ],
];

let pass = 0;
let fail = 0;
for (const [name, a, b, expected] of cases) {
  const actual = analyzeRelationship(a, b);
  const ok = expected.includes(actual);
  console.log(`${ok ? 'PASS' : 'FAIL'}\t${name}\tactual=${actual}\texpected=${expected.join('|')}`);
  if (!ok) {
    fail += 1;
    console.log(
      ' ',
      normalizeRequirement(a).capability,
      normalizeRequirement(b).capability,
    );
  } else pass += 1;
}

const dens = toCanonicalRelationships(
  cases.flatMap((c) => [c[1], c[2]]),
);
console.log(
  `golden_pairs pass=${pass} fail=${fail} sample_edges=${dens.length} (no NOT_DUPLICATE)`,
);
process.exit(fail ? 1 : 0);
