import { NextRequest, NextResponse } from 'next/server';
import { getCreatemetaFields } from '@/lib/jira/meta';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectKey = searchParams.get('projectKey');
    const issueTypeId = searchParams.get('issueTypeId');

    if (!projectKey || !issueTypeId) {
      return NextResponse.json(
        { error: 'projectKey and issueTypeId parameters are required' },
        { status: 400 }
      );
    }

    const fields = await getCreatemetaFields(projectKey, issueTypeId);
    return NextResponse.json(fields);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch field metadata' },
      { status: err.status || 500 }
    );
  }
}
