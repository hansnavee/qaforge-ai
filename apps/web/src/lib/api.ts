export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const API_URL = API_BASE_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const msg = (data as { message?: unknown }).message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg)) return msg.map(String).join(', ');
  if (msg && typeof msg === 'object') {
    const nested = msg as {
      message?: unknown;
      blockers?: unknown;
      issues?: { fieldErrors?: Record<string, string[] | undefined> };
    };
    const parts: string[] = [];
    if (typeof nested.message === 'string') parts.push(nested.message);
    if (Array.isArray(nested.blockers) && nested.blockers.length) {
      parts.push(nested.blockers.map(String).join('; '));
    }
    const fieldErrors = nested.issues?.fieldErrors;
    if (fieldErrors) {
      const fields = Object.entries(fieldErrors).flatMap(([k, v]) =>
        (v ?? []).map((m) => `${k}: ${m}`),
      );
      if (fields.length) parts.push(fields.join('; '));
    }
    if (parts.length) return parts.join(' — ');
  }
  return fallback;
}

function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiForm<T = unknown>(
  path: string,
  form: FormData,
): Promise<T> {
  return api<T>(path, { method: 'POST', body: form, headers: {} });
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = apiUrl(path);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('API unreachable', 0);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(
      errorMessage(data, res.statusText || 'Request failed'),
      res.status,
      data,
    );
  }

  return data as T;
}

/** Authenticated binary download (cookies) — saves via blob URL. */
export async function downloadAuthenticated(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new ApiError('API unreachable', 0);
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = JSON.parse(await res.text());
    } catch {
      /* ignore */
    }
    throw new ApiError(
      errorMessage(data, res.statusText || 'Download failed'),
      res.status,
      data,
    );
  }

  // Read body once — JSON downloads are real files (Content-Disposition),
  // not redirect envelopes. Only treat tiny {url} payloads as redirects.
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? '';
  const cd = res.headers.get('content-disposition') ?? '';
  const isAttachment = /attachment/i.test(cd);

  if (contentType.includes('application/json') && !isAttachment) {
    try {
      const data = JSON.parse(new TextDecoder().decode(buf)) as {
        url?: unknown;
      };
      if (data && typeof data.url === 'string' && data.url.startsWith('http')) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch {
      /* fall through and save bytes */
    }
  }

  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)"?/i.exec(cd);
  const filename = match?.[1]
    ? decodeURIComponent(match[1])
    : fallbackFilename;
  const blob = new Blob([buf], {
    type: contentType || 'application/octet-stream',
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Authenticated HTML/blob open in a new tab (cookies). */
export async function openAuthenticated(
  path: string,
  mime = 'text/html',
): Promise<void> {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new ApiError('API unreachable', 0);
  }
  if (!res.ok) {
    throw new ApiError(res.statusText || 'Open failed', res.status);
  }
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? mime;
  const blob = new Blob([buf], { type: contentType });
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
}

export { API_URL };
