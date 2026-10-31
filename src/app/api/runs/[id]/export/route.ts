import { NextRequest, NextResponse } from 'next/server';
import { getDb, DbRun, DbRunRow, DbUpload } from '@/lib/db';
import { generateResultsExcel } from '@/lib/excel/export';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: runId } = await params;
    const db = getDb();
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as DbRun | undefined;

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const rows = db.prepare(
      'SELECT * FROM run_rows WHERE run_id = ? ORDER BY row_index ASC'
    ).all(runId) as unknown as DbRunRow[];

    // Find the corresponding upload snapshot
    const upload = db.prepare(`
      SELECT * FROM uploads
      WHERE filename = ? AND sheet_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(run.source_filename, run.sheet_name) as unknown as DbUpload | undefined;

    let headers: string[] = ['Summary'];
    let rowsData: Record<number, Record<string, any>> = {};

    if (upload) {
      try {
        headers = JSON.parse(upload.headers_json);
        rowsData = JSON.parse(upload.rows_json);
      } catch {
        // fallback
      }
    } else {
      // Reconstruct basic headers
      for (const r of rows) {
        rowsData[r.row_index] = { Summary: r.summary || '' };
      }
    }

    const excelBuffer = await generateResultsExcel(headers, rowsData, rows);
    const filename = `jira-import-results-${run.project_key}-${run.id.slice(0, 8)}.xlsx`;

    return new Response(excelBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Export failed' },
      { status: 500 }
    );
  }
}
