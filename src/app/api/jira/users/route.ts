import { NextRequest, NextResponse } from 'next/server';
import { searchUsers } from '@/lib/jira/meta';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query') || '';
    if (!query.trim()) {
      return NextResponse.json([]);
    }

    const users = await searchUsers(query);
    return NextResponse.json(users);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to search users' },
      { status: err.status || 500 }
    );
  }
}
