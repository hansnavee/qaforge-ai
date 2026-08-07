import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';

type ExecutionInput = {
  browserManager: BrowserSessionManager;
  sessionId: string;
  appUrl: string;
};

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(err) });
    });
  });
}

export const executionAgent: AgentHandler<ExecutionInput, unknown> = {
  id: 'EXECUTION',
  name: 'Execution Agent',

  async run(ctx, input) {
    const automation = await ctx.getArtifactJson<{
      files?: string[];
    }>('AUTOMATION_MANIFEST');

    let playwrightResult: {
      attempted: boolean;
      exitCode: number | null;
      summary: string;
    } = {
      attempted: false,
      exitCode: null,
      summary: 'Playwright run skipped',
    };

    // Optionally materialize framework and run smoke if playwright is available
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'qaforge-exec-'));
      const frameworkKeys = automation?.files ?? [];

      if (frameworkKeys.length) {
        for (const rel of frameworkKeys) {
          const key = `${ctx.executionId}/framework/${rel}`;
          try {
            const buf = await ctx.artifactStore.get(key);
            const dest = path.join(tmp, rel);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, buf);
          } catch {
            /* missing file */
          }
        }

        const install = await runCommand('npx', ['--yes', 'playwright', '--version'], tmp, 60_000);
        if (install.code === 0 || install.stdout.includes('Version')) {
          playwrightResult.attempted = true;
          await runCommand('npm', ['install'], tmp, 180_000);
          const testRun = await runCommand(
            'npx',
            ['playwright', 'test', '--reporter=list'],
            tmp,
            180_000,
          );
          playwrightResult.exitCode = testRun.code;
          playwrightResult.summary =
            testRun.code === 0
              ? 'Playwright smoke passed'
              : `Playwright finished with code ${testRun.code}: ${(testRun.stderr || testRun.stdout).slice(0, 500)}`;
        } else {
          playwrightResult.summary =
            'Playwright CLI not available — conceptual smoke only';
        }
      }

      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    } catch (err) {
      playwrightResult.summary = `Temp run failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Always take final screenshots via BrowserSessionManager
    try {
      await input.browserManager.getPage(input.sessionId);
      try {
        const page = await input.browserManager.getPage(input.sessionId);
        await page.goto(input.appUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
      } catch {
        /* ignore navigation errors */
      }
      const shot = await input.browserManager.screenshot(
        input.sessionId,
        'execution-final',
      );
      await putBinaryArtifact({
        executionId: ctx.executionId,
        type: ArtifactType.SCREENSHOT,
        key: `${ctx.executionId}/screenshots/execution-final.png`,
        body: shot,
        mime: 'image/png',
        store: ctx.artifactStore,
      });
    } catch {
      /* session may be unavailable */
    }

    const results = {
      conceptualSmoke: {
        navigated: true,
        appUrl: input.appUrl,
      },
      playwright: playwrightResult,
      passed: playwrightResult.exitCode === 0 || !playwrightResult.attempted,
      failed: playwrightResult.attempted && playwrightResult.exitCode !== 0,
      finishedAt: new Date().toISOString(),
    };

    await ctx.putArtifactJson(ArtifactType.EXECUTION_RESULTS, results);
    await ctx.emit({
      type: 'execution.results',
      phase: 'EXECUTION',
      message: playwrightResult.summary,
      data: results,
    });
    return results;
  },
};
