/**
 * RF-13 diagnostics/probe integration tests
 *
 * Coverage target for CRITICAL entry scripts touched by RF-13:
 * - src/scripts/entry/self-diagnosis.ts
 * - src/scripts/entry/probe-architecture.ts
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  runDiagnosis,
  closeDriver as closeDiagnosisDriver,
} from '../../../../scripts/entry/self-diagnosis.js';
import {
  runProbes,
  closeDriver as closeProbeDriver,
} from '../../../../scripts/entry/probe-architecture.js';

describe('RF-13 role diagnostics + probe', () => {
  afterAll(async () => {
    await closeDiagnosisDriver();
    await closeProbeDriver();
  });

  it('self-diagnosis exposes D37 semantic role coverage check', async () => {
    const results = await runDiagnosis();
    expect(results.length).toBeGreaterThanOrEqual(37);
    const d37 = results.find((r) => r.id === 'D37');
    expect(d37).toBeTruthy();
    expect(d37?.question).toContain('semanticRole');
  }, 15000);

  it('probe-architecture exposes RF-13 role distribution and role-scoped god-file probes', async () => {
    const probes = await runProbes();
    expect(probes.length).toBeGreaterThanOrEqual(45);

    const q44 = probes.find((p) => p.id === 'Q44');
    const q45 = probes.find((p) => p.id === 'Q45');

    expect(q44).toBeTruthy();
    expect(q45).toBeTruthy();
    expect(q44?.name).toContain('Semantic role distribution');
    expect(q45?.name).toContain('Role-scoped god files');
  });
});
