import type { AgentHandler } from '@qaforge/agent-sdk';
import type { BrowserSessionManager } from '@qaforge/browser-session';
import { ArtifactType } from '@qaforge/shared';
import type { Page, Request } from 'playwright';

type DiscoveryInput = {
  browserManager: BrowserSessionManager;
  sessionId: string;
  appUrl: string;
};

export async function crawlSameOrigin(page: Page, appUrl: string, maxLinks = 15) {
  const origin = new URL(appUrl).origin;
  const visited = new Set<string>();
  const queue: string[] = [page.url()];
  const pages: Array<{
    url: string;
    title: string;
    forms: unknown[];
    buttons: string[];
    inputs: string[];
    nav: string[];
  }> = [];
  const networkRequests: Array<{
    method: string;
    url: string;
    resourceType: string;
  }> = [];

  const onRequest = (req: Request) => {
    try {
      const u = new URL(req.url());
      if (u.origin === origin && ['xhr', 'fetch'].includes(req.resourceType())) {
        networkRequests.push({
          method: req.method(),
          url: req.url(),
          resourceType: req.resourceType(),
        });
      }
    } catch {
      /* ignore */
    }
  };

  page.on('request', onRequest);

  while (queue.length && visited.size < maxLinks) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);

    try {
      await page.goto(next, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
    } catch {
      continue;
    }

    const snapshot = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
        action: f.getAttribute('action') ?? '',
        method: (f.getAttribute('method') ?? 'get').toLowerCase(),
        fields: Array.from(f.querySelectorAll('input,select,textarea')).map(
          (el) => ({
            name: el.getAttribute('name') ?? '',
            type: el.getAttribute('type') ?? el.tagName.toLowerCase(),
            id: el.id || '',
          }),
        ),
      }));

      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"], input[type="submit"]'),
      )
        .map((el) => (el.textContent || el.getAttribute('value') || '').trim())
        .filter(Boolean)
        .slice(0, 40);

      const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
        .map((el) => {
          const name = el.getAttribute('name') || el.id || '';
          const type = el.getAttribute('type') || el.tagName.toLowerCase();
          return `${type}:${name}`;
        })
        .filter((s) => s !== ':')
        .slice(0, 60);

      const nav = Array.from(
        document.querySelectorAll('nav a, header a, [role="navigation"] a'),
      )
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean)
        .slice(0, 40);

      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(Boolean);

      return {
        title: document.title,
        forms,
        buttons,
        inputs,
        nav,
        links,
      };
    });

    pages.push({
      url: next,
      title: snapshot.title,
      forms: snapshot.forms,
      buttons: snapshot.buttons,
      inputs: snapshot.inputs,
      nav: snapshot.nav,
    });

    for (const href of snapshot.links) {
      try {
        const u = new URL(href);
        if (u.origin !== origin) continue;
        const clean = `${u.origin}${u.pathname}`;
        if (!visited.has(clean) && !queue.includes(clean)) {
          queue.push(clean);
        }
      } catch {
        /* ignore */
      }
    }
  }

  page.off('request', onRequest);

  // dedupe network
  const seen = new Set<string>();
  const uniqueRequests = networkRequests.filter((r) => {
    const k = `${r.method}:${r.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { pages, networkRequests: uniqueRequests.slice(0, 100), visited: [...visited] };
}

export const discoveryAgent: AgentHandler<DiscoveryInput, unknown> = {
  id: 'APPLICATION_DISCOVERY',
  name: 'Discovery Agent',

  async run(ctx, input) {
    const page = await input.browserManager.getPage(input.sessionId);

    await ctx.emit({
      type: 'discovery.crawling',
      phase: 'DISCOVERY',
      message: 'Crawling same-origin links (max 15)',
    });

    const crawl = await crawlSameOrigin(page, input.appUrl, 15);

    let workflows: unknown = [];
    try {
      const llm = await ctx.llm.complete({
        system: 'Summarize application workflows from a page map as JSON.',
        prompt: `App map / sitemap:\n${JSON.stringify(crawl.pages.map((p) => ({ url: p.url, title: p.title, forms: p.forms.length, buttons: p.buttons.slice(0, 10) })), null, 2)}\n\nReturn JSON: { workflows: [{ id, name, steps: string[], description }] }`,
        json: true,
        model: 'fast',
      });
      const parsed = JSON.parse(llm.text) as { workflows?: unknown };
      workflows = parsed.workflows ?? [];
    } catch {
      workflows = crawl.pages.slice(0, 5).map((p, i) => ({
        id: `flow-${i + 1}`,
        name: p.title || `Page ${i + 1}`,
        steps: [p.url],
        description: `Visit ${p.url}`,
      }));
    }

    const map = {
      appUrl: input.appUrl,
      crawledAt: new Date().toISOString(),
      pages: crawl.pages,
      visitedUrls: crawl.visited,
      networkRequests: crawl.networkRequests,
      workflows,
    };

    await ctx.putArtifactJson(ArtifactType.APPLICATION_MAP, map);
    await ctx.emit({
      type: 'discovery.ready',
      phase: 'DISCOVERY',
      message: `Discovered ${crawl.pages.length} pages`,
      data: { pageCount: crawl.pages.length },
    });
    return map;
  },
};
