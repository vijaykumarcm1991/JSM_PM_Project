import { getDb, DbRun, DbRunRow, DbUpload } from '../db';
import { getJiraConcurrency } from '../jira/client';
import { createIssue } from '../jira/issues';
import { resolveRowAttachments } from '../attachments/resolve';
import { uploadIssueAttachments } from '../attachments/upload';
import { emitRunProgress } from './events';
import crypto from 'node:crypto';

const cancelledRuns = new Set<string>();
const activeEngines = new Set<string>();

export function cancelRun(runId: string): void {
  cancelledRuns.add(runId);
  const db = getDb();
  db.prepare(`UPDATE runs SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?`).run(runId);
}

export async function runWorkerPool(
  items: DbRunRow[],
  concurrency: number,
  workerFn: (item: DbRunRow) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let index = 0;
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (index < items.length && !shouldStop()) {
          const currentIndex = index++;
          const item = items[currentIndex];
          if (item) {
            await workerFn(item);
          }
        }
      })()
    );
  }

  await Promise.all(workers);
}

export async function startRunEngine(runId: string): Promise<void> {
  if (activeEngines.has(runId)) {
    return;
  }
  activeEngines.add(runId);

  try {
    const db = getDb();
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as DbRun | undefined;
    if (!run) return;

    db.prepare(`UPDATE runs SET status = 'running' WHERE id = ?`).run(runId);

    const rows = db.prepare(
      'SELECT * FROM run_rows WHERE run_id = ? AND status = ? ORDER BY row_index ASC'
    ).all(runId, 'pending') as unknown as DbRunRow[];

    const totalCount = run.total;
    const concurrency = getJiraConcurrency();
    let fatalEncountered: string | null = null;

    const executeTask = async (row: DbRunRow) => {
      if (cancelledRuns.has(runId) || fatalEncountered) return;

      const startTime = Date.now();
      let fields: Record<string, any> = {};
      try {
        fields = JSON.parse(row.payload_json);
      } catch {
        // Fallback
      }

      // Check if row has attachment file paths stored in payload or attachments_json
      let attachmentPathsVal: string | null = null;
      if (row.attachments_json) {
        try {
          const parsed = JSON.parse(row.attachments_json);
          if (parsed && typeof parsed === 'object' && parsed.rawPath) {
            attachmentPathsVal = parsed.rawPath;
          }
        } catch {
          // ignore
        }
      }

      try {
        const issue = await createIssue(fields);
        const durationMs = Date.now() - startTime;

        let attStatus: 'none' | 'ok' | 'partial' | 'failed' = 'none';
        let attachedCount = 0;
        let attJson = '[]';
        let attError: string | null = null;

        if (attachmentPathsVal) {
          const resolved = resolveRowAttachments(attachmentPathsVal);
          if (resolved.attachments.length > 0) {
            const valid = resolved.attachments.filter((a) => a.valid);
            const uploadOutcome = await uploadIssueAttachments(issue.key, valid);
            attStatus = uploadOutcome.status;
            attachedCount = uploadOutcome.attachedCount;
            attJson = JSON.stringify(uploadOutcome.files);
            attError = uploadOutcome.error || (resolved.warnings.length > 0 ? resolved.warnings.join('; ') : null);
          }
        }

        db.prepare(`
          UPDATE run_rows
          SET status = 'created',
              issue_key = ?,
              issue_url = ?,
              duration_ms = ?,
              attempts = attempts + 1,
              attachment_status = ?,
              attached_count = ?,
              attachments_json = ?,
              attachment_error = ?
          WHERE id = ?
        `).run(
          issue.key,
          issue.url,
          durationMs,
          attStatus,
          attachedCount,
          attJson,
          attError,
          row.id
        );

        row.status = 'created';
        row.issue_key = issue.key;
        row.issue_url = issue.url;
        row.attachment_status = attStatus;
        row.attached_count = attachedCount;
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const httpStatus = err.status || 0;
        const errorMsg = err.message || 'Creation failed';

        db.prepare(`
          UPDATE run_rows
          SET status = 'failed',
              error = ?,
              http_status = ?,
              duration_ms = ?,
              attempts = attempts + 1
          WHERE id = ?
        `).run(errorMsg, httpStatus, durationMs, row.id);

        row.status = 'failed';
        row.error = errorMsg;
        row.http_status = httpStatus;

        if (err.name === 'JiraFatalError') {
          fatalEncountered = errorMsg;
        }
      }

      // Read current counts
      const counts = db.prepare(`
        SELECT
          COUNT(CASE WHEN status = 'created' THEN 1 END) as created_count,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_count,
          COUNT(CASE WHEN attachment_status IN ('partial', 'failed') THEN 1 END) as attachment_warning_count
        FROM run_rows
        WHERE run_id = ?
      `).get(runId) as unknown as {
        created_count: number;
        failed_count: number;
        skipped_count: number;
        attachment_warning_count: number;
      };

      const completedSoFar = counts.created_count + counts.failed_count + counts.skipped_count;

      emitRunProgress({
        runId,
        type: 'row_update',
        total: totalCount,
        completed: completedSoFar,
        createdCount: counts.created_count,
        failedCount: counts.failed_count,
        skippedCount: counts.skipped_count,
        row: {
          id: row.id,
          rowIndex: row.row_index,
          status: row.status,
          summary: row.summary,
          issueKey: row.issue_key,
          issueUrl: row.issue_url,
          error: row.error,
          attachmentStatus: row.attachment_status,
          attachedCount: row.attached_count,
        },
      });
    };

    await runWorkerPool(
      rows,
      concurrency,
      executeTask,
      () => cancelledRuns.has(runId) || Boolean(fatalEncountered)
    );

    // If fatal encountered, mark any remaining pending rows as failed
    if (fatalEncountered) {
      db.prepare(`
        UPDATE run_rows
        SET status = 'failed', error = ?
        WHERE run_id = ? AND status = 'pending'
      `).run(`Aborted due to fatal error: ${fatalEncountered}`, runId);
    }

    // Finalize run
    const finalCounts = db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'created' THEN 1 END) as created_count,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COUNT(CASE WHEN status = 'skipped' THEN 1 END) as skipped_count,
        COUNT(CASE WHEN attachment_status IN ('partial', 'failed') THEN 1 END) as attachment_warning_count
      FROM run_rows
      WHERE run_id = ?
    `).get(runId) as unknown as {
      created_count: number;
      failed_count: number;
      skipped_count: number;
      attachment_warning_count: number;
    };

    let finalStatus: 'completed' | 'cancelled' = 'completed';
    if (cancelledRuns.has(runId)) {
      finalStatus = 'cancelled';
    }

    db.prepare(`
      UPDATE runs
      SET status = ?,
          created_count = ?,
          failed_count = ?,
          skipped_count = ?,
          attachment_warning_count = ?,
          finished_at = datetime('now')
      WHERE id = ?
    `).run(
      finalStatus,
      finalCounts.created_count,
      finalCounts.failed_count,
      finalCounts.skipped_count,
      finalCounts.attachment_warning_count,
      runId
    );

    emitRunProgress({
      runId,
      type: finalStatus,
      total: totalCount,
      completed: finalCounts.created_count + finalCounts.failed_count + finalCounts.skipped_count,
      createdCount: finalCounts.created_count,
      failedCount: finalCounts.failed_count,
      skippedCount: finalCounts.skipped_count,
      error: fatalEncountered || undefined,
    });
  } finally {
    activeEngines.delete(runId);
    cancelledRuns.delete(runId);
  }
}

export async function retryFailedRows(runId: string): Promise<string> {
  const db = getDb();
  const parentRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as DbRun | undefined;
  if (!parentRun) throw new Error('Parent run not found.');

  const failedRows = db.prepare(
    `SELECT * FROM run_rows WHERE run_id = ? AND status = 'failed' ORDER BY row_index ASC`
  ).all(runId) as unknown as DbRunRow[];

  if (failedRows.length === 0) {
    throw new Error('No failed rows found to retry.');
  }

  const newRunId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO runs (
      id, project_key, project_name, issue_type_id, issue_type_name,
      source_filename, sheet_name, total, created_count, failed_count,
      skipped_count, attachment_warning_count, status, started_at, parent_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'running', ?, ?)
  `).run(
    newRunId,
    parentRun.project_key,
    parentRun.project_name,
    parentRun.issue_type_id,
    parentRun.issue_type_name,
    parentRun.source_filename,
    parentRun.sheet_name,
    failedRows.length,
    now,
    runId
  );

  const insertRow = db.prepare(`
    INSERT INTO run_rows (
      run_id, row_index, summary, payload_json, status, attempts,
      duration_ms, attachment_status, attached_count, attachments_json,
      attachment_attempts
    ) VALUES (?, ?, ?, ?, 'pending', 0, 0, 'none', 0, ?, 0)
  `);

  for (const row of failedRows) {
    insertRow.run(
      newRunId,
      row.row_index,
      row.summary,
      row.payload_json,
      row.attachments_json || '[]'
    );
  }

  // Trigger engine asynchronously
  setImmediate(() => {
    startRunEngine(newRunId).catch(console.error);
  });

  return newRunId;
}

export async function retryRunAttachments(runId: string): Promise<void> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM run_rows
    WHERE run_id = ? AND status = 'created' AND attachment_status IN ('partial', 'failed')
    ORDER BY row_index ASC
  `).all(runId) as unknown as DbRunRow[];

  if (rows.length === 0) {
    return;
  }

  const concurrency = getJiraConcurrency();

  const retryTask = async (row: DbRunRow) => {
    if (!row.issue_key) return;

    let attachmentPathsVal: string | null = null;
    if (row.attachments_json) {
      try {
        const parsed = JSON.parse(row.attachments_json);
        if (parsed && typeof parsed === 'object' && parsed.rawPath) {
          attachmentPathsVal = parsed.rawPath;
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          attachmentPathsVal = parsed.map((p: any) => p.path).join('; ');
        }
      } catch {
        // ignore
      }
    }

    if (!attachmentPathsVal) return;

    const resolved = resolveRowAttachments(attachmentPathsVal);
    const valid = resolved.attachments.filter((a) => a.valid);
    if (valid.length === 0) return;

    const uploadOutcome = await uploadIssueAttachments(row.issue_key, valid);

    db.prepare(`
      UPDATE run_rows
      SET attachment_status = ?,
          attached_count = ?,
          attachments_json = ?,
          attachment_error = ?,
          attachment_attempts = attachment_attempts + 1
      WHERE id = ?
    `).run(
      uploadOutcome.status,
      uploadOutcome.attachedCount,
      JSON.stringify(uploadOutcome.files),
      uploadOutcome.error || (resolved.warnings.length > 0 ? resolved.warnings.join('; ') : null),
      row.id
    );

    emitRunProgress({
      runId,
      type: 'row_update',
      total: rows.length,
      completed: 0,
      createdCount: 0,
      failedCount: 0,
      skippedCount: 0,
      row: {
        id: row.id,
        rowIndex: row.row_index,
        status: row.status,
        summary: row.summary,
        issueKey: row.issue_key,
        issueUrl: row.issue_url,
        error: row.error,
        attachmentStatus: uploadOutcome.status,
        attachedCount: uploadOutcome.attachedCount,
      },
    });
  };

  await runWorkerPool(rows, concurrency, retryTask, () => false);

  // Recalculate attachment warning count
  const counts = db.prepare(`
    SELECT COUNT(CASE WHEN attachment_status IN ('partial', 'failed') THEN 1 END) as attachment_warning_count
    FROM run_rows
    WHERE run_id = ?
  `).get(runId) as unknown as { attachment_warning_count: number };

  db.prepare(`UPDATE runs SET attachment_warning_count = ? WHERE id = ?`).run(
    counts.attachment_warning_count,
    runId
  );
}
