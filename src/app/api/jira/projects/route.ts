import { NextResponse } from 'next/server';
import { getProjects } from '@/lib/jira/meta';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to fetch projects' },
      { status: err.status || 500 }
    );
  }
}
