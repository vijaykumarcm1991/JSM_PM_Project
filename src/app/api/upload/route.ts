import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import { parseWorkbookBuffer } from '@/lib/excel/parse';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const existingUploadId = formData.get('uploadId') as string | null;
    const requestedSheet = (formData.get('sheetName') as string | null) || undefined;
    const requestedHeaderRow = formData.get('headerRowIndex')
      ? parseInt(formData.get('headerRowIndex') as string, 10)
      : undefined;

    let buffer: Buffer;
    let filename: string;

    if (file) {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      filename = file.name;
    } else {
      return NextResponse.json({ error: 'No file provided in form-data' }, { status: 400 });
    }

    const parsed = await parseWorkbookBuffer(buffer, filename, {
      sheetName: requestedSheet,
      headerRowIndex: requestedHeaderRow,
    });

    const uploadId = existingUploadId || crypto.randomUUID();
    const db = getDb();
    const now = new Date().toISOString();

    const insertOrReplace = db.prepare(`
      INSERT OR REPLACE INTO uploads (id, filename, sheet_name, headers_json, rows_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertOrReplace.run(
      uploadId,
      parsed.filename,
      parsed.selectedSheet,
      JSON.stringify(parsed.headers),
      JSON.stringify(parsed.rows),
      now
    );

    return NextResponse.json({
      uploadId,
      filename: parsed.filename,
      sheets: parsed.sheets,
      selectedSheet: parsed.selectedSheet,
      headerRowIndex: parsed.headerRowIndex,
      headers: parsed.headers,
      rowCount: parsed.rowCount,
      previewRows: parsed.previewRows,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to process spreadsheet file' },
      { status: 400 }
    );
  }
}
