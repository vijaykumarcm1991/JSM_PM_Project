import { NextRequest, NextResponse } from 'next/server';
import { getIssueTypes } from '@/lib/jira/meta';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectKey = searchParams.get('projectKey');
    if (!projectKey) {
      return NextResponse.json({ error: 'projectKey query parameter is required' }, { status: 400 });
    }

    const issueTypes = await getIssueTypes(projectKey);
    return NextResponse.json(issueTypes);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch issue types' },
      { status: err.status || 500 }
    );
  }
}
