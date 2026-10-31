import { EventEmitter } from 'node:events';

class RunEventBus extends EventEmitter {}

// Global event bus for run events
export const runEvents = new RunEventBus();
runEvents.setMaxListeners(100);

export interface RunProgressEvent {
  runId: string;
  type: 'row_update' | 'completed' | 'cancelled' | 'error';
  total: number;
  completed: number;
  createdCount: number;
  failedCount: number;
  skippedCount: number;
  row?: {
    id: number;
    rowIndex: number;
    status: string;
    summary: string | null;
    issueKey: string | null;
    issueUrl: string | null;
    error: string | null;
    attachmentStatus: string;
    attachedCount: number;
  };
  error?: string;
}

export function emitRunProgress(event: RunProgressEvent): void {
  runEvents.emit(`run:${event.runId}`, event);
}
