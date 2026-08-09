import type { AgentHandler } from '@qaforge/agent-sdk';
import { ArtifactType } from '@qaforge/shared';

export type EnvironmentChecklistItem = {
  id: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'MANUAL';
  detail: string;
};

export type EnvironmentDocument = {
  appUrl: string;
  loginUrl: string;
  browserMode: 'CLOUD_HEADLESS' | 'CLOUD_HEADED';
  environment: string;
  framework: string;
  language: string;
  checklist: EnvironmentChecklistItem[];
  credentials: {
    configured: boolean;
    notes: string;
  };
  summary: string;
  validation: {
    passed: boolean;
    blockers: string[];
    summary: string;
  };
};

type EnvironmentInput = {
  appUrl?: string | null;
  loginUrl?: string | null;
  environment?: string | null;
  framework?: string | null;
  language?: string | null;
  browserMode?: 'CLOUD_HEADLESS' | 'CLOUD_HEADED' | null;
  hasEncryptedConfig?: boolean;
};

async function probeUrl(
  url: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'QAForge-EnvironmentAgent/1.0' },
    });
    clearTimeout(timer);
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const environmentAgent: AgentHandler<
  EnvironmentInput,
  EnvironmentDocument
> = {
  id: 'ENVIRONMENT_SETUP',
  name: 'AI Environment Agent',

  async run(ctx, input) {
    await ctx.emit({
      type: 'environment.preparing',
      phase: 'ENVIRONMENT',
      message:
        'Senior QA verifying test environment (URL, browser mode, credentials)',
    });

    const appUrl =
      (typeof input.appUrl === 'string' && input.appUrl.trim()) ||
      (typeof input.loginUrl === 'string' && input.loginUrl.trim()) ||
      '';
    const loginUrl =
      (typeof input.loginUrl === 'string' && input.loginUrl.trim()) || appUrl;
    const browserMode = input.browserMode ?? 'CLOUD_HEADLESS';

    const checklist: EnvironmentChecklistItem[] = [];
    const blockers: string[] = [];

    if (!appUrl) {
      checklist.push({
        id: 'app-url',
        label: 'Application URL configured',
        status: 'FAIL',
        detail: 'Project appUrl / loginUrl is missing',
      });
      blockers.push('Application URL is required before execution');
    } else {
      checklist.push({
        id: 'app-url',
        label: 'Application URL configured',
        status: 'PASS',
        detail: appUrl,
      });
      const probe = await probeUrl(appUrl);
      if (probe.ok) {
        checklist.push({
          id: 'url-reachable',
          label: 'Application URL reachable',
          status: 'PASS',
          detail: `HTTP ${probe.status ?? 'ok'}`,
        });
      } else {
        checklist.push({
          id: 'url-reachable',
          label: 'Application URL reachable',
          status: 'WARN',
          detail: probe.error ?? `HTTP ${probe.status ?? 'unknown'}`,
        });
      }
    }

    checklist.push({
      id: 'browser-mode',
      label: 'Browser mode selected',
      status: 'PASS',
      detail: `${browserMode} (cloud worker)`,
    });

    checklist.push({
      id: 'framework',
      label: 'Automation framework',
      status: 'PASS',
      detail: `${input.framework ?? 'PLAYWRIGHT'} / ${input.language ?? 'TYPESCRIPT'}`,
    });

    const credsOk = Boolean(input.hasEncryptedConfig);
    checklist.push({
      id: 'credentials',
      label: 'Test credentials available',
      status: credsOk ? 'PASS' : 'MANUAL',
      detail: credsOk
        ? 'Encrypted project config present'
        : 'No encrypted config — provide credentials at login gate or mark as public app',
    });

    checklist.push({
      id: 'environment-name',
      label: 'Target environment',
      status: 'PASS',
      detail: input.environment ?? 'QA',
    });

    const passed = blockers.length === 0;
    const validation = {
      passed,
      blockers,
      summary: passed
        ? `Environment ready for ${browserMode} execution`
        : `Environment blocked: ${blockers.join('; ')}`,
    };

    const document: EnvironmentDocument = {
      appUrl,
      loginUrl,
      browserMode,
      environment: input.environment ?? 'QA',
      framework: input.framework ?? 'PLAYWRIGHT',
      language: input.language ?? 'TYPESCRIPT',
      checklist,
      credentials: {
        configured: credsOk,
        notes: credsOk
          ? 'Credentials stored in project encrypted config'
          : 'Human should confirm login approach before execution',
      },
      summary: validation.summary,
      validation,
    };

    await ctx.putArtifactJson(ArtifactType.ENVIRONMENT_JSON, document);
    await ctx.emit({
      type: 'environment.ready',
      phase: 'ENVIRONMENT',
      message: validation.summary,
      data: { passed, itemCount: checklist.length },
    });

    return document;
  },
};
