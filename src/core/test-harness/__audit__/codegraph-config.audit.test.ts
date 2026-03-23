/**
 * AUD-TC-07-L1-01: codegraph-config.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/PLAN.md §.codegraph.yml Specification (lines 363–430)
 * Tests assert BEHAVIOR from spec, not implementation details.
 *
 * Accept: 8+ behavioral assertions, all green
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadCodeGraphConfig,
  generateSampleConfig,
} from '../../../core/config/codegraph-config.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-cfg-'));
}

function writeConfig(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

function cleanTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Behavior 1: DEFAULT_CONFIG has required fields with correct defaults ────

describe('AUD-TC-07 | codegraph-config.ts', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { cleanTempDir(tmpDir); });

  describe('Behavior 1: DEFAULT_CONFIG fields and risk threshold defaults', () => {
    it('returns project.repoId when no config file found', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBeDefined();
      expect(typeof cfg.project.repoId).toBe('string');
    });

    it('returns project.include array when no config file found', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(Array.isArray(cfg.project.include)).toBe(true);
      expect(cfg.project.include.length).toBeGreaterThan(0);
    });

    it('returns project.exclude array when no config file found', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(Array.isArray(cfg.project.exclude)).toBe(true);
      expect(cfg.project.exclude.length).toBeGreaterThan(0);
    });

    it('default risk.thresholds.critical is 500', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.critical).toBe(500);
    });

    it('default risk.thresholds.high is 100', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.high).toBe(100);
    });

    it('default risk.thresholds.medium is 20', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.medium).toBe(20);
    });
  });

  // ─── Behavior 2: searches 4 file paths in priority order ──────────────────

  describe('Behavior 2: loadCodeGraphConfig searches 4 file paths in order', () => {
    it('finds .codegraph.yml (first priority)', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'project:\n  repoId: from-dotcodegraph-yml\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('from-dotcodegraph-yml');
    });

    it('finds .codegraph.yaml when .yml absent', async () => {
      writeConfig(tmpDir, '.codegraph.yaml', 'project:\n  repoId: from-dotcodegraph-yaml\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('from-dotcodegraph-yaml');
    });

    it('finds codegraph.yml when dot-prefixed variants absent', async () => {
      writeConfig(tmpDir, 'codegraph.yml', 'project:\n  repoId: from-codegraph-yml\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('from-codegraph-yml');
    });

    it('finds codegraph.yaml as last resort', async () => {
      writeConfig(tmpDir, 'codegraph.yaml', 'project:\n  repoId: from-codegraph-yaml\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('from-codegraph-yaml');
    });

    it('.codegraph.yml takes precedence over codegraph.yml when both present', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'project:\n  repoId: priority-winner\n');
      writeConfig(tmpDir, 'codegraph.yml', 'project:\n  repoId: priority-loser\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('priority-winner');
    });
  });

  // ─── Behavior 3: deep-merged config when file exists ─────────────────────

  describe('Behavior 3: returns deep-merged config when file exists', () => {
    it('overrides project.repoId from config file', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'project:\n  repoId: godspeed-bot\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('godspeed-bot');
    });

    it('overrides framework.type from config file', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'framework:\n  type: grammy\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.framework?.type).toBe('grammy');
    });

    it('overrides risk thresholds from config file', async () => {
      const yaml = [
        'risk:',
        '  thresholds:',
        '    critical: 100',
        '    high: 50',
        '    medium: 10',
      ].join('\n');
      writeConfig(tmpDir, '.codegraph.yml', yaml);
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.critical).toBe(100);
      expect(cfg.risk?.thresholds?.high).toBe(50);
      expect(cfg.risk?.thresholds?.medium).toBe(10);
    });
  });

  // ─── Behavior 4: returns defaults when no config file found ──────────────

  describe('Behavior 4: returns defaults when no config file found', () => {
    it('returns a complete config object when directory has no config files', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project).toBeDefined();
      expect(cfg.risk).toBeDefined();
      expect(cfg.framework).toBeDefined();
    });

    it('default framework type is none', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.framework?.type).toBe('none');
    });

    it('default ignoreResolutionKinds includes builtin and fluent', async () => {
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.ignoreResolutionKinds).toContain('builtin');
      expect(cfg.risk?.ignoreResolutionKinds).toContain('fluent');
    });
  });

  // ─── Behavior 5: mergeConfig preserves defaults for unspecified sections ──

  describe('Behavior 5: partial override preserves remaining defaults', () => {
    it('partial risk override keeps other default thresholds', async () => {
      // Only override critical — high and medium should keep defaults
      const yaml = [
        'risk:',
        '  thresholds:',
        '    critical: 999',
      ].join('\n');
      writeConfig(tmpDir, '.codegraph.yml', yaml);
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.critical).toBe(999);
      expect(cfg.risk?.thresholds?.high).toBe(100);   // default preserved
      expect(cfg.risk?.thresholds?.medium).toBe(20);  // default preserved
    });

    it('specifying framework.type does not lose default project settings', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'framework:\n  type: nestjs\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.framework?.type).toBe('nestjs');
      // project defaults still present
      expect(Array.isArray(cfg.project.include)).toBe(true);
      expect(Array.isArray(cfg.project.exclude)).toBe(true);
    });
  });

  // ─── Behavior 6: YAML parsing handles scalars/arrays/objects/comments ────

  describe('Behavior 6: YAML parsing handles common constructs', () => {
    it('parses boolean value (embeddings.enabled)', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'embeddings:\n  enabled: false\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.embeddings?.enabled).toBe(false);
    });

    it('parses nested objects (risk.thresholds)', async () => {
      const yaml = 'risk:\n  thresholds:\n    high: 75\n';
      writeConfig(tmpDir, '.codegraph.yml', yaml);
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.risk?.thresholds?.high).toBe(75);
    });

    it('parses string value (project.repoId)', async () => {
      writeConfig(tmpDir, '.codegraph.yml', 'project:\n  repoId: "my-repo"\n');
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('my-repo');
    });
  });

  // ─── Behavior 8: generateSampleConfig produces valid YAML ────────────────

  describe('Behavior 8: generateSampleConfig produces valid YAML', () => {
    it('contains the specified repoId', () => {
      const output = generateSampleConfig('test-repo');
      expect(output).toContain('repoId: test-repo');
    });

    it('contains the specified framework type', () => {
      const output = generateSampleConfig('test-repo', 'grammy');
      expect(output).toContain('type: grammy');
    });

    it('defaults to none framework type when not specified', () => {
      const output = generateSampleConfig('test-repo');
      expect(output).toContain('type: none');
    });

    it('contains risk threshold defaults matching spec (critical=500, high=100, medium=20)', () => {
      const output = generateSampleConfig('my-project');
      expect(output).toContain('critical: 500');
      expect(output).toContain('high: 100');
      expect(output).toContain('medium: 20');
    });

    it('output is a string (valid YAML text)', () => {
      const output = generateSampleConfig('any-repo');
      expect(typeof output).toBe('string');
      expect(output.length).toBeGreaterThan(0);
    });

    it('generated config can be loaded back and produces correct repoId', async () => {
      const sample = generateSampleConfig('roundtrip-test');
      writeConfig(tmpDir, '.codegraph.yml', sample);
      const cfg = await loadCodeGraphConfig(tmpDir);
      expect(cfg.project.repoId).toBe('roundtrip-test');
    });
  });
});
