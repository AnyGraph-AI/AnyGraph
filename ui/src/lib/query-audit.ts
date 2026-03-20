import { createHash } from 'node:crypto';
import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_RETENTION_DAYS = 90;

export interface UiQueryAuditEntry {
  ts: string;
  queryHash: string;
  queryPreview: string;
  paramsHash: string;
  cacheHit: boolean;
  durationMs?: number;
  rowCount?: number;
  ok: boolean;
  error?: string;
}

export function getUiQueryAuditPath(): string {
  return process.env.UI_QUERY_AUDIT_LOG_PATH
    ?? path.resolve(process.cwd(), 'artifacts', 'ui-query-audit.jsonl');
}

export function toHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

export async function pruneUiQueryAuditLog(filePath = getUiQueryAuditPath(), retentionDays = DEFAULT_RETENTION_DAYS): Promise<{ kept: number; removed: number }> {
  try {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const kept: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as UiQueryAuditEntry;
        const ts = parsed?.ts ? Date.parse(parsed.ts) : NaN;
        if (Number.isFinite(ts) && ts >= cutoff) kept.push(line);
      } catch {
        // drop malformed lines during prune
      }
    }

    if (kept.length !== lines.length) {
      await writeFile(filePath, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf8');
    }

    return { kept: kept.length, removed: lines.length - kept.length };
  } catch {
    return { kept: 0, removed: 0 };
  }
}

export async function logUiQueryAudit(entry: UiQueryAuditEntry, filePath = getUiQueryAuditPath()): Promise<void> {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');

    // Lightweight periodic pruning: at most ~1% of writes.
    if (Math.random() < 0.01) {
      await pruneUiQueryAuditLog(filePath, DEFAULT_RETENTION_DAYS);
    }
  } catch {
    // Non-fatal: audit log failures must not break query serving.
  }
}
