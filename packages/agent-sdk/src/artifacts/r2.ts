import { createHash, createHmac } from 'node:crypto';
import type { ArtifactStore } from '../types.js';
import { MemoryArtifactStore } from './memory.js';

export interface R2ArtifactStoreOptions {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  publicBaseUrl?: string;
  endpoint?: string;
  executionId?: string;
  fallbackRootDir?: string;
}

function hasR2Credentials(opts: R2ArtifactStoreOptions): boolean {
  return Boolean(
    (opts.accountId || process.env.R2_ACCOUNT_ID) &&
      (opts.accessKeyId || process.env.R2_ACCESS_KEY_ID) &&
      (opts.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY) &&
      (opts.bucket || process.env.R2_BUCKET),
  );
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function toAmzDate(d: Date): { amzDate: string; dateStamp: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Cloudflare R2 / S3-compatible artifact store using SigV4 + fetch.
 * Falls back to MemoryArtifactStore under process.cwd()/.artifacts when creds are missing.
 */
export class R2ArtifactStore implements ArtifactStore {
  private readonly fallback: MemoryArtifactStore | null;
  private readonly accountId: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicBaseUrl: string | undefined;
  private readonly region = 'auto';
  private readonly memoryCache = new Map<string, Buffer>();

  constructor(opts: R2ArtifactStoreOptions = {}) {
    if (!hasR2Credentials(opts)) {
      this.fallback = new MemoryArtifactStore({
        executionId: opts.executionId,
        rootDir: opts.fallbackRootDir ?? `${process.cwd()}/.artifacts`,
      });
      this.accountId = '';
      this.accessKeyId = '';
      this.secretAccessKey = '';
      this.bucket = '';
      this.endpoint = '';
      this.publicBaseUrl = undefined;
      return;
    }

    this.fallback = null;
    this.accountId = opts.accountId ?? process.env.R2_ACCOUNT_ID ?? '';
    this.accessKeyId = opts.accessKeyId ?? process.env.R2_ACCESS_KEY_ID ?? '';
    this.secretAccessKey =
      opts.secretAccessKey ?? process.env.R2_SECRET_ACCESS_KEY ?? '';
    this.bucket = opts.bucket ?? process.env.R2_BUCKET ?? '';
    this.endpoint =
      opts.endpoint ??
      process.env.R2_ENDPOINT ??
      `https://${this.accountId}.r2.cloudflarestorage.com`;
    this.publicBaseUrl =
      opts.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL ?? undefined;
  }

  private objectUrl(key: string): string {
    const encoded = key
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/');
    return `${this.endpoint}/${this.bucket}/${encoded}`;
  }

  private signRequest(opts: {
    method: string;
    key: string;
    body: Buffer;
    contentType?: string;
    now?: Date;
  }): { url: string; headers: Record<string, string> } {
    const now = opts.now ?? new Date();
    const { amzDate, dateStamp } = toAmzDate(now);
    const url = this.objectUrl(opts.key);
    const host = new URL(this.endpoint).host;
    const canonicalUri = `/${this.bucket}/${opts.key
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/')}`;

    const payloadHash = sha256Hex(opts.body);
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (opts.contentType) {
      headers['content-type'] = opts.contentType;
    }

    const signedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderKeys
      .map((k) => `${k}:${headers[k]!.trim()}\n`)
      .join('');
    const signedHeaders = signedHeaderKeys.join(';');

    const canonicalRequest = [
      opts.method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning)
      .update(stringToSign, 'utf8')
      .digest('hex');

    headers.Authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    return { url, headers };
  }

  async put(
    key: string,
    body: Buffer | string,
    mime: string,
  ): Promise<{ key: string; size: number }> {
    if (this.fallback) {
      return this.fallback.put(key, body, mime);
    }

    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const { url, headers } = this.signRequest({
      method: 'PUT',
      key,
      body: buf,
      contentType: mime,
    });

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: buf,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `R2 put failed (${response.status}): ${errText || response.statusText}`,
      );
    }

    this.memoryCache.set(key, buf);
    return { key, size: buf.length };
  }

  async get(key: string): Promise<Buffer> {
    if (this.fallback) {
      return this.fallback.get(key);
    }

    const cached = this.memoryCache.get(key);
    if (cached) {
      return cached;
    }

    const { url, headers } = this.signRequest({
      method: 'GET',
      key,
      body: Buffer.alloc(0),
    });

    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `R2 get failed (${response.status}): ${errText || response.statusText}`,
      );
    }

    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    this.memoryCache.set(key, buf);
    return buf;
  }

  async signedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    if (this.fallback) {
      return this.fallback.signedUrl(key, ttlSeconds);
    }

    if (this.publicBaseUrl) {
      const encoded = key
        .split('/')
        .map((p) => encodeURIComponent(p))
        .join('/');
      return `${this.publicBaseUrl.replace(/\/$/, '')}/${encoded}`;
    }

    // Presigned GET (query-string SigV4)
    const now = new Date();
    const { amzDate, dateStamp } = toAmzDate(now);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = `${this.accessKeyId}/${credentialScope}`;
    const host = new URL(this.endpoint).host;
    const canonicalUri = `/${this.bucket}/${key
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/')}`;

    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(ttlSeconds),
      'X-Amz-SignedHeaders': 'host',
    });

    const canonicalQuery = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2F/g, '/')}`,
      )
      .join('&');

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const kDate = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning)
      .update(stringToSign, 'utf8')
      .digest('hex');

    return `${this.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}
