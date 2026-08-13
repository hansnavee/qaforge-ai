import {
  QA_TOOL_PROVIDER,
  type QaToolProvider,
} from '@qaforge/shared';
import type { BrowserSessionManager } from './manager.js';

/**
 * Playwright as a QA tool provider (Agent → tools → browser).
 * Bound to one BrowserSessionManager session; execute jobs create this after launch.
 */
export function createPlaywrightBrowserProvider(
  manager: BrowserSessionManager,
  sessionId: string,
): QaToolProvider {
  return {
    id: QA_TOOL_PROVIDER.PLAYWRIGHT,
    testcase: {
      async list() {
        return [];
      },
      async upsert() {
        throw new Error('Playwright provider does not persist test cases');
      },
    },
    browser: {
      open: (url) => manager.open(sessionId, url),
      click: (target) => manager.click(sessionId, target),
      fill: (target, value) => manager.fill(sessionId, target, value),
      screenshot: async (name) => {
        const buf = await manager.screenshot(sessionId, name);
        return new Uint8Array(buf);
      },
    },
  };
}
