import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/jira/meta';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const result = await testConnection();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Connection test failed' },
      { status: err.status || 400 }
    );
  }
}
