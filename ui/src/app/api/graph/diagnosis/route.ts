import { NextResponse } from 'next/server';
import { runDiagnosis, closeDriver } from '../../../../../../src/scripts/entry/self-diagnosis';

export async function GET() {
  try {
    const results = await runDiagnosis();
    await closeDriver();
    return NextResponse.json({ data: results });
  } catch (error) {
    await closeDriver().catch(() => {});
    return NextResponse.json(
      { error: 'Diagnosis failed', message: String(error) },
      { status: 500 },
    );
  }
}
