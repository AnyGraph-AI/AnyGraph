import { NextResponse } from 'next/server';
import { runProbes } from '../../../../../../src/scripts/entry/probe-architecture';

export async function GET() {
  try {
    const probes = await runProbes();

    const summary = probes.reduce(
      (acc, probe) => {
        acc.total += 1;
        if (probe.status === 'pass') acc.healthy += 1;
        if (probe.status === 'warn') acc.warning += 1;
        if (probe.status === 'info') acc.info += 1;
        return acc;
      },
      { total: 0, healthy: 0, warning: 0, info: 0 },
    );

    return NextResponse.json({ data: probes, summary });
  } catch (error) {
    return NextResponse.json(
      { error: 'Probe API failed', message: String(error) },
      { status: 500 },
    );
  }
}
