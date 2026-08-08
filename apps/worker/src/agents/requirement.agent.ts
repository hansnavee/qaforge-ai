import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

type RequirementInput = {
  requirementText?: string | null;
  documents?: Array<{
    storageKey: string;
    mime: string;
    filename: string;
    parsedText?: string | null;
  }>;
  appUrl: string;
};

function heuristicRequirements(text: string, appUrl: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

  const requirements = lines.length
    ? lines.map((line, i) => ({
        id: `REQ-${String(i + 1).padStart(3, '0')}`,
        title: line.slice(0, 80),
        description: line,
        priority: i < 3 ? 'high' : 'medium',
        acceptanceCriteria: [`Verify: ${line.slice(0, 60)}`],
      }))
    : [
        {
          id: 'REQ-001',
          title: 'Core application availability',
          description: `Application at ${appUrl} should load and expose primary workflows.`,
          priority: 'high',
          acceptanceCriteria: ['Home page loads', 'Primary navigation is reachable'],
        },
      ];

  return {
    businessRules: requirements.map((r) => r.title),
    risks: [
      'Authentication edge cases may be under-specified',
      'Cross-browser behavior not explicitly covered',
    ],
    coverageAreas: ['authentication', 'navigation', 'forms', 'critical paths'],
    requirements,
    source: 'heuristic',
  };
}

async function extractDocumentText(
  store: { get: (key: string) => Promise<Buffer> },
  doc: {
    storageKey: string;
    mime: string;
    filename: string;
    parsedText?: string | null;
  },
): Promise<string> {
  if (doc.parsedText?.trim()) return doc.parsedText;
  const lower = doc.filename.toLowerCase();
  try {
    const buf = await store.get(doc.storageKey);

    if (
      doc.mime === 'text/plain' ||
      doc.mime === 'text/markdown' ||
      lower.endsWith('.txt') ||
      lower.endsWith('.md') ||
      lower.endsWith('.text')
    ) {
      return buf.toString('utf8');
    }

    if (doc.mime === 'application/pdf' || lower.endsWith('.pdf')) {
      const parsed = await pdfParse(buf);
      return parsed.text ?? '';
    }

    if (
      doc.mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.docx')
    ) {
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value ?? '';
    }
  } catch {
    /* skip unreadable document */
  }
  return '';
}

export const requirementAgent: AgentHandler<RequirementInput, unknown> = {
  id: 'REQUIREMENT_ANALYSIS',
  name: 'Requirement Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'requirements.parsing',
      phase: 'REQUIREMENTS',
      message: 'Parsing requirements text and documents',
    });

    let text = input.requirementText?.trim() ?? '';

    for (const doc of input.documents ?? []) {
      const extracted = await extractDocumentText(ctx.artifactStore, doc);
      if (extracted.trim()) {
        text += `\n\n# Document: ${doc.filename}\n${extracted}`;
      }
    }

    let output: unknown;
    try {
      const llm = await ctx.llm.complete({
        system:
          'You are a QA requirements analyst. Extract business rules, risks, and coverage areas as JSON.',
        prompt: `App URL: ${input.appUrl}\n\nRequirements:\n${text || '(none provided — infer sensible defaults)'}\n\nReturn JSON: { businessRules: string[], risks: string[], coverageAreas: string[], requirements: [{id,title,description,priority,acceptanceCriteria:string[]}] }`,
        json: true,
        model: 'fast',
      });
      output = JSON.parse(llm.text);
    } catch {
      output = heuristicRequirements(text, input.appUrl);
    }

    if (!output || typeof output !== 'object') {
      output = heuristicRequirements(text, input.appUrl);
    }

    await ctx.putArtifactJson(ArtifactType.REQUIREMENTS_JSON, output);
    await ctx.emit({
      type: 'requirements.ready',
      phase: 'REQUIREMENTS',
      message: 'Requirements artifact written',
    });
    return output;
  },
};
