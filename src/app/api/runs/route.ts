import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb, DbRun, DbUpload } from '@/lib/db';
import { getCreatemetaFields } from '@/lib/jira/meta';
import { buildIssuePayload } from '@/lib/mapping/build';
import { MappingConfigSchema } from '@/lib/mapping/types';
import { startRunEngine } from '@/lib/runs/engine';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const db = getDb();
    const runs = db.prepare(`
      SELECT * FROM runs
      ORDER BY started_at DESC
    `).all() as unknown as DbRun[];

    return NextResponse.json(runs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      uploadId,
      config: rawConfig,
      projectName,
      issueTypeName,
      duplicatePolicy = 'skip',
      skippedRowIndices = [],
    } = body;

    if (!uploadId) {
      return NextResponse.json({ error: 'uploadId is required' }, { status: 400 });
    }

    const configParse = MappingConfigSchema.safeParse(rawConfig);
    if (!configParse.success) {
      return NextResponse.json(
        { error: 'Invalid mapping configuration', details: configParse.error.format() },
        { status: 400 }
      );
    }
    const config = configParse.data;

    const db = getDb();
    const upload = db.prepare('SELECT * FROM uploads WHERE id = ?').get(uploadId) as unknown as DbUpload | undefined;
    if (!upload) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    let rows: Record<number, Record<string, any>> = {};
    try {
      rows = JSON.parse(upload.rows_json);
    } catch {
      return NextResponse.json({ error: 'Failed to parse upload data rows' }, { status: 500 });
    }

    const fieldMetas = await getCreatemetaFields(config.projectKey, config.issueTypeId);
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    const sortedRowIndices = Object.keys(rows)
      .map(Number)
      .sort((a, b) => a - b);

    const total = sortedRowIndices.length;
    let initialSkipped = 0;
    let initialFailed = 0;

    const skipSet = new Set<number>(skippedRowIndices.map(Number));

    const projectKeys = Array.from(
      new Set(
        sortedRowIndices
          .map((r) => rows[r]['Project'] || rows[r]['project'] || config.projectKey)
          .filter(Boolean)
      )
    );
    const resolvedProjectKey =
      projectKeys.length === 1 ? projectKeys[0] : projectKeys.length > 1 ? `Multi (${projectKeys.length})` : config.projectKey;

    // Create run record
    db.prepare(`
      INSERT INTO runs (
        id, project_key, project_name, issue_type_id, issue_type_name,
        source_filename, sheet_name, total, created_count, failed_count,
        skipped_count, attachment_warning_count, status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'running', ?)
    `).run(
      runId,
      resolvedProjectKey,
      projectName || (projectKeys.length > 1 ? projectKeys.join(', ') : resolvedProjectKey),
      config.issueTypeId || '10037',
      issueTypeName || 'Problem',
      upload.filename,
      upload.sheet_name,
      total,
      now
    );

    const insertRowStmt = db.prepare(`
      INSERT INTO run_rows (
        run_id, row_index, summary, payload_json, status, error, attempts,
        duration_ms, attachment_status, attached_count, attachments_json, attachment_attempts
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'none', 0, ?, 0)
    `);

    for (const rIndex of sortedRowIndices) {
      const rowData = rows[rIndex];
      const { fields, errors } = await buildIssuePayload(rowData, config, fieldMetas);
      const summaryStr = fields.summary ? String(fields.summary).trim() : `Row ${rIndex}`;

      // Attachment raw path if mapped
      let rawAttachmentPath: string | null = null;
      if (config.attachment?.columnName && rowData[config.attachment.columnName]) {
        rawAttachmentPath = String(rowData[config.attachment.columnName]);
      }
      const attJson = rawAttachmentPath ? JSON.stringify({ rawPath: rawAttachmentPath }) : '[]';

      if (skipSet.has(rIndex)) {
        initialSkipped++;
        insertRowStmt.run(
          runId,
          rIndex,
          summaryStr,
          JSON.stringify(fields),
          'skipped',
          'Skipped by duplicate or exclusion policy',
          attJson
        );
      } else if (errors.length > 0) {
        initialFailed++;
        insertRowStmt.run(
          runId,
          rIndex,
          summaryStr,
          JSON.stringify(fields),
          'failed',
          errors.join('; '),
          attJson
        );
      } else {
        insertRowStmt.run(
          runId,
          rIndex,
          summaryStr,
          JSON.stringify(fields),
          'pending',
          null,
          attJson
        );
      }
    }

    // Update initial counts
    db.prepare(`
      UPDATE runs
      SET skipped_count = ?, failed_count = ?
      WHERE id = ?
    `).run(initialSkipped, initialFailed, runId);

    // Launch run engine asynchronously
    setImmediate(() => {
      startRunEngine(runId).catch(console.error);
    });

    return NextResponse.json({ runId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to start run' },
      { status: 500 }
    );
  }
}
