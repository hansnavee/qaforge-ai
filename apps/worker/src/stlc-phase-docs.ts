import {
  buildPhaseDocState,
  upsertPhaseDoc,
  type PhaseValidation,
  type StlcPhaseDocsMap,
  type StlcPhaseId,
} from '@qaforge/shared';
import { prisma } from '@qaforge/database';

type PhaseId = Exclude<StlcPhaseId, 'DONE'>;

export async function persistPhaseDocument(opts: {
  projectId: string;
  phaseId: PhaseId;
  status: 'RUNNING' | 'READY_FOR_REVIEW' | 'ACCEPTED' | 'FAILED';
  document: Record<string, unknown>;
  validation?: PhaseValidation | null;
}): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    select: { stlcPhaseDocs: true },
  });
  const map = (project?.stlcPhaseDocs ?? {}) as StlcPhaseDocsMap;
  const previous = map[opts.phaseId] ?? null;
  const state = buildPhaseDocState({
    phaseId: opts.phaseId,
    status: opts.status,
    document: opts.document,
    validation: opts.validation,
    previous,
    editedByHuman: previous?.editedByHuman ?? false,
  });
  // Keep version bump sensible when first write
  if (!previous) {
    state.documentVersion = 1;
  }
  const next = upsertPhaseDoc(map, state);
  await prisma.project.update({
    where: { id: opts.projectId },
    data: { stlcPhaseDocs: next as never },
  });
}
