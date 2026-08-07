import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

export async function buildZipPackage(opts: {
  frameworkDir?: string;
  files: Record<string, string | Buffer>;
}): Promise<Buffer> {
  const zip = new JSZip();

  for (const [relPath, content] of Object.entries(opts.files)) {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) continue;
    zip.file(normalized, content);
  }

  if (opts.frameworkDir) {
    await addDirectoryToZip(zip, opts.frameworkDir, 'framework');
  }

  const result = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return Buffer.from(result);
}

async function addDirectoryToZip(
  zip: JSZip,
  dir: string,
  prefix: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    const rel = `${prefix}/${entry}`.replace(/\\/g, '/');
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      await addDirectoryToZip(zip, full, rel);
    } else if (stat.isFile()) {
      const data = await fs.readFile(full);
      zip.file(rel, data);
    }
  }
}
