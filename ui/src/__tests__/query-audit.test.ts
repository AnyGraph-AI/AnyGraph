import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logUiQueryAudit, pruneUiQueryAuditLog, toHash } from '../lib/query-audit';

describe('[TODO-4] UI query audit logging', () => {
  it('writes jsonl audit entries', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-audit-'));
    const file = path.join(dir, 'ui-query-audit.jsonl');

    await logUiQueryAudit({
      ts: new Date().toISOString(),
      queryHash: toHash('MATCH (n) RETURN n LIMIT 1'),
      queryPreview: 'MATCH (n) RETURN n LIMIT 1',
      paramsHash: toHash('{}'),
      cacheHit: false,
      durationMs: 12,
      rowCount: 1,
      ok: true,
    }, file);

    const content = await readFile(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.ok).toBe(true);
    expect(parsed.rowCount).toBe(1);
  });

  it('prunes entries older than retention window', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ui-audit-prune-'));
    const file = path.join(dir, 'ui-query-audit.jsonl');

    const oldTs = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString();
    const newTs = new Date().toISOString();

    await writeFile(file, [
      JSON.stringify({ ts: oldTs, queryHash: 'old', queryPreview: 'old', paramsHash: 'old', cacheHit: false, ok: true }),
      JSON.stringify({ ts: newTs, queryHash: 'new', queryPreview: 'new', paramsHash: 'new', cacheHit: false, ok: true }),
    ].join('\n') + '\n', 'utf8');

    const res = await pruneUiQueryAuditLog(file, 90);
    expect(res.removed).toBe(1);
    expect(res.kept).toBe(1);

    const content = await readFile(file, 'utf8');
    expect(content).toContain('"queryHash":"new"');
    expect(content).not.toContain('"queryHash":"old"');
  });
});
