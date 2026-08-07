import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';
import { putBinaryArtifact } from '../context.js';

type AuthInput = {
  browserManager: BrowserSessionManager;
  startUrl: string;
  loginUrl?: string;
  appUrl: string;
  waitForContinueSignal: () => Promise<void>;
  onSessionLaunched?: (sessionId: string) => void;
};

/**
 * Authentication agent — launches browser, waits for human login.
 * NEVER reads or stores passwords.
 *
 * On hosted headless workers there is no live browser view; the UI
 * "Continue after login" button publishes Redis continue so the pipeline
 * can proceed with the current page (skip interactive login).
 */
export const authenticationAgent: AgentHandler<
  AuthInput,
  { sessionId: string; authenticated: boolean; currentUrl: string }
> = {
  id: 'AUTHENTICATION',
  name: 'Authentication Agent',

  async run(ctx, input) {
    const { browserManager } = input;
    const headless = process.env.BROWSER_HEADLESS !== 'false';

    const launched = await browserManager.launch({
      executionId: ctx.executionId,
      startUrl: input.startUrl,
    });

    ctx.browserSessionId = launched.sessionId;
    input.onSessionLaunched?.(launched.sessionId);

    await ctx.emit({
      type: 'auth.awaiting_login',
      phase: 'AUTHENTICATION',
      message: headless
        ? 'Headless browser opened the login URL. There is no live viewer on this host — click Continue in the UI after you are ready (or to skip login). Credentials are never collected.'
        : 'Browser launched. Please log in manually in the session, then click Continue. Credentials are never collected.',
      data: {
        sessionId: launched.sessionId,
        viewerHint: launched.viewerHint,
        startUrl: input.startUrl,
        headless,
        interactiveViewer: !headless,
      },
    });

    // Race: in-process continue OR Redis continue from API/UI
    await Promise.race([
      browserManager.waitForContinue(launched.sessionId),
      input.waitForContinueSignal().then(() => {
        browserManager.signalContinue(launched.sessionId);
      }),
    ]);

    await ctx.emit({
      type: 'auth.continue_received',
      phase: 'AUTHENTICATION',
      message: 'Continue signal received — detecting authentication state',
    });

    const detection = await browserManager.detectAuthenticated(
      launched.sessionId,
      input.loginUrl,
    );

    const screenshot = await browserManager.screenshot(
      launched.sessionId,
      'post-login',
    );
    await putBinaryArtifact({
      executionId: ctx.executionId,
      type: ArtifactType.SCREENSHOT,
      key: `${ctx.executionId}/screenshots/post-login.png`,
      body: screenshot,
      mime: 'image/png',
      store: ctx.artifactStore,
    });

    const result = {
      sessionId: launched.sessionId,
      authenticated: detection.authenticated,
      currentUrl: detection.currentUrl,
      note: 'Passwords are never read or stored by QAForge.',
    };

    await ctx.putArtifactJson('AUTHENTICATION_RESULT', result);

    await ctx.emit({
      type: 'auth.detected',
      phase: 'AUTHENTICATION',
      message: detection.authenticated
        ? `Authenticated session detected at ${detection.currentUrl}`
        : `Could not confirm auth; continuing with current URL ${detection.currentUrl}`,
      data: result,
    });

    return result;
  },
};
