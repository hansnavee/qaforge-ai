import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md', '.text']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'application/octet-stream',
]);

export function isAllowedRequirementFile(filename: string, mime: string): boolean {
  const lower = filename.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (ALLOWED_EXT.has(ext)) return true;
  return ALLOWED_MIME.has(mime);
}

export async function parseRequirementFile(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const lower = filename.toLowerCase();

  if (
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.text')
  ) {
    return buffer.toString('utf8');
  }

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    const parsed = await pdfParse(buffer);
    return parsed.text ?? '';
  }

  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }

  // Best-effort plain text fallback
  return buffer.toString('utf8');
}
