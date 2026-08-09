/**
 * Piece 2.3 — run fresh semantic analysis against the DB (Railway proxy).
 * Usage: node scripts/piece23-reanalyze.mjs [projectId]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const require = createRequire(path.join(root, 'packages/database/package.json'));
const { PrismaClient } = require('@prisma/client');
const shared = await import(
  pathToFileURL(path.join(root, 'packages/shared/dist/index.js')).href
);

const {
  toCanonicalRelationships,
  detectSemanticRelations,
  groupRequirementsIntoFeatures,
  FEATURE_DEPENDENCY_EDGES,
  SEMANTIC_ANALYSIS_ENGINE,
  SEMANTIC_ANALYSIS_VERSION,
} = shared;

const projectId = process.argv[2] || 'cmslherzx0001pn014vipn580';
const prisma = new PrismaClient();

const ACCEPT = [
  ['REQ-032', 'REQ-014', 'NOT_DUPLICATE'],
  ['REQ-034', 'REQ-032', 'RELATED'],
  ['REQ-035', 'REQ-033', 'RELATED'],
  ['REQ-027', 'REQ-026', 'RELATED'],
  ['REQ-011', 'REQ-010', ['RELATED', 'PRECEDES']],
];

function findRel(rels, a, b) {
  return rels.find(
    (r) =>
      (r.sourceRequirementId === a && r.targetRequirementId === b) ||
      (r.sourceRequirementId === b && r.targetRequirementId === a),
  );
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  console.log(`Project: ${project.name}`);

  const requirements = await prisma.requirement.findMany({
    where: { projectId },
    orderBy: { requirementKey: 'asc' },
  });
  console.log(`Requirements: ${requirements.length}`);

  await prisma.requirementQuestion.deleteMany({
    where: { projectId, status: 'OPEN' },
  });
  await prisma.requirementConflict.deleteMany({
    where: { projectId, status: 'OPEN' },
  });
  await prisma.requirementRelation.deleteMany({ where: { projectId } });
  await prisma.featureGroup.deleteMany({ where: { projectId } });
  await prisma.requirement.updateMany({
    where: { projectId },
    data: {
      featureGroupId: null,
      possibleDuplicateOf: null,
      duplicateSimilarity: null,
      duplicateKind: null,
      duplicateReason: null,
      relationships: [],
    },
  });

  const analysisId = `ANL-${randomUUID().slice(0, 8)}`;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      analysisId,
      analysisVersion: SEMANTIC_ANALYSIS_VERSION,
      analysisEngine: SEMANTIC_ANALYSIS_ENGINE,
      analysisStatus: 'RUNNING',
      analysisMeta: {
        status: 'RUNNING',
        engine: SEMANTIC_ANALYSIS_ENGINE,
        version: SEMANTIC_ANALYSIS_VERSION,
        startedAt: new Date().toISOString(),
      },
    },
  });

  const featureDrafts = groupRequirementsIntoFeatures(
    requirements.map((r) => ({
      requirementKey: r.requirementKey,
      title: r.title,
      description: r.description,
      sourceSection: r.sourceSection,
      sourceText: r.sourceText,
    })),
  );

  const featureMetaByReq = new Map();
  const featureNameToId = new Map();
  const featureNameToReqKeys = new Map();
  for (const fg of featureDrafts) {
    const created = await prisma.featureGroup.create({
      data: {
        projectId,
        featureKey: fg.featureKey,
        name: fg.name,
        businessArea: fg.businessArea,
        businessCapability: fg.businessCapability ?? null,
        businessIntent: fg.businessIntent ?? null,
        businessImpact: 'MEDIUM',
        analysis: { dependsOn: [], affects: [], relatedTo: [] },
      },
    });
    featureNameToId.set(fg.name, created.id);
    featureNameToReqKeys.set(fg.name, fg.requirementKeys);
    for (const reqKey of fg.requirementKeys) {
      featureMetaByReq.set(reqKey, {
        featureName: fg.name,
        businessArea: fg.businessArea,
      });
      await prisma.requirement.updateMany({
        where: { projectId, requirementKey: reqKey },
        data: { featureGroupId: created.id },
      });
    }
  }

  const keyToId = new Map(requirements.map((r) => [r.requirementKey, r.id]));
  for (const [fromName, toName] of FEATURE_DEPENDENCY_EDGES) {
    const fromFeatureId = featureNameToId.get(fromName);
    const toFeatureId = featureNameToId.get(toName);
    if (!fromFeatureId || !toFeatureId) continue;
    await prisma.featureGroup.update({
      where: { id: fromFeatureId },
      data: {
        analysis: { dependsOn: [toName], affects: [], relatedTo: [] },
      },
    });
  }

  const comparable = requirements.map((r) => ({
    requirementKey: r.requirementKey,
    title: r.title,
    description: r.description,
    sourceText: r.sourceText,
    featureName: featureMetaByReq.get(r.requirementKey)?.featureName,
    businessArea: featureMetaByReq.get(r.requirementKey)?.businessArea,
    type: r.type,
  }));

  const canonical = toCanonicalRelationships(comparable);
  console.log(`Canonical relationships: ${canonical.length}`);

  const relsByKey = new Map();
  for (const rel of canonical) {
    const list = relsByKey.get(rel.sourceRequirementId) ?? [];
    list.push(rel);
    relsByKey.set(rel.sourceRequirementId, list);
    const mirror = {
      ...rel,
      sourceRequirementId: rel.targetRequirementId,
      targetRequirementId: rel.sourceRequirementId,
    };
    const listB = relsByKey.get(rel.targetRequirementId) ?? [];
    listB.push(mirror);
    relsByKey.set(rel.targetRequirementId, listB);
  }

  for (const [reqKey, rels] of relsByKey) {
    const reqId = keyToId.get(reqKey);
    if (!reqId) continue;
    const dupLike = rels.find(
      (r) =>
        r.relationship === 'DUPLICATE' ||
        r.relationship === 'POSSIBLE_DUPLICATE',
    );
    const related = rels.find(
      (r) => r.relationship === 'RELATED' || r.relationship === 'PRECEDES',
    );
    await prisma.requirement.update({
      where: { id: reqId },
      data: {
        relationships: rels,
        possibleDuplicateOf: dupLike?.targetRequirementId ?? null,
        duplicateSimilarity: null,
        duplicateKind: dupLike
          ? dupLike.relationship
          : related
            ? 'RELATED'
            : rels.some((r) => r.relationship === 'NOT_DUPLICATE')
              ? 'NOT_DUPLICATE'
              : null,
        duplicateReason:
          dupLike?.reason ?? related?.reason ?? rels[0]?.reason ?? null,
      },
    });
  }

  const semanticPairs = detectSemanticRelations(comparable);
  for (const pair of semanticPairs) {
    const aId = keyToId.get(pair.requirementKeyA);
    const bId = keyToId.get(pair.requirementKeyB);
    if (!aId || !bId) continue;
    if (pair.kind === 'NOT_DUPLICATE' || pair.kind === 'NOT_RELATED') continue;
    const relationType =
      pair.relationType === 'PRECEDES'
        ? 'PRECEDES'
        : pair.kind === 'DUPLICATE'
          ? 'DUPLICATE_OF'
          : pair.kind === 'POSSIBLE_DUPLICATE'
            ? 'OVERLAPS'
            : pair.kind === 'DEPENDS_ON'
              ? 'DEPENDS_ON'
              : 'RELATED_TO';
    try {
      await prisma.requirementRelation.create({
        data: {
          projectId,
          fromRequirementId: pair.relationType === 'PRECEDES' ? aId : bId,
          toRequirementId: pair.relationType === 'PRECEDES' ? bId : aId,
          relationType,
          confidence: null,
          source: 'REVIEW',
          detail: pair.reason,
        },
      });
    } catch {
      // unique
    }
  }

  const completedAt = new Date();
  await prisma.project.update({
    where: { id: projectId },
    data: {
      analysisStatus: 'COMPLETED',
      analysisCompletedAt: completedAt,
      analysisError: null,
      analysisId,
      analysisVersion: SEMANTIC_ANALYSIS_VERSION,
      analysisEngine: SEMANTIC_ANALYSIS_ENGINE,
      analysisMeta: {
        status: 'COMPLETED',
        engine: SEMANTIC_ANALYSIS_ENGINE,
        version: SEMANTIC_ANALYSIS_VERSION,
        analysisId,
        analyzedAt: completedAt.toISOString(),
        relationshipCount: canonical.length,
      },
    },
  });

  console.log('\n=== ACCEPTANCE ===');
  let ok = true;
  for (const [a, b, expected] of ACCEPT) {
    const hit = findRel(canonical, a, b);
    const exp = Array.isArray(expected) ? expected : [expected];
    const pass = hit && exp.includes(hit.relationship);
    console.log(
      `${pass ? 'PASS' : 'FAIL'} ${a} ↔ ${b} → ${hit?.relationship ?? 'MISSING'} (expected ${exp.join('|')})`,
    );
    if (hit?.reason) console.log(`  reason: ${hit.reason.split('\n')[0]}`);
    if (!pass) ok = false;
  }

  // Sample UI-critical rows
  for (const key of ['REQ-032', 'REQ-034', 'REQ-035', 'REQ-027', 'REQ-011']) {
    const row = await prisma.requirement.findFirst({
      where: { projectId, requirementKey: key },
    });
    console.log(
      `DB ${key}: kind=${row.duplicateKind} dupOf=${row.possibleDuplicateOf} sim=${row.duplicateSimilarity} rels=${Array.isArray(row.relationships) ? row.relationships.length : 0}`,
    );
  }

  const p2 = await prisma.project.findUnique({ where: { id: projectId } });
  console.log(
    `\nAnalysis ${p2.analysisId} engine=${p2.analysisEngine} v=${p2.analysisVersion}`,
  );
  if (!ok) process.exit(1);
  console.log('\nFresh semantic analysis persisted.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
