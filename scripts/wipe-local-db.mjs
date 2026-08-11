/**
 * Wipe local Postgres app data; keep admin auth (User/Account/Org/Membership/Subscription).
 * Usage: node scripts/wipe-local-db.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(join(root, '.env'), 'utf8').replace(/^\uFEFF/, '');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m || process.env[m[1]]) continue;
  process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const require = createRequire(join(root, 'packages/database/package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function countAll() {
  const keys = [
    'project',
    'requirement',
    'requirementDocument',
    'featureGroup',
    'requirementQuestion',
    'requirementConflict',
    'requirementRelation',
    'execution',
    'testCase',
    'testResult',
    'bug',
    'agentRun',
    'artifact',
    'artifactBlob',
    'browserSession',
    'auditLog',
    'usageEvent',
    'clarificationRound',
    'projectRequirementSnapshot',
    'githubPush',
    'user',
    'organization',
  ];
  const out = {};
  for (const k of keys) {
    try {
      out[k] = await prisma[k].count();
    } catch {
      out[k] = 'n/a';
    }
  }
  return out;
}

async function main() {
  const before = await countAll();
  console.log('before', before);

  // Order: children that may not cascade cleanly, then projects (cascades rest)
  await prisma.$transaction(async (tx) => {
    await tx.githubPush.deleteMany({});
    await tx.browserSession.deleteMany({});
    await tx.artifactBlob.deleteMany({});
    await tx.artifact.deleteMany({});
    await tx.agentRun.deleteMany({});
    await tx.bug.deleteMany({});
    await tx.testResult.deleteMany({});
    await tx.testCase.deleteMany({});
    await tx.requirementRelation.deleteMany({});
    await tx.requirementConflict.deleteMany({});
    await tx.requirementQuestion.deleteMany({});
    await tx.requirement.deleteMany({});
    await tx.featureGroup.deleteMany({});
    await tx.requirementDocument.deleteMany({});
    await tx.projectRequirementSnapshot.deleteMany({});
    await tx.clarificationRound.deleteMany({});
    await tx.execution.deleteMany({});
    await tx.project.deleteMany({});
    await tx.auditLog.deleteMany({});
    await tx.usageEvent.deleteMany({});
    await tx.verification.deleteMany({});
    await tx.session.deleteMany({});
  });

  const after = await countAll();
  console.log('after', after);
  console.log('kept users/orgs for login');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
