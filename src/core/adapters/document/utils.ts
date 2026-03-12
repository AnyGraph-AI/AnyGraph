import { createHash } from 'node:crypto';

export function deterministicId(...parts: Array<string | number | undefined>): string {
  const normalized = parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join('|');

  return createHash('md5').update(normalized).digest('hex').slice(0, 20);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/g)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}
