import fs from 'node:fs/promises';
import path from 'node:path';

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
  line: number;
}

export function classifyOwner(handle: string): 'team' | 'person' | 'service' {
  const clean = handle.replace(/^@/, '');
  if (clean.includes('[bot]') || clean.endsWith('-bot')) return 'service';
  if (clean.includes('/')) return 'team';
  return 'person';
}

export async function loadCodeowners(repoRoot: string): Promise<{ path: string | null; entries: CodeownersEntry[] }> {
  const candidates = [
    path.join(repoRoot, '.github', 'CODEOWNERS'),
    path.join(repoRoot, 'CODEOWNERS'),
    path.join(repoRoot, 'docs', 'CODEOWNERS'),
  ];

  let found: string | null = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      found = candidate;
      break;
    } catch {
      // continue
    }
  }

  if (!found) return { path: null, entries: [] };

  const raw = await fs.readFile(found, 'utf8');
  const entries: CodeownersEntry[] = [];
  raw.split(/\r?\n/).forEach((lineRaw, idx) => {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return;
    const pattern = parts[0];
    const owners = parts.slice(1).filter((p) => p.startsWith('@'));
    if (!owners.length) return;
    entries.push({ pattern, owners, line: idx + 1 });
  });

  return { path: found, entries };
}

export function toRelative(repoRoot: string, absPath: string): string {
  const rel = path.relative(repoRoot, absPath).replace(/\\/g, '/');
  return rel.startsWith('.') ? absPath.replace(/\\/g, '/') : rel;
}

function wildcardToRegex(pat: string): RegExp {
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesCodeownersPattern(pattern: string, relPath: string): boolean {
  const p = pattern.trim();
  const rel = relPath.replace(/^\/+/, '');
  if (p === '*') return true;

  let norm = p.replace(/^\/+/, '');
  if (norm.endsWith('/')) {
    return rel.startsWith(norm);
  }

  // CODEOWNERS semantics where bare token can match nested path suffixes.
  if (!norm.includes('/')) {
    if (rel === norm || rel.endsWith(`/${norm}`)) return true;
  }

  const rx = wildcardToRegex(norm);
  if (rx.test(rel)) return true;

  // fallback for directory prefix without trailing slash
  if (!norm.includes('*') && rel.startsWith(`${norm}/`)) return true;

  return false;
}

export function isCriticalRelativePath(relPath: string): boolean {
  const rel = relPath.replace(/^\/+/, '');
  if (rel === 'package.json') return true;
  if (rel.startsWith('src/core/')) return true;
  if (rel.startsWith('src/utils/verify-')) return true;
  if (rel.startsWith('src/core/verification/')) return true;
  if (rel === '.github/CODEOWNERS') return true;
  if (rel.startsWith('src/mcp/tools/')) return true;
  return false;
}
