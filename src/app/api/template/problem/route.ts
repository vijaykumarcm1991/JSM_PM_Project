import { NextResponse } from 'next/server';
import { generateProblemTemplate } from '@/lib/excel/template';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const buffer = await generateProblemTemplate();
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Jira-Problem-Import-Template.xlsx"',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
