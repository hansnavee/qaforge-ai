import { randomUUID } from 'node:crypto';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

interface SessionState {
  sessionId: string;
  executionId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  continueResolver: (() => void) | null;
  continuePromise: Promise<void> | null;
}

function loginPathFromUrl(loginUrl?: string): string | null {
  if (!loginUrl) return null;
  try {
    return new URL(loginUrl).pathname.replace(/\/$/, '') || '/';
  } catch {
    return loginUrl.replace(/\/$/, '') || '/';
  }
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, SessionState>();

  async launch(opts: {
    executionId: string;
    startUrl: string;
  }): Promise<{ sessionId: string; viewerHint: string }> {
    const sessionId = randomUUID();
    const headless = process.env.BROWSER_HEADLESS !== 'false';

    const browser = await chromium.launch({
      headless,
      timeout: 60_000,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    // Intentionally no storageState / disk cookie persistence.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: false,
    });
    const page = await context.newPage();
    await page.goto(opts.startUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });

    this.sessions.set(sessionId, {
      sessionId,
      executionId: opts.executionId,
      browser,
      context,
      page,
      continueResolver: null,
      continuePromise: null,
    });

    return {
      sessionId,
      viewerHint: `Browser session ${sessionId} for execution ${opts.executionId} (headless=${headless}). Call signalContinue(sessionId) after interactive auth.`,
    };
  }

  async waitForContinue(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    if (!session.continuePromise) {
      session.continuePromise = new Promise<void>((resolve) => {
        session.continueResolver = resolve;
      });
    }
    await session.continuePromise;
    session.continuePromise = null;
    session.continueResolver = null;
  }

  signalContinue(sessionId: string): void {
    const session = this.requireSession(sessionId);
    if (session.continueResolver) {
      session.continueResolver();
      session.continueResolver = null;
      session.continuePromise = null;
      return;
    }
    // If nothing is waiting yet, resolve immediately on next wait.
    session.continuePromise = Promise.resolve();
    session.continueResolver = null;
  }

  async detectAuthenticated(
    sessionId: string,
    loginUrl?: string,
  ): Promise<{ authenticated: boolean; currentUrl: string }> {
    const session = this.requireSession(sessionId);
    const currentUrl = session.page.url();

    let stillOnLoginPath = false;
    const loginPath = loginPathFromUrl(loginUrl);
    if (loginPath) {
      try {
        const currentPath =
          new URL(currentUrl).pathname.replace(/\/$/, '') || '/';
        stillOnLoginPath =
          currentPath === loginPath ||
          currentPath.endsWith(loginPath) ||
          currentUrl.includes(loginPath);
      } catch {
        stillOnLoginPath = currentUrl.includes(loginPath);
      }
    } else {
      stillOnLoginPath = /login|signin|sign-in|auth/i.test(currentUrl);
    }

    const passwordVisible = await session.page
      .locator(
        'input[type="password"], input[name*="pass" i], input[id*="pass" i]',
      )
      .first()
      .isVisible()
      .catch(() => false);

    const authenticated = !stillOnLoginPath || !passwordVisible;
    return { authenticated, currentUrl };
  }

  async getPage(sessionId: string): Promise<Page> {
    return this.requireSession(sessionId).page;
  }

  async screenshot(sessionId: string, name: string): Promise<Buffer> {
    const session = this.requireSession(sessionId);
    const buffer = await session.page.screenshot({
      fullPage: true,
      type: 'png',
      animations: 'disabled',
    });
    // name is retained for caller-side artifact keying; no disk write here.
    void name;
    return Buffer.from(buffer);
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionId);
    if (session.continueResolver) {
      session.continueResolver();
    }
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session not found: ${sessionId}`);
    }
    return session;
  }
}
