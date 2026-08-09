import { extractRequirementsFromSource } from '@qaforge/shared';
import type { LlmClient } from '../types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Default to OpenRouter free-tier models for testing (no paid GPT/Claude).
 * Override anytime with:
 *   OPENROUTER_MODEL_FAST
 *   OPENROUTER_MODEL_REASONING
 * Or set OPENROUTER_USE_FREE=false and paid IDs to restore previous behavior.
 *
 * Note: Cursor subscription models are not available as an external API —
 * this stack uses OpenRouter only.
 */
function resolveModelMap(): Record<'fast' | 'reasoning', string> {
  const useFree = (process.env.OPENROUTER_USE_FREE ?? 'true').toLowerCase() !== 'false';
  const paid = {
    fast: 'openai/gpt-4o-mini',
    reasoning: 'anthropic/claude-sonnet-4',
  } as const;
  const free = {
    // Fast/general JSON-friendly free model (availability rotates on OpenRouter)
    fast: 'google/gemma-4-26b-a4b-it:free',
    // Stronger free model for design / case generation
    reasoning: 'openai/gpt-oss-20b:free',
  } as const;
  const base = useFree ? free : paid;
  return {
    fast: process.env.OPENROUTER_MODEL_FAST?.trim() || base.fast,
    reasoning: process.env.OPENROUTER_MODEL_REASONING?.trim() || base.reasoning,
  };
}

function mockComplete(opts: {
  system?: string;
  prompt: string;
  json?: boolean;
}): { text: string; tokensUsed: number } {
  const haystack = `${opts.system ?? ''}\n${opts.prompt}`.toLowerCase();

  if (opts.json) {
    const payload = mockJsonForPrompt(haystack, opts.prompt);
    const text = JSON.stringify(payload);
    return { text, tokensUsed: Math.max(32, Math.ceil(text.length / 4)) };
  }

  if (haystack.includes('summary') || haystack.includes('executive')) {
    return {
      text: 'QAForge mock summary: application under test shows stable core flows with a few medium-priority accessibility and performance findings. Prioritize login reliability, form validation, and critical path coverage before release.',
      tokensUsed: 64,
    };
  }

  return {
    text: 'QAForge offline mock response. Set OPENROUTER_API_KEY to enable live LLM completions.',
    tokensUsed: 24,
  };
}

function mockExtractFromPrompt(prompt: string): unknown | null {
  const block = prompt.match(/"""([\s\S]*?)"""/);
  const source = (block?.[1] ?? '').trim();
  if (!source) return null;

  const docMatch = prompt.match(/Source document name:\s*(.+)/i);
  const document = docMatch?.[1]?.trim() || 'source';

  // Prefer structured parsed-document prompt when present
  if (prompt.includes('"elements"') && prompt.includes('Parsed document')) {
    // Reconstruct source-ish extraction from baseline pipeline via original paragraphs
    // Mock still runs full source extract when """ block present; else empty.
  }

  const extracted = extractRequirementsFromSource(source, document);
  if (!extracted.requirements.length) {
    return {
      requirements: [],
      documentElements: extracted.documentElements,
    };
  }
  return {
    requirements: extracted.requirements.map((r) => ({
      ...r,
      section: r.source.section,
      sourceText: r.source.text,
    })),
    documentElements: extracted.documentElements,
  };
}

function mockStructuredSemanticsFromPrompt(prompt: string): unknown {
  try {
    const jsonMatch = prompt.match(/Requirements:\s*(\[[\s\S]*\])/i);
    const rows = jsonMatch ? (JSON.parse(jsonMatch[1]!) as Array<Record<string, unknown>>) : [];
    // Lazy require to avoid circular init issues in some runners
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('@qaforge/shared') as typeof import('@qaforge/shared');
    return {
      requirements: rows.map((r) => {
        const s = shared.extractStructuredSemanticsHeuristic({
          requirementKey: String(r.requirementKey ?? ''),
          title: String(r.title ?? ''),
          description: String(r.description ?? ''),
          sourceText: (r.sourceText as string | null) ?? null,
          type: (r.type as string | null) ?? null,
        });
        return {
          requirementKey: r.requirementKey,
          actor: s.actor.toUpperCase(),
          action: s.action.toUpperCase(),
          object: s.object.toUpperCase(),
          condition: s.condition,
          polarity: s.polarity,
          requirementType: s.requirementType,
          capability: s.capability.toUpperCase(),
          confidence: s.confidence,
        };
      }),
    };
  } catch {
    return { requirements: [] };
  }
}

function mockAiFeatureGroupsFromPrompt(prompt: string): unknown {
  try {
    const jsonMatch = prompt.match(/Requirements:\s*(\[[\s\S]*\])/i);
    const rows = jsonMatch
      ? (JSON.parse(jsonMatch[1]!) as Array<Record<string, unknown>>)
      : [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('@qaforge/shared') as typeof import('@qaforge/shared');
    const drafts = shared.groupRequirementsIntoFeatures(
      rows.map((r) => ({
        requirementKey: String(r.requirementKey ?? ''),
        title: String(r.title ?? ''),
        description: String(r.description ?? ''),
        sourceText: (r.sourceText as string | null) ?? null,
        sourceSection: null,
        type: (r.type as string | null) ?? null,
      })),
    );
    return {
      features: drafts.map((d) => ({
        name: d.name,
        businessArea: d.businessArea,
        businessCapability: d.businessCapability,
        businessIntent: d.businessIntent,
        requirementKeys: d.requirementKeys,
      })),
    };
  } catch {
    return { features: [] };
  }
}

function mockAiRequirementIntelligenceFromPrompt(prompt: string): unknown {
  try {
    const jsonMatch = prompt.match(/Requirements:\s*(\[[\s\S]*\])/i);
    const rows = jsonMatch
      ? (JSON.parse(jsonMatch[1]!) as Array<Record<string, unknown>>)
      : [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('@qaforge/shared') as typeof import('@qaforge/shared');
    return {
      requirements: rows.map((r) => {
        const analysis = shared.analyzeRequirement({
          requirementKey: String(r.requirementKey ?? ''),
          title: String(r.title ?? ''),
          description: String(r.description ?? ''),
          type: String(r.type ?? 'FUNCTIONAL'),
          sourceText: (r.sourceText as string | null) ?? null,
        });
        return {
          requirementKey: r.requirementKey,
          businessIntent: analysis.businessIntentText,
          businessImpact: analysis.businessImpact,
          primaryType: analysis.primaryType,
          secondaryType: analysis.secondaryType,
          missingInformation: [],
          questions: analysis.questions,
          confidence: 0.82,
        };
      }),
    };
  } catch {
    return { requirements: [] };
  }
}

function mockJsonForPrompt(haystack: string, prompt = ''): unknown {
  // Step 2.6 AI review intelligence — feature grouping
  if (
    haystack.includes('grouping software requirements') ||
    haystack.includes('group these requirements by business capability')
  ) {
    return mockAiFeatureGroupsFromPrompt(prompt);
  }
  // Step 2.6 AI review intelligence — per-requirement analysis
  if (
    haystack.includes('test readiness') ||
    haystack.includes('analyze each requirement for test-readiness')
  ) {
    return mockAiRequirementIntelligenceFromPrompt(prompt);
  }

  // Step 2.5 structured semantic extraction
  if (
    haystack.includes('structured semantics') ||
    (haystack.includes('polarity') &&
      haystack.includes('capability') &&
      haystack.includes('requirementkey'))
  ) {
    return mockStructuredSemanticsFromPrompt(prompt);
  }

  // Piece 2 extraction — parser + semantic extraction (not line-splitting)
  if (
    haystack.includes('requirementkey') ||
    haystack.includes('do not invent') ||
    haystack.includes('semantic') ||
    haystack.includes('parsed document') ||
    haystack.includes('individual requirements')
  ) {
    return mockExtractFromPrompt(prompt) ?? { requirements: [] };
  }

  if (
    haystack.includes('requirement') ||
    haystack.includes('requirements') ||
    haystack.includes('prd')
  ) {
    return {
      requirements: [
        {
          id: 'REQ-001',
          title: 'User authentication',
          description: 'Users can sign in with email and password.',
          priority: 'high',
          acceptanceCriteria: [
            'Valid credentials grant access',
            'Invalid credentials show an error',
          ],
        },
        {
          id: 'REQ-002',
          title: 'Dashboard access',
          description: 'Authenticated users can view the project dashboard.',
          priority: 'high',
          acceptanceCriteria: ['Dashboard loads within 3 seconds'],
        },
        {
          id: 'REQ-003',
          title: 'Form validation',
          description: 'Required fields are validated before submit.',
          priority: 'medium',
          acceptanceCriteria: ['Empty required fields block submission'],
        },
      ],
    };
  }

  if (
    haystack.includes('application-map') ||
    haystack.includes('application map') ||
    haystack.includes('app map') ||
    haystack.includes('sitemap') ||
    haystack.includes('page map')
  ) {
    return {
      pages: [
        {
          path: '/login',
          name: 'Login',
          type: 'auth',
          elements: ['email', 'password', 'submit'],
        },
        {
          path: '/dashboard',
          name: 'Dashboard',
          type: 'authenticated',
          elements: ['nav', 'stats', 'recent-activity'],
        },
        {
          path: '/settings',
          name: 'Settings',
          type: 'authenticated',
          elements: ['profile-form', 'save'],
        },
      ],
      flows: [
        { id: 'flow-login', name: 'Login', steps: ['/login', '/dashboard'] },
        {
          id: 'flow-settings',
          name: 'Update settings',
          steps: ['/dashboard', '/settings'],
        },
      ],
    };
  }

  if (
    haystack.includes('test-case') ||
    haystack.includes('test cases') ||
    haystack.includes('testcases') ||
    haystack.includes('test plan')
  ) {
    return {
      testCases: [
        {
          id: 'TC-001',
          title: 'Successful login',
          category: 'functional',
          priority: 'high',
          steps: [
            'Navigate to /login',
            'Enter valid credentials',
            'Submit form',
          ],
          expected: 'User lands on /dashboard',
        },
        {
          id: 'TC-002',
          title: 'Invalid password rejected',
          category: 'functional',
          priority: 'high',
          steps: [
            'Navigate to /login',
            'Enter invalid password',
            'Submit form',
          ],
          expected: 'Error message is shown; user remains on /login',
        },
        {
          id: 'TC-003',
          title: 'Keyboard navigation on login',
          category: 'accessibility',
          priority: 'medium',
          steps: ['Tab through login controls', 'Activate submit with Enter'],
          expected: 'Focus order is logical and submit is keyboard operable',
        },
      ],
    };
  }

  if (
    haystack.includes('finding') ||
    haystack.includes('defect') ||
    haystack.includes('issue') ||
    haystack.includes('security')
  ) {
    return {
      findings: [
        {
          category: 'accessibility',
          severity: 'medium',
          title: 'Missing form labels',
          description: 'Some inputs lack associated label elements.',
          recommendation: 'Associate each input with a visible or aria label.',
        },
        {
          category: 'performance',
          severity: 'low',
          title: 'Large hero image',
          description: 'Unoptimized image increases LCP.',
          recommendation: 'Serve responsive WebP images with lazy loading.',
        },
      ],
    };
  }

  if (
    haystack.includes('score') ||
    haystack.includes('report') ||
    haystack.includes('summary')
  ) {
    return {
      scores: {
        functional: 82,
        accessibility: 74,
        performance: 78,
        security: 88,
        uiux: 80,
      },
      summary: {
        passed: 12,
        failed: 3,
        total: 15,
      },
      recommendations: [
        'Add automated regression coverage for authentication.',
        'Fix accessibility labeling on primary forms.',
        'Compress hero assets to improve LCP.',
      ],
    };
  }

  return {
    ok: true,
    mock: true,
    message:
      'Deterministic offline mock JSON. Set OPENROUTER_API_KEY for live responses.',
    promptKeywordsDetected: extractKeywords(haystack),
  };
}

function extractKeywords(haystack: string): string[] {
  const keys = [
    'requirements',
    'application-map',
    'test-cases',
    'findings',
    'security',
    'report',
    'summary',
  ];
  return keys.filter((k) => haystack.includes(k));
}

export class OpenRouterLlmClient implements LlmClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly siteUrl: string | undefined;
  private readonly appName: string;

  constructor(opts?: {
    apiKey?: string;
    baseUrl?: string;
    siteUrl?: string;
    appName?: string;
  }) {
    this.apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY;
    this.baseUrl = opts?.baseUrl ?? OPENROUTER_URL;
    this.siteUrl = opts?.siteUrl ?? process.env.OPENROUTER_SITE_URL;
    this.appName = opts?.appName ?? process.env.OPENROUTER_APP_NAME ?? 'QAForge AI';
  }

  async complete(opts: {
    system?: string;
    prompt: string;
    json?: boolean;
    model?: 'fast' | 'reasoning';
  }): Promise<{ text: string; tokensUsed: number }> {
    if (!this.apiKey) {
      return mockComplete(opts);
    }

    const models = resolveModelMap();
    const preferred = models[opts.model ?? 'fast'];
    // Fallback router picks any currently available free model if the pinned
    // free ID was delisted (OpenRouter free catalog churns often).
    const candidates = [preferred, 'openrouter/free'].filter(
      (m, i, arr) => Boolean(m) && arr.indexOf(m) === i,
    );

    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.siteUrl) {
      headers['HTTP-Referer'] = this.siteUrl;
    }
    headers['X-Title'] = this.appName;

    let response: Response | null = null;
    let lastErr = '';
    for (const model of candidates) {
      const body: Record<string, unknown> = {
        model,
        messages,
      };
      // Some free models reject response_format — only request it on first try.
      if (opts.json && model !== 'openrouter/free') {
        body.response_format = { type: 'json_object' };
      }

      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (response.ok) break;
      lastErr = await response.text().catch(() => '');
      // Retry next candidate on model-not-found / unavailable
      if (![404, 400, 502, 503].includes(response.status)) {
        throw new Error(
          `OpenRouter request failed (${response.status}): ${lastErr || response.statusText}`,
        );
      }
    }

    if (!response?.ok) {
      throw new Error(
        `OpenRouter request failed (${response?.status ?? 'n/a'}): ${lastErr || response?.statusText}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { total_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? '';
    const tokensUsed = data.usage?.total_tokens ?? Math.ceil(text.length / 4);

    return { text, tokensUsed };
  }
}
