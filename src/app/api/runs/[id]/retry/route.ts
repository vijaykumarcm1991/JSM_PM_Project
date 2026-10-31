import { NextRequest, NextResponse } from 'next/server';
import { cancelRun, retryFailedRows, retryRunAttachments } from '@/lib/runs/engine';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: runId } = await params;
    const body = await req.json();

    if (body.cancel) {
      cancelRun(runId);
      return NextResponse.json({ cancelled: true });
    }

    const { mode } = body;
    if (mode === 'failed') {
      const newRunId = await retryFailedRows(runId);
      return NextResponse.json({ newRunId });
    }

    if (mode === 'attachments') {
      // Run retry in background
      setImmediate(() => {
        retryRunAttachments(runId).catch(console.error);
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid mode. Must be "failed" or "attachments"' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Retry operation failed' },
      { status: 400 }
    );
  }
}
