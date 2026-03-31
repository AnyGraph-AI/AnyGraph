/**
 * AUD-TC-10 L2 Batch F Gap-Fill Tests
 *
 * Fills coverage gaps identified during regression witness review:
 * - L2-44: neo4j.ts - integer param wrapping, audit logging integration, closeDriver nullification
 * - L2-46: query-audit.ts - getUiQueryAuditPath, toHash determinism, interface field validation
 * - L2-47: tokens.ts - SPACE, TEXT, Z, PANEL, KPI, ACCENT, SURFACE token objects
 *
 * Node environment only (no DOM). Tests via source inspection and module imports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LIB_DIR = resolve(import.meta.dirname, '..', 'lib');

// ─── L2-44: neo4j.ts gaps ───────────────────────────────────────

describe('[L2-44] neo4j.ts — integer param wrapping', () => {
  it('cachedQuery source wraps integer params with neo4j.int()', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    // Verify the source code wraps integers
    expect(source).toContain('neo4j.int(');
    expect(source).toContain('Number.isInteger(v)');
  });

  it('cachedQuery source calls logUiQueryAudit for cache hits', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    expect(source).toContain('logUiQueryAudit');
    // Verify it logs on cache hit path
    expect(source).toMatch(/cacheHit:\s*true/);
  });

  it('cachedQuery source calls logUiQueryAudit for cache misses', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    expect(source).toMatch(/cacheHit:\s*false/);
  });

  it('cachedQuery source calls logUiQueryAudit for errors', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    // Verify error path also logs
    expect(source).toMatch(/ok:\s*false/);
  });

  it('closeDriver nullifies singleton driver', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    // Verify closeDriver sets driver to null
    expect(source).toContain('driver = null');
  });

  it('getDriver uses env-based URI with default bolt://localhost:7687', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    expect(source).toContain('NEO4J_URI');
    expect(source).toContain('bolt://localhost:7687');
  });

  it('getDriver uses env-based credentials with defaults neo4j/codegraph', () => {
    const source = readFileSync(resolve(LIB_DIR, 'neo4j.ts'), 'utf-8');
    expect(source).toContain('NEO4J_USER');
    expect(source).toContain('NEO4J_PASSWORD');
    expect(source).toMatch(/'neo4j'/);
    expect(source).toMatch(/'codegraph'/);
  });
});

// ─── L2-46: query-audit.ts gaps ─────────────────────────────────

describe('[L2-46] query-audit.ts — getUiQueryAuditPath', () => {
  it('exports getUiQueryAuditPath function', async () => {
    const mod = await import('@/lib/query-audit');
    expect(typeof mod.getUiQueryAuditPath).toBe('function');
  });

  it('getUiQueryAuditPath returns string path', async () => {
    const { getUiQueryAuditPath } = await import('@/lib/query-audit');
    const path = getUiQueryAuditPath();
    expect(typeof path).toBe('string');
    expect(path).toContain('ui-query-audit');
  });

  it('getUiQueryAuditPath respects UI_QUERY_AUDIT_LOG_PATH env', () => {
    const source = readFileSync(resolve(LIB_DIR, 'query-audit.ts'), 'utf-8');
    expect(source).toContain('UI_QUERY_AUDIT_LOG_PATH');
  });
});

describe('[L2-46] query-audit.ts — toHash determinism', () => {
  it('toHash returns same hash for same input', async () => {
    const { toHash } = await import('@/lib/query-audit');
    const input = 'MATCH (n) RETURN n';
    const hash1 = toHash(input);
    const hash2 = toHash(input);
    expect(hash1).toBe(hash2);
  });

  it('toHash returns different hash for different input', async () => {
    const { toHash } = await import('@/lib/query-audit');
    const hash1 = toHash('MATCH (n) RETURN n');
    const hash2 = toHash('MATCH (m) RETURN m');
    expect(hash1).not.toBe(hash2);
  });

  it('toHash returns 16-character hex string', async () => {
    const { toHash } = await import('@/lib/query-audit');
    const hash = toHash('test input');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('[L2-46] query-audit.ts — UiQueryAuditEntry interface', () => {
  it('UiQueryAuditEntry has all required fields', () => {
    const source = readFileSync(resolve(LIB_DIR, 'query-audit.ts'), 'utf-8');
    // Check interface defines all expected fields
    expect(source).toContain('ts: string');
    expect(source).toContain('queryHash: string');
    expect(source).toContain('queryPreview: string');
    expect(source).toContain('paramsHash: string');
    expect(source).toContain('cacheHit: boolean');
    expect(source).toContain('durationMs');
    expect(source).toContain('rowCount');
    expect(source).toContain('ok: boolean');
    expect(source).toContain('error');
  });
});

// ─── L2-47: tokens.ts gaps ──────────────────────────────────────

describe('[L2-47] tokens.ts — SPACE object', () => {
  it('exports SPACE object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.SPACE).toBeDefined();
    expect(typeof mod.SPACE).toBe('object');
  });

  it('SPACE has keys 1,2,3,4,5,6,8,10,12', async () => {
    const { SPACE } = await import('@/lib/tokens');
    expect(SPACE[1]).toBe(4);
    expect(SPACE[2]).toBe(8);
    expect(SPACE[3]).toBe(12);
    expect(SPACE[4]).toBe(16);
    expect(SPACE[5]).toBe(20);
    expect(SPACE[6]).toBe(24);
    expect(SPACE[8]).toBe(32);
    expect(SPACE[10]).toBe(40);
    expect(SPACE[12]).toBe(48);
  });
});

describe('[L2-47] tokens.ts — TEXT object', () => {
  it('exports TEXT object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.TEXT).toBeDefined();
  });

  it('TEXT has xs/sm/base/lg/xl/2xl/3xl with size and lineHeight', async () => {
    const { TEXT } = await import('@/lib/tokens');
    const keys = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl'] as const;
    for (const key of keys) {
      expect(TEXT[key]).toBeDefined();
      expect(TEXT[key].size).toBeDefined();
      expect(TEXT[key].lineHeight).toBeDefined();
      expect(typeof TEXT[key].size).toBe('string');
      expect(typeof TEXT[key].lineHeight).toBe('string');
    }
  });
});

describe('[L2-47] tokens.ts — Z object', () => {
  it('exports Z object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.Z).toBeDefined();
  });

  it('Z has correct z-index scale values', async () => {
    const { Z } = await import('@/lib/tokens');
    expect(Z.base).toBe(0);
    expect(Z.raised).toBe(10);
    expect(Z.dropdown).toBe(20);
    expect(Z.sticky).toBe(30);
    expect(Z.modalBackdrop).toBe(40);
    expect(Z.modal).toBe(50);
    expect(Z.toast).toBe(60);
    expect(Z.tooltip).toBe(70);
    expect(Z.commandPalette).toBe(80);
  });
});

describe('[L2-47] tokens.ts — PANEL object', () => {
  it('exports PANEL object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.PANEL).toBeDefined();
  });

  it('PANEL has classes, padding, headerText, descText', async () => {
    const { PANEL } = await import('@/lib/tokens');
    expect(typeof PANEL.classes).toBe('string');
    expect(typeof PANEL.padding).toBe('string');
    expect(typeof PANEL.headerText).toBe('string');
    expect(typeof PANEL.descText).toBe('string');
  });
});

describe('[L2-47] tokens.ts — KPI object', () => {
  it('exports KPI object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.KPI).toBeDefined();
  });

  it('KPI has value and label styling strings', async () => {
    const { KPI } = await import('@/lib/tokens');
    expect(typeof KPI.value).toBe('string');
    expect(typeof KPI.label).toBe('string');
  });
});

describe('[L2-47] tokens.ts — ACCENT object', () => {
  it('exports ACCENT object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.ACCENT).toBeDefined();
  });

  it('ACCENT has danger/warning/caution/info hex colors', async () => {
    const { ACCENT } = await import('@/lib/tokens');
    expect(ACCENT.danger).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ACCENT.warning).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ACCENT.caution).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ACCENT.info).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('[L2-47] tokens.ts — SURFACE object', () => {
  it('exports SURFACE object', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.SURFACE).toBeDefined();
  });

  it('SURFACE has nav color', async () => {
    const { SURFACE } = await import('@/lib/tokens');
    expect(typeof SURFACE.nav).toBe('string');
    expect(SURFACE.nav).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
