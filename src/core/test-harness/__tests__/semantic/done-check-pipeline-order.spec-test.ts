import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '../../../../../');

function getDoneCheckSteps(): string[] {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const chain: string = pkg.scripts['done-check:core'];
  const steps: string[] = [];
  for (const part of chain.split('&&')) {
    const match = part.trim().match(/^npm run (.+)$/);
    if (match) steps.push(match[1].trim());
  }
  return steps;
}

describe('[AUD-TC-16] done-check pipeline ordering', () => {
  it('done-check-deps.json exists and was generated within the last 30 days', () => {
    const artifactPath = resolve(ROOT, 'artifacts/done-check-deps.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(artifact.orderingVerified).toBe(true);
    const age = Date.now() - new Date(artifact.generatedAt).getTime();
    expect(age).toBeLessThan(30 * 24 * 60 * 60 * 1000); // 30 days
  });

  it('enrich:composite-risk follows enrich:temporal-coupling in done-check:core chain', () => {
    const steps = getDoneCheckSteps();
    const iA = steps.indexOf('enrich:temporal-coupling');
    const iB = steps.indexOf('enrich:composite-risk');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB);
  });

  it('enrich:precompute-scores follows enrich:vr-scope in done-check:core chain', () => {
    const steps = getDoneCheckSteps();
    const iA = steps.indexOf('enrich:vr-scope');
    const iB = steps.indexOf('enrich:precompute-scores');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB);
  });

  it('enrich:precompute-scores follows enrich:composite-risk in done-check:core chain', () => {
    const steps = getDoneCheckSteps();
    const iA = steps.indexOf('enrich:composite-risk');
    const iB = steps.indexOf('enrich:precompute-scores');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB);
  });

  it('enrich:composite-risk follows enrich:git-frequency in done-check:core chain', () => {
    const steps = getDoneCheckSteps();
    const iA = steps.indexOf('enrich:git-frequency');
    const iB = steps.indexOf('enrich:composite-risk');
    expect(iA).toBeGreaterThanOrEqual(0);
    expect(iB).toBeGreaterThanOrEqual(0);
    expect(iA).toBeLessThan(iB);
  });

  it('no violations recorded in dependency map', () => {
    const artifactPath = resolve(ROOT, 'artifacts/done-check-deps.json');
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(artifact.violations).toHaveLength(0);
  });
});
