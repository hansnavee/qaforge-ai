import type { LlmClient } from '../types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODEL_MAP = {
  fast: 'openai/gpt-4o-mini',
  reasoning: 'anthropic/claude-sonnet-4',
} as const;

function mockComplete(opts: {
  system?: string;
  prompt: string;
  json?: boolean;
}): { text: string; tokensUsed: number } {
  const haystack = `${opts.system ?? ''}\n${opts.prompt}`.toLowerCase();

  if (opts.json) {
    const payload = mockJsonForPrompt(haystack);
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

function mockJsonForPrompt(haystack: string): unknown {
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

    const model = MODEL_MAP[opts.model ?? 'fast'];
    const messages: Array<{ role: string; content: string }> = [];
    if (opts.system) {
      messages.push({ role: 'system', content: opts.system });
    }
    messages.push({ role: 'user', content: opts.prompt });

    const body: Record<string, unknown> = {
      model,
      messages,
    };
    if (opts.json) {
      body.response_format = { type: 'json_object' };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.siteUrl) {
      headers['HTTP-Referer'] = this.siteUrl;
    }
    headers['X-Title'] = this.appName;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `OpenRouter request failed (${response.status}): ${errText || response.statusText}`,
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
