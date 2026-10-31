import { NextRequest } from 'next/server';
import { getDb, DbRun, DbRunRow } from '@/lib/db';
import { runEvents, RunProgressEvent } from '@/lib/runs/events';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;
  const db = getDb();
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as DbRun | undefined;

  if (!run) {
    return new Response('Run not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial state
      const initialEvent = {
        runId,
        type: run.status === 'completed' || run.status === 'cancelled' || run.status === 'interrupted'
          ? run.status
          : 'init',
        total: run.total,
        completed: run.created_count + run.failed_count + run.skipped_count,
        createdCount: run.created_count,
        failedCount: run.failed_count,
        skippedCount: run.skipped_count,
      };

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

      if (run.status !== 'running') {
        controller.close();
        return;
      }

      const onProgress = (event: RunProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'error') {
            runEvents.off(`run:${runId}`, onProgress);
            controller.close();
          }
        } catch {
          runEvents.off(`run:${runId}`, onProgress);
        }
      };

      runEvents.on(`run:${runId}`, onProgress);

      req.signal.addEventListener('abort', () => {
        runEvents.off(`run:${runId}`, onProgress);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
