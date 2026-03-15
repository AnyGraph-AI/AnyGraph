/**
 * TC Pipeline Orchestration Smoke Test
 *
 * Runs the tc-pipeline.ts CLI entry point and verifies it completes without error.
 * This tests the orchestration (project discovery, step sequencing, exit codes),
 * not individual step logic (covered by tc-integration.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../../..');

describe('TC Pipeline Orchestration', () => {
  it('tc:recompute runs without error', () => {
    const output = execSync(
      `npx tsx src/scripts/entry/tc-pipeline.ts recompute`,
      { cwd: ROOT, timeout: 30000, encoding: 'utf-8' },
    );
    expect(output).toContain('[tc:recompute]');
    expect(output).toContain('projects');
  });

  it('tc:verify runs and returns exit 0', () => {
    const output = execSync(
      `npx tsx src/scripts/entry/tc-pipeline.ts verify`,
      { cwd: ROOT, timeout: 30000, encoding: 'utf-8' },
    );
    expect(output).toContain('[tc:verify]');
    expect(output).toContain('shadow_isolation');
  });

  it('unknown step exits with error', () => {
    expect(() => {
      execSync(
        `npx tsx src/scripts/entry/tc-pipeline.ts bogus_step`,
        { cwd: ROOT, timeout: 10000, encoding: 'utf-8' },
      );
    }).toThrow();
  });
});
