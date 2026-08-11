import { isPrivateAppUrl, isUsableAppUrl } from './environment.js';

export type AppPageMap = {
  url: string;
  title: string;
  headings: string[];
  buttons: string[];
  inputs: Array<{
    name: string;
    type: string;
    id: string;
    placeholder: string;
  }>;
  links: string[];
  error?: string;
};

function decode(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m?.[1] ? decode(m[1]) : '';
}

export async function reviewApplicationByFetch(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<AppPageMap> {
  const empty: AppPageMap = {
    url,
    title: '',
    headings: [],
    buttons: [],
    inputs: [],
    links: [],
  };
  if (!isUsableAppUrl(url)) {
    return { ...empty, error: 'Not a usable application URL' };
  }
  if (isPrivateAppUrl(url)) {
    return {
      ...empty,
      error:
        'Private/localhost URL cannot be reviewed from the API. Pair a local runner or use a public URL.',
    };
  }
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'QAForge-AppReview/1.0' },
    });
    const html = await res.text();
    const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
      .map((m) => decode(m[1]!.replace(/<[^>]+>/g, '')))
      .filter(Boolean)
      .slice(0, 20);
    const buttons = [
      ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi),
      ...html.matchAll(/<input\b([^>]*type=["'](?:submit|button)["'][^>]*)\/?>/gi),
    ]
      .map((m) => {
        const inner = m[2] ? decode(m[2].replace(/<[^>]+>/g, '')) : '';
        return inner || attr(m[1] ?? '', 'value') || attr(m[1] ?? '', 'name');
      })
      .filter(Boolean)
      .slice(0, 20);
    const inputs = [...html.matchAll(/<input\b([^>]*)\/?>/gi)]
      .map((m) => {
        const tag = m[1] ?? '';
        return {
          name: attr(tag, 'name'),
          type: attr(tag, 'type') || 'text',
          id: attr(tag, 'id'),
          placeholder: attr(tag, 'placeholder'),
        };
      })
      .filter((i) => i.type !== 'hidden' && (i.name || i.id || i.placeholder))
      .slice(0, 30);
    const origin = new URL(url).origin;
    const links = [...html.matchAll(/<a\b([^>]*)>/gi)]
      .map((m) => attr(m[1] ?? '', 'href'))
      .filter((href) => href.startsWith('/') || href.startsWith(origin))
      .slice(0, 25);
    return { url, title, headings, buttons, inputs, links };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : 'Could not fetch application',
    };
  }
}

export function formatPageMapForLlm(map: AppPageMap): string {
  if (map.error && !map.title && !map.inputs.length) {
    return `Application review failed for ${map.url}: ${map.error}`;
  }
  return [
    `URL: ${map.url}`,
    map.title ? `Title: ${map.title}` : '',
    map.headings.length ? `Headings: ${map.headings.join(' | ')}` : '',
    map.buttons.length ? `Buttons: ${map.buttons.join(', ')}` : '',
    map.inputs.length
      ? `Inputs: ${map.inputs
          .map((i) => [i.type, i.name || i.id, i.placeholder].filter(Boolean).join(':'))
          .join('; ')}`
      : '',
    map.links.length ? `Links: ${map.links.join(', ')}` : '',
    map.error ? `Note: ${map.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
