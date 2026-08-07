import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ArtifactStore } from '../types.js';

function toBuffer(body: Buffer | string): Buffer {
  return Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly rootDir: string;
  private readonly memory = new Map<string, Buffer>();

  constructor(opts?: { executionId?: string; rootDir?: string }) {
    const base = opts?.rootDir ?? path.join(process.cwd(), '.artifacts');
    this.rootDir = opts?.executionId
      ? path.join(base, opts.executionId)
      : base;
  }

  private resolvePath(key: string): string {
    const safe = key.replace(/^[/\\]+/, '').replace(/\.\./g, '_');
    return path.join(this.rootDir, safe);
  }

  async put(
    key: string,
    body: Buffer | string,
    _mime: string,
  ): Promise<{ key: string; size: number }> {
    const buf = toBuffer(body);
    this.memory.set(key, buf);
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buf);
    return { key, size: buf.length };
  }

  async get(key: string): Promise<Buffer> {
    const cached = this.memory.get(key);
    if (cached) {
      return cached;
    }
    const filePath = this.resolvePath(key);
    const buf = await fs.readFile(filePath);
    this.memory.set(key, buf);
    return buf;
  }

  async signedUrl(key: string, ttlSeconds = 3600): Promise<string> {
    const token = createHash('sha256')
      .update(`${key}:${ttlSeconds}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16);
    const filePath = this.resolvePath(key);
    return `file://${filePath}?token=${token}&ttl=${ttlSeconds}`;
  }
}
