import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  videoDir: string | null;
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
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qaforge-video-'));
    // Intentionally no storageState / disk cookie persistence.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: false,
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 },
      },
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
      videoDir,
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

  /**
   * Capture a short failure video by cloning cookies into a temp context
   * with Playwright recordVideo, then closing it to flush the file.
   */
  async captureFailureVideo(
    sessionId: string,
    label: string,
  ): Promise<Buffer | null> {
    const session = this.requireSession(sessionId);
    const videoDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `qaforge-fail-${label}-`),
    );
    try {
      const cookies = await session.context.cookies();
      const currentUrl = session.page.url();
      const failContext = await session.browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 },
        },
      });
      await failContext.addCookies(cookies);
      const failPage = await failContext.newPage();
      await failPage
        .goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        .catch(() => undefined);
      await failPage.waitForTimeout(1500);
      const video = failPage.video();
      await failPage.close().catch(() => undefined);
      await failContext.close().catch(() => undefined);
      if (!video) return null;
      const videoPath = await video.path();
      const buf = await fs.readFile(videoPath);
      await fs.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
      return buf;
    } catch {
      await fs.rm(videoDir, { recursive: true, force: true }).catch(() => undefined);
      return null;
    }
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
    if (session.videoDir) {
      await fs
        .rm(session.videoDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private requireSession(sessionId: string): SessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session not found: ${sessionId}`);
    }
    return session;
  }
}
