import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export type ClarificationQuestion = {
  id: string;
  question: string;
  reason: string;
  required?: boolean;
};

type ClarificationInput = {
  requirementText?: string | null;
  appUrl: string;
};

function heuristicQuestions(
  text: string,
  appUrl: string,
  requirements: Array<{ title?: string; acceptanceCriteria?: string[] }>,
): ClarificationQuestion[] {
  const lower = text.toLowerCase();
  const questions: ClarificationQuestion[] = [];
  const push = (q: ClarificationQuestion) => {
    if (questions.length < 8) questions.push(q);
  };

  if (!text.trim() || text.trim().length < 80) {
    push({
      id: 'CQ-001',
      question:
        'What are the primary user journeys that must be covered in this QA run?',
      reason: 'Requirements text is thin or missing.',
      required: true,
    });
  }

  if (!/(login|sign[\s-]?in|auth|sso|oauth)/i.test(lower)) {
    push({
      id: 'CQ-002',
      question:
        'How do users authenticate (email/password, SSO, magic link), and which roles should be tested?',
      reason: 'Authentication details are not specified.',
      required: true,
    });
  }

  if (!/(role|admin|permission|rbac)/i.test(lower)) {
    push({
      id: 'CQ-003',
      question: 'Which user roles and permissions matter for this application?',
      reason: 'Role/permission coverage is unclear.',
    });
  }

  if (!/(env|staging|qa|uat|production|browser)/i.test(lower)) {
    push({
      id: 'CQ-004',
      question:
        'Which environments and browsers should be considered in scope for this run?',
      reason: 'Environment / browser scope is unspecified.',
    });
  }

  if (!/(error|edge|negative|invalid|empty)/i.test(lower)) {
    push({
      id: 'CQ-005',
      question:
        'Are there critical negative / edge cases (invalid input, empty states, timeouts) that must be covered?',
      reason: 'Edge-case expectations are missing.',
    });
  }

  const vagueAc = requirements.some(
    (r) =>
      !r.acceptanceCriteria?.length ||
      r.acceptanceCriteria.every((c) => c.length < 20),
  );
  if (vagueAc || requirements.length === 0) {
    push({
      id: 'CQ-006',
      question:
        'What does “done” look like for the top flows (concrete acceptance criteria)?',
      reason: 'Acceptance criteria are vague or missing.',
      required: true,
    });
  }

  if (questions.length === 0) {
    push({
      id: 'CQ-007',
      question: `Any out-of-scope areas for ${appUrl} that QA should ignore this run?`,
      reason: 'Confirm scope boundaries before generating tests.',
    });
  }

  return questions;
}

export const clarificationAgent: AgentHandler<
  ClarificationInput,
  { questions: ClarificationQuestion[] }
> = {
  id: 'REQUIREMENT_CLARIFICATION',
  name: 'Requirement Clarification Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'clarification.analyzing',
      phase: 'CLARIFICATION',
      message: 'Detecting requirement gaps and drafting clarifying questions',
    });

    const requirementsDoc = await ctx.getArtifactJson<{
      requirements?: Array<{
        title?: string;
        description?: string;
        acceptanceCriteria?: string[];
      }>;
      risks?: string[];
      coverageAreas?: string[];
    }>(ArtifactType.REQUIREMENTS_JSON);

    const text = input.requirementText?.trim() ?? '';
    let questions: ClarificationQuestion[] = [];

    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a senior QA engineer. Given app requirements, ask concise clarifying questions to remove gaps before test design. Return JSON only.',
        prompt: `App URL: ${input.appUrl}\n\nRequirement text:\n${text || '(none)'}\n\nParsed requirements JSON:\n${JSON.stringify(requirementsDoc)}\n\nReturn JSON: { questions: [{ id: string, question: string, reason: string, required?: boolean }] } with 3-8 questions.`,
        json: true,
        model: 'fast',
      });
      const parsed = JSON.parse(llm.text) as {
        questions?: ClarificationQuestion[];
      };
      if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        questions = parsed.questions.slice(0, 8).map((q, i) => ({
          id: q.id || `CQ-${String(i + 1).padStart(3, '0')}`,
          question: q.question,
          reason: q.reason || 'Requirement gap',
          required: q.required,
        }));
      }
    } catch {
      /* heuristic fallback */
    }

    if (questions.length === 0) {
      questions = heuristicQuestions(
        text,
        input.appUrl,
        requirementsDoc?.requirements ?? [],
      );
    }

    const output = { questions, appUrl: input.appUrl, generatedAt: new Date().toISOString() };
    await ctx.putArtifactJson(ArtifactType.CLARIFICATION_QUESTIONS, output);
    await ctx.emit({
      type: 'clarification.questions_ready',
      phase: 'CLARIFICATION',
      message: `Prepared ${questions.length} clarifying question(s) — waiting for answers`,
      data: { count: questions.length },
    });

    return { questions };
  },
};
