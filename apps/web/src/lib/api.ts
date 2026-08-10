const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
    const nested = msg as { message?: unknown; blockers?: unknown };
    const parts: string[] = [];
    if (typeof nested.message === 'string') parts.push(nested.message);
    if (Array.isArray(nested.blockers) && nested.blockers.length) {
      parts.push(nested.blockers.map(String).join('; '));
    }
    if (parts.length) return parts.join(' — ');
  }
  return fallback;
}

function apiUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `${API_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
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
        'Content-Type': 'application/json',
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

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as { url?: string };
    if (data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(cd);
  const filename = match?.[1] ?? fallbackFilename;
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export { API_URL };
