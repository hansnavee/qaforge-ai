/**
 * Quick Step 2 P0 density / false-relation check (post-fix).
 * Run: node scripts/step2-p0-verify.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Prefer built dist; fall back to vitest-less dynamic import of source via tsx not available —
// use the compiled package if present, else inline via shared dist.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const require = createRequire(import.meta.url);

let mod;
try {
  mod = require('../packages/shared/dist/requirement-review/duplicates.js');
} catch {
  // build first
  console.error('Build @qaforge/shared first: pnpm --filter @qaforge/shared build');
  process.exit(1);
}
const analyzer = require('../packages/shared/dist/requirement-review/analyzer.js');
const { toCanonicalRelationships, analyzeRelationship, normalizeRequirement } = mod;
const { analyzeRequirement } = analyzer;

const reqs = [
  { requirementKey: 'R1', title: 'User Registration', description: 'Users can register using their email and password.' },
  { requirementKey: 'R2', title: 'Unique Email', description: 'An email address must be unique for each user account.', type: 'BUSINESS_RULE' },
  { requirementKey: 'R3', title: 'User Login', description: 'Users can login using their registered email and password.' },
  { requirementKey: 'R4', title: 'Invalid Login', description: 'Invalid login credentials must show an error.' },
  { requirementKey: 'R5', title: 'Password Reset', description: 'The user should be able to reset their password using OTP.' },
  { requirementKey: 'R6', title: 'OTP Expiration', description: 'The OTP should expire after a limited time.' },
  { requirementKey: 'R7', title: 'OTP Delivery', description: "The OTP will be sent to the user's registered email address." },
  { requirementKey: 'R8', title: 'Product Search', description: 'Users should be able to search for products using the search bar.' },
  { requirementKey: 'R9', title: 'Search Results', description: 'Users can select a product from search results to view its details.' },
  { requirementKey: 'R10', title: 'Product Details', description: 'The product details page should display product information.' },
  { requirementKey: 'R11', title: 'Add Product', description: 'Administrators should be able to add new products.' },
  { requirementKey: 'R12', title: 'Modify Quantity', description: 'Users can increase or decrease product quantity in the cart.' },
  { requirementKey: 'R13', title: 'Remove From Cart', description: 'Users can remove a product from the cart.' },
  { requirementKey: 'R14', title: 'Cart Total', description: 'The cart should display the total price.' },
  { requirementKey: 'R15', title: 'Out Of Stock', description: 'Out-of-stock products cannot be purchased.', type: 'BUSINESS_RULE' },
  { requirementKey: 'R16', title: 'Order History', description: 'Users can view their previous orders / order history.' },
  { requirementKey: 'R17', title: 'Open Order', description: 'Users can open an order to view its details.' },
  { requirementKey: 'R18', title: 'Order Confirmation', description: 'The confirmation page should display product information.' },
  { requirementKey: 'R19', title: 'Order Access', description: "Users should not access another user's order." },
  { requirementKey: 'R20', title: 'Update Product', description: 'Administrators should be able to update product information.' },
  { requirementKey: 'R21', title: 'Delete Product', description: 'Administrators should be able to remove products.' },
  { requirementKey: 'R22', title: 'Inventory Update', description: 'Administrators should be able to update product inventory.' },
  { requirementKey: 'R23', title: 'Admin Access', description: 'Administrators should have access to administrative functionality.' },
  { requirementKey: 'R24', title: 'User Deny', description: 'Normal users should not have administrator permissions.' },
  { requirementKey: 'R25', title: 'Payment Methods', description: 'Users can pay using credit card or debit card payment methods.' },
  { requirementKey: 'R26', title: 'Payment Failure', description: 'When payment fails, an order must not be created.' },
  { requirementKey: 'R27', title: 'Payment Success', description: 'After successful payment an order is created.' },
  { requirementKey: 'R28', title: 'Confirm Email', description: 'The user should receive an order confirmation email.' },
  { requirementKey: 'R29', title: 'Add To Cart', description: 'Users should be able to add an available product to their cart.' },
  { requirementKey: 'R30', title: 'Filter', description: 'Users should also be able to filter products by category and price.' },
];

const rels = toCanonicalRelationships(reqs);
const degree = Object.fromEntries(reqs.map((r) => [r.requirementKey, 0]));
for (const e of rels) {
  degree[e.sourceRequirementId] += 1;
  degree[e.targetRequirementId] += 1;
}
const degrees = Object.values(degree);
const avg = degrees.reduce((a, b) => a + b, 0) / degrees.length;
const kinds = {};
for (const e of rels) kinds[e.relationship] = (kinds[e.relationship] || 0) + 1;

const by = (a, b) => analyzeRelationship(a, b);
const find = (k) => reqs.find((r) => r.requirementKey === k);

console.log(
  JSON.stringify(
    {
      n: reqs.length,
      edges: rels.length,
      avgDegree: Number(avg.toFixed(2)),
      kinds,
      falseChecks: {
        openVsSearch: by(find('R17'), find('R8')),
        oosVsOtp: by(find('R15'), find('R6')),
        oosVsCart: by(find('R15'), find('R29')),
        openCapability: normalizeRequirement(find('R17')).capability,
      },
      otpQuestions: analyzeRequirement({
        requirementKey: 'R7',
        title: 'OTP Delivery',
        description: "The OTP will be sent to the user's registered email address.",
        type: 'FUNCTIONAL',
      }).questions.map((q) => q.question),
      regQuestions: analyzeRequirement({
        requirementKey: 'R1',
        title: 'User Registration',
        description: 'Users can register using their email and password.',
        type: 'FUNCTIONAL',
      }).questions.map((q) => q.question),
    },
    null,
    2,
  ),
);
