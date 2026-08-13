import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  chromium,
  firefox,
  webkit,
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
    headless?: boolean;
    browser?: 'chromium' | 'firefox' | 'webkit';
  }): Promise<{ sessionId: string; viewerHint: string }> {
    const sessionId = randomUUID();
    const headless =
      typeof opts.headless === 'boolean'
        ? opts.headless
        : process.env.BROWSER_HEADLESS !== 'false';
    const kind = opts.browser ?? 'chromium';
    const slowMo = headless
      ? 0
      : Math.max(0, Number(process.env.PLAYWRIGHT_SLOWMO ?? 400) || 400);
    const launchArgs = headless
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : ['--start-maximized'];
    const chromiumOpts = { headless, timeout: 60_000, slowMo, args: launchArgs };
    let browser: Browser;
    try {
      if (kind === 'firefox') {
        browser = await firefox.launch({ headless, timeout: 60_000, slowMo });
      } else if (kind === 'webkit') {
        browser = await webkit.launch({ headless, timeout: 60_000, slowMo });
      } else {
        browser = await chromium.launch(chromiumOpts);
      }
    } catch {
      browser = await chromium.launch(chromiumOpts);
    }
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qaforge-video-'));
    // Intentionally no storageState / disk cookie persistence.
    const context = await browser.newContext({
      viewport: headless ? { width: 1280, height: 720 } : null,
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

  async launchBrowserStack(opts: {
    executionId: string;
    startUrl: string;
    username: string;
    accessKey: string;
    browser?: 'chromium' | 'firefox' | 'webkit' | string;
    headless?: boolean;
    name?: string;
  }): Promise<{ sessionId: string; viewerHint: string }> {
    const sessionId = randomUUID();
    const headless = opts.headless !== false;
    const caps = {
      browser: opts.browser === 'firefox' ? 'firefox' : opts.browser === 'webkit' ? 'webkit' : 'chrome',
      os: 'Windows',
      os_version: '11',
      name: opts.name || `QAForge ${opts.executionId}`,
      build: 'qaforge-ai-executor',
      'browserstack.username': opts.username,
      'browserstack.accessKey': opts.accessKey,
      'browserstack.playwrightVersion': '1.51.0',
      headless,
    };
    const wsEndpoint = `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
    const browser = await chromium.connect(wsEndpoint, { timeout: 60_000 });
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qaforge-video-'));
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
      viewerHint: `BrowserStack session for ${opts.executionId}`,
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

  async open(sessionId: string, url: string): Promise<void> {
    const page = await this.getPage(sessionId);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
  }

  async click(sessionId: string, target: string): Promise<void> {
    const page = await this.getPage(sessionId);
    try {
      await page.locator(target).first().click({ timeout: 5_000 });
      return;
    } catch {
      /* target may be a label, not a CSS selector */
    }
    const loc = page
      .getByRole('button', { name: target })
      .or(page.getByRole('link', { name: target }))
      .or(page.getByText(target, { exact: false }));
    await loc.first().click({ timeout: 15_000 });
  }

  async fill(sessionId: string, target: string, value: string): Promise<void> {
    const page = await this.getPage(sessionId);
    try {
      await page.locator(target).first().fill(value, { timeout: 5_000 });
      return;
    } catch {
      /* target may be a label, not a CSS selector */
    }
    const loc = page
      .getByLabel(target)
      .or(page.getByPlaceholder(target))
      .or(page.locator(`input[name="${target}"], textarea[name="${target}"]`));
    await loc.first().fill(value, { timeout: 15_000 });
  }

  /** Fresh page for the next case so prior session state does not poison results. */
  async freshPage(sessionId: string): Promise<Page> {
    const session = this.requireSession(sessionId);
    await session.page.close().catch(() => undefined);
    session.page = await session.context.newPage();
    return session.page;
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

  async flushAndCollectVideos(
    sessionId: string,
  ): Promise<Array<{ filename: string; body: Buffer }>> {
    const session = this.requireSession(sessionId);
    await session.page.close().catch(() => undefined);
    await session.context.close().catch(() => undefined);
    const files: Array<{ filename: string; body: Buffer }> = [];
    if (!session.videoDir) return files;
    const names = await fs.readdir(session.videoDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!/\.(webm|mp4)$/i.test(name)) continue;
      const body = await fs.readFile(path.join(session.videoDir, name));
      files.push({ filename: name, body });
    }
    return files;
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
