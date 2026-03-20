import { NextResponse } from 'next/server';
import { runDiagnosis } from '../../../../../../src/scripts/entry/self-diagnosis';

export async function GET() {
  try {
    const results = await runDiagnosis();
    // NOTE: Do NOT call closeDriver() here — this is a long-running server,
    // not a CLI script. Closing the driver kills the pool for all future requests.
    return NextResponse.json({ data: results });
  } catch (error) {
    return NextResponse.json(
      { error: 'Diagnosis failed', message: String(error) },
      { status: 500 },
    );
  }
}
