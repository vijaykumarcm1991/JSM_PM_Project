import { NextResponse } from 'next/server';
import { getPublicSettings, saveSettings } from '@/lib/settings';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const settings = getPublicSettings();
    return NextResponse.json(settings);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const updated = saveSettings({
      baseUrl: body.baseUrl || '',
      email: body.email || '',
      apiToken: body.apiToken || undefined,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
